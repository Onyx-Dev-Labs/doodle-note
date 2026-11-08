using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace DoodleNote.DictationHelper
{
    /// <summary>One paste's clipboard transaction: the user's saved clipboard, from before our write until its restore.</summary>
    internal sealed class PendingRecord
    {
        public readonly string Id;
        /// <summary>A per-transaction secret carried by our write's sentinel and kept only in the sealed payload.</summary>
        public readonly string Nonce;
        public PendingRecord() { Id = Guid.NewGuid().ToString("N"); Nonce = Guid.NewGuid().ToString("N"); }
        /// <summary>An existing record (a recovery journals its own stages under the same id).</summary>
        public PendingRecord(string id, string nonce) { Id = id; Nonce = nonce ?? ""; }
        /// <summary>False when the saved content carried a privacy marker: then it never leaves memory.</summary>
        public bool Persisted;
        public string Stage = "saved";
        /// <summary>The clipboard sequence number right after OUR write (0 until it is known).</summary>
        public uint SequenceAfterWrite;
        /// <summary>The sequence number that goes with the current stage (see PendingClipboard.Decide).</summary>
        public uint SequenceAtStage;
        /// <summary>
        /// The same stage's sequence read again AFTER our close, by re-opening the clipboard with our window
        /// still its owner (Windows moves the number again at the close). 0 when not read.
        /// </summary>
        public uint SequenceClosed;
        /// <summary>A recovery's journal keeps the stage it FOUND (see PendingClipboard.Restore).</summary>
        public string OriginStage;
        public uint OriginSequenceAtStage, OriginSequenceClosed;
        /// <summary>The delivery (request id) this transaction belongs to: late and recovered results name it.</summary>
        public string DeliveryId = "";
        /// <summary>A restore ran and failed: the record is kept for a retry (its stage says where it stopped).</summary>
        public bool Unrestored;
        /// <summary>The dictated text's SHA-256: our write is recognized by it (also in memory-only transactions).</summary>
        public byte[] DictatedHash;
        public DateTime CreatedUtc = DateTime.UtcNow;
        /// <summary>The tick count (since boot) when the transaction began: a smaller one now means a new boot.</summary>
        public long CreatedTick = (long)Native.GetTickCount64();
        /// <summary>Guards publication of the payload against settlement (a settled record is never published).</summary>
        public readonly object Gate = new object();
        public bool Settled;
        public Thread PayloadWriter;
    }

    /// <summary>A kept transaction the user may restore (formats and size only; never content).</summary>
    internal sealed class ClipboardOffer
    {
        public string Record, Delivery;
        public int Formats;
        public long Bytes;
        /// <summary>The clipboard sequence when the offer was made: a restore requires it unchanged.</summary>
        public uint Sequence;
        public DateTime Created;
        /// <summary>A hint only (the order of offers), never authority to write: the state looked like ours cut short.</summary>
        public bool LikelyOurs;

        public Dictionary<string, object> Fields()
        {
            return Wire.Fields("record", Record, "delivery", Delivery ?? "", "formats", Formats, "bytes", (double)Bytes,
                "sequence", (double)Sequence, "created", Created.ToString("o"), "likelyOurs", LikelyOurs);
        }
    }

    /// <summary>
    /// The user's saved clipboard, written down for the moment between our clipboard write and its
    /// restore, so a helper that ends in that moment (killed, crashed, or quitting before the restore)
    /// does not lose it.
    ///
    /// Each paste is one record with its own id: an encrypted payload (DPAPI, current user: the saved
    /// formats, whether the save was complete, the transaction's nonce and the dictated text's SHA-256)
    /// and a small plain state file (no user content) in the per-user %TEMP% under the app identity.
    ///
    /// The state file journals the transaction, each stage with the clipboard sequence number that goes
    /// with it. Stages BEFORE an EmptyClipboard of ours carry the sequence before it (emptying, restoring,
    /// recovering); stages AFTER one carry the sequence read under the same lock right after our
    /// EmptyClipboard returned (emptied, restore-emptied, recovering-emptied) and, when the clipboard was
    /// closed afterwards with the record kept, the sequence read again after the close with our window
    /// still the owner. "written" carries the sequence read inside our write's lock and the one confirmed
    /// after the close. A recovery keeps the stage it FOUND as its origin. Every record carries its logon
    /// identity: the window-station session, the logon session (LUID), a per-logon key in a volatile
    /// registry key, Windows' boot counter and the tick count; the wall clock is never part of it.
    ///
    /// POLICY. The helper writes the user's saved content back on its own ONLY when the clipboard is
    /// provably ours (Decide): (a) our complete write (sentinel with this transaction's nonce, our exact
    /// markers, our text by its hash), (b) an empty clipboard at exactly the sequence journaled under our
    /// lock right after OUR EmptyClipboard, or (c) our own live window still owns the clipboard. Every other
    /// state is PENDING: the record is kept, nothing is written, and the app offers the user a Restore
    /// (a journaled transaction of its own, run only if the clipboard is still as it was when offered) or
    /// a Dismiss (the record is deleted). A record is deleted otherwise only when that is provable or
    /// harmless: the clipboard already holds exactly the saved content, nothing was emptied, a live foreign
    /// owner or the user's own later copy (a sequence beyond anything our operations explain), another
    /// logon or boot, or the 24 h retention. Sequence bounds are used only for that last kind of proof and
    /// as a hint for the offer, never as authority to write.
    ///
    /// Privacy: content that carries any clipboard privacy marker (password managers set them to say
    /// "do not record") is never written to disk; such a transaction stays in memory only, so after a
    /// crash there is nothing to offer.
    /// </summary>
    internal static class PendingClipboard
    {
        static readonly byte[] Entropy = Encoding.UTF8.GetBytes("DoodleNote-Bark-clipboard-v3");
        static readonly object gate = new object();
        /// <summary>A payload larger than this is not read back (corrupt or not ours): logged and deleted.</summary>
        public const long MaxRecordBytes = 64L * 1024 * 1024;
        /// <summary>How long a paste waits for its payload to be on disk before going ahead anyway.</summary>
        public const int PayloadWaitMs = 250;
        /// <summary>The private format our WRITE carries last ("&lt;record id&gt;:&lt;nonce&gt;"). Restores never set it.</summary>
        public const string SentinelFormat = "DoodleNote.Bark.Transaction";
        /// <summary>Clipboard operations of our write after its EmptyClipboard (text, three markers, sentinel).</summary>
        public const int WriteOps = 5;
        /// <summary>Allowance for the sequence moves Windows makes when the clipboard is closed (bounds only).</summary>
        public const int CloseMoves = 2;
        /// <summary>The state-file format this helper writes; older records are removed, never restored from.</summary>
        public const int Format = 3;
        /// <summary>How long a kept (pending) record is offered before it is deleted.</summary>
        public static readonly TimeSpan Retention = TimeSpan.FromHours(24);
        static readonly int[] RetryDelaysMs = { 3000, 10000, 30000, 60000, 120000 };
        static readonly HashSet<string> inFlight = new HashSet<string>();
        /// <summary>Payload writers still running in this process (their record must not be judged "no payload").</summary>
        static readonly HashSet<string> writing = new HashSet<string>();
        /// <summary>Per transaction: its retry backoff step and timer.</summary>
        static readonly Dictionary<string, KeyValuePair<int, Timer>> retries = new Dictionary<string, KeyValuePair<int, Timer>>();
        /// <summary>The offers this helper has made (sent as "pending" events), by record id.</summary>
        static readonly Dictionary<string, ClipboardOffer> offers = new Dictionary<string, ClipboardOffer>();

        /// <summary>Tests point the records elsewhere, and can slow the payload writer down.</summary>
        internal static string Directory = Path.GetTempPath();
        internal static int TestPayloadDelayMs = TestMode.Int("DICTATION_HELPER_TEST_PAYLOAD_DELAY_MS", 0);
        static string Prefix { get { return "DoodleNote-Bark-clipboard-" + HelperIdentity.Sanitized + "-"; } }
        static string PayloadPath(string id) { return Path.Combine(Directory, Prefix + id + ".bin"); }
        static string StatePath(string id) { return Path.Combine(Directory, Prefix + id + ".state"); }
        /// <summary>Exactly this identity's record files: the prefix, a 32-hex id, and nothing else (identity X never reads X-foo's).</summary>
        static Regex RecordName { get { return new Regex("^" + Regex.Escape(Prefix) + "([0-9a-f]{32})\\.(bin|state)(\\.tmp)?$"); } }

        static readonly string logon = Native.LogonId();
        static readonly int session = Process.GetCurrentProcess().SessionId;
        static readonly string bootId = Native.BootId();
        static SessionKeyInfo sessionKeyInfo;
        static SessionKeyInfo SessionKey
        {
            get
            {
                if (sessionKeyInfo == null)
                {
                    sessionKeyInfo = Native.LogonSessionKey(HelperIdentity.Sanitized);
                    if (sessionKeyInfo.ReplacedPersistent) Wire.Log("a persistent (non-volatile) session key was found and replaced by a volatile one");
                    if (sessionKeyInfo.Key.Length == 0) Wire.Log("the logon key is unavailable (" + sessionKeyInfo.Note + "): kept records stay pending");
                }
                return sessionKeyInfo;
            }
        }

        /// <summary>This helper's logon identity, for RecordFacts.Compare.</summary>
        static LogonNow Now()
        {
            SessionKeyInfo key = SessionKey;
            return new LogonNow { Session = session, Logon = logon, SessionKey = key.Key, KeyCreatedTick = key.CreatedTick, BootId = bootId, Tick = (long)Native.GetTickCount64() };
        }

        public static byte[] Hash(string text)
        {
            using (SHA256 sha = SHA256.Create()) return sha.ComputeHash(Encoding.Unicode.GetBytes(text));
        }

        /// <summary>Whether any file of a record with this id is on disk (tests, diagnostics).</summary>
        internal static bool OnDisk(string id)
        {
            return File.Exists(StatePath(id)) || File.Exists(PayloadPath(id)) || File.Exists(PayloadPath(id) + ".tmp");
        }

        /// <summary>
        /// Start a transaction before our write. Content with a privacy marker stays in memory only.
        /// Otherwise the state file is written now and the payload in the background; the caller waits
        /// for it at most PayloadWaitMs. Null when the record cannot be written at all (then no paste).
        /// </summary>
        public static PendingRecord Begin(SavedClipboard saved, string dictated)
        {
            PendingRecord record = new PendingRecord();
            record.DeliveryId = Delivery.CurrentRequestId ?? "";
            record.DictatedHash = Hash(dictated);
            lock (gate) inFlight.Add(record.Id);
            if (saved.PrivacyMarked)
            {
                Wire.Log("the saved clipboard carries a privacy marker: kept in memory only (not written down)");
                return record;
            }
            try
            {
                record.Persisted = true;
                WriteState(record);
                Stopwatch watch = Stopwatch.StartNew();
                lock (gate) writing.Add(record.Id);
                record.PayloadWriter = new Thread(delegate () { WritePayload(record, saved, record.DictatedHash, watch); });
                record.PayloadWriter.IsBackground = true;
                record.PayloadWriter.Name = "pending-clipboard";
                record.PayloadWriter.Start();
                bool ready = record.PayloadWriter.Join(PayloadWaitMs);
                Wire.Log("the paste waited " + watch.ElapsedMilliseconds + " ms for the written-down clipboard" + (ready ? "" : " (still writing; going ahead)"));
                return record;
            }
            catch (Exception error)
            {
                Wire.Log("ERROR: the clipboard transaction could not be written down: " + error.GetType().Name);
                lock (gate) inFlight.Remove(record.Id);
                return null;
            }
        }

        static void WritePayload(PendingRecord record, SavedClipboard saved, byte[] hash, Stopwatch watch)
        {
            string path = PayloadPath(record.Id), tmp = path + ".tmp";
            try
            {
                MemoryStream plain = new MemoryStream();
                using (BinaryWriter writer = new BinaryWriter(plain, Encoding.UTF8, true))
                {
                    writer.Write("DNCB3");
                    writer.Write(record.Id);
                    writer.Write(record.Nonce);
                    writer.Write(hash);
                    saved.WriteTo(writer);
                }
                byte[] sealedBytes = ProtectedData.Protect(plain.ToArray(), Entropy, DataProtectionScope.CurrentUser);
                File.WriteAllBytes(tmp, sealedBytes);
                if (TestPayloadDelayMs > 0) Thread.Sleep(TestPayloadDelayMs); // test build only: a slow disk / AV scan
                // Publication and settlement exclude each other: a settled record is never published.
                lock (record.Gate)
                {
                    if (record.Settled)
                    {
                        TryDelete(tmp);
                        Wire.Log("the written-down clipboard was not published: its transaction was already settled");
                        return;
                    }
                    File.Move(tmp, path);
                }
                Wire.Log("the saved clipboard was written down (" + sealedBytes.Length + " bytes sealed and written in " + watch.ElapsedMilliseconds + " ms)");
            }
            catch (Exception error)
            {
                TryDelete(tmp);
                Wire.Log("ERROR: the saved clipboard could not be written down: " + error.GetType().Name);
            }
            finally { lock (gate) writing.Remove(record.Id); }
        }

        /// <summary>
        /// The transaction moved on; journaled (with the stage's sequence number) for a later recovery.
        /// False when a written-down transaction could not be journaled (after a short bounded retry): the
        /// caller must not take the step the journal was the prerequisite for.
        /// </summary>
        public static bool Stage(PendingRecord record, string stage, uint sequenceAtStage = 0, uint sequenceAfterWrite = 0)
        {
            if (record == null) return true;
            record.Stage = stage;
            record.SequenceAtStage = sequenceAtStage;
            record.SequenceClosed = 0;
            if (sequenceAfterWrite != 0) record.SequenceAfterWrite = sequenceAfterWrite;
            return Journal(record);
        }

        /// <summary>The current stage's sequence, read again after our close (Windows moves it at the close).</summary>
        public static bool StageClosed(PendingRecord record, uint sequenceClosed)
        {
            if (record == null || sequenceClosed == 0) return true;
            record.SequenceClosed = sequenceClosed;
            return Journal(record);
        }

        static bool Journal(PendingRecord record)
        {
            if (!record.Persisted) return true;
            if (TestMode.Env("DICTATION_HELPER_TEST_FAIL_JOURNAL") == record.Stage) { Wire.Log("ERROR: the clipboard transaction stage could not be recorded: test (" + record.Stage + ")"); return false; }
            // A short retry: an AV scan or an indexer can hold the state file for a moment. The two waits (15 ms, 40 ms)
            // are explicit delays between attempts, not a bound on how long one file-system call can take. Residual,
            // stated plainly: some stages are journaled while our clipboard lock is held (so that the journal and the
            // clipboard step cannot be separated), so a slow disk delays that open/close by the same amount.
            for (int attempt = 0; ; attempt++)
            {
                try { WriteState(record); return true; }
                catch (Exception error)
                {
                    if (attempt >= 2 || !(error is IOException || error is UnauthorizedAccessException))
                    {
                        Wire.Log("ERROR: the clipboard transaction stage could not be recorded: " + error.GetType().Name);
                        return false;
                    }
                    Thread.Sleep(attempt == 0 ? 15 : 40);
                }
            }
        }

        /// <summary>
        /// Re-open the clipboard after our close: when our window still owns it, the sequence then is the
        /// confirmed value for the current stage (journaled). Never while another app owns it.
        /// </summary>
        public static void ConfirmClosed(PendingRecord record)
        {
            if (record == null || !record.Persisted) return;
            if (!ClipboardText.Open()) return;
            uint now = 0;
            try { if (Native.GetClipboardOwner() == Ui.ClipboardWindow && Ui.ClipboardWindow != IntPtr.Zero) now = Native.GetClipboardSequenceNumber(); }
            finally { Native.CloseClipboard(); }
            if (now != 0) StageClosed(record, now);
        }

        /// <summary>The transaction whose EmptyClipboard (by this helper) was the last one: only it can be proven ours by ownership.</summary>
        static volatile string lastEmptiedBy;
        public static string LastEmptiedBy { get { return lastEmptiedBy; } }
        /// <summary>This helper just emptied the clipboard for this transaction (so our window owns it for this one only).</summary>
        public static void NoteEmptied(PendingRecord record) { lastEmptiedBy = record != null ? record.Id : null; }
        static void NoteEmptied(string id) { lastEmptiedBy = id; }

        /// <summary>A restore ran but the record must be kept (its stage could not be journaled): checked again later.</summary>
        public static void Keep(PendingRecord record)
        {
            if (record == null) return;
            lock (gate) { inFlight.Remove(record.Id); ScheduleRetry(record.Id, RetryKind.Failed); }
        }

        /// <summary>A restore result that leaves nothing to do later (anything but "unrestored").</summary>
        public static bool Settled(string restoreResult) { return restoreResult != "unrestored"; }

        /// <summary>
        /// The transaction is over for this delivery: its record is deleted when the restore completed (or
        /// nothing was emptied), and kept for a retry when it did not (its stage still says where it stopped).
        /// </summary>
        public static void Finish(PendingRecord record, string restoreResult)
        {
            if (record == null) return;
            lock (gate) inFlight.Remove(record.Id);
            if (Settled(restoreResult))
            {
                if (record.Persisted) Delete(record, "restore ran (" + restoreResult + ")");
                return;
            }
            record.Unrestored = true;
            if (record.Persisted)
            {
                Journal(record);
                lock (gate) ScheduleRetry(record.Id, RetryKind.Failed);
            }
            else Wire.Log("the restore failed and the saved clipboard was memory-only (privacy marker): it cannot be retried later");
        }

        static void WriteState(PendingRecord record)
        {
            string json = Wire.Serialize(Wire.Fields(
                "format", Format,
                "id", record.Id,
                "pid", Process.GetCurrentProcess().Id,
                "stage", record.Stage,
                "sequenceAtStage", (double)record.SequenceAtStage,
                "sequenceClosed", (double)record.SequenceClosed,
                "sequenceAfterWrite", (double)record.SequenceAfterWrite,
                "originStage", record.OriginStage ?? "",
                "originSequenceAtStage", (double)record.OriginSequenceAtStage,
                "originSequenceClosed", (double)record.OriginSequenceClosed,
                "unrestored", record.Unrestored,
                "delivery", record.DeliveryId ?? "",
                "ownerWindow", Ui.ClipboardWindow.ToInt64().ToString("x"),
                "session", session,
                "logon", logon,
                "sessionKey", SessionKey.Key,
                "bootId", bootId,
                "tick", (double)record.CreatedTick,
                "boot", Native.BootTimeUtc.ToString("o"),
                "created", record.CreatedUtc.ToString("o"),
                "updated", DateTime.UtcNow.ToString("o")));
            WriteStateJson(StatePath(record.Id), json);
        }

        static void WriteStateJson(string path, string json)
        {
            string tmp = path + ".tmp";
            File.WriteAllText(tmp, json);
            if (File.Exists(path)) File.Replace(tmp, path, null); // atomic replacement
            else File.Move(tmp, path);
        }

        static bool TryDelete(string path)
        {
            try { if (File.Exists(path)) File.Delete(path); return true; }
            catch (Exception error) { Wire.Log("ERROR: " + Path.GetFileName(path) + " could not be deleted: " + error.GetType().Name); return false; }
        }

        static void Delete(PendingRecord record, string why)
        {
            // Settled first, under the publication lock: a payload writer still running cannot publish now.
            lock (record.Gate)
            {
                record.Settled = true;
                DeleteFiles(record.Id);
            }
            if (record.PayloadWriter != null && !record.PayloadWriter.Join(2000))
                Wire.Log("the payload writer of record " + record.Id.Substring(0, 8) + " is still running; it will not publish");
            lock (gate) { CancelRetry(record.Id); OfferGone(record.Id, "settled"); }
            Wire.Log("clipboard record " + record.Id.Substring(0, 8) + " deleted: " + why);
        }

        /// <summary>Under gate.</summary>
        static bool DeleteId(string id, string why)
        {
            bool deleted = DeleteFiles(id);
            if (!deleted)
            {
                Wire.Log("clipboard record " + id.Substring(0, Math.Min(8, id.Length)) + " could not be deleted (" + why + "); kept, tried again later");
                return false;
            }
            CancelRetry(id);
            OfferGone(id, why);
            Wire.Log("clipboard record " + id.Substring(0, Math.Min(8, id.Length)) + " deleted: " + why);
            return true;
        }

        /// <summary>Under gate: an offer made for this record is withdrawn (the app removes its card).</summary>
        static void OfferGone(string id, string why)
        {
            ClipboardOffer offer;
            if (!offers.TryGetValue(id, out offer)) return;
            offers.Remove(id);
            Wire.Send(Wire.Fields("event", "clipboard", "phase", "offer-gone", "record", id, "id", offer.Delivery ?? "", "why", why));
        }

        /// <summary>
        /// The state file first: a record whose state file cannot be deleted (held by another process) keeps its
        /// payload too, so no payload is ever left without the journal that says how to use it. False: kept.
        /// </summary>
        static bool DeleteFiles(string id)
        {
            if (!TryDelete(StatePath(id))) return false;
            bool ok = true;
            foreach (string path in new[] { StatePath(id) + ".tmp", PayloadPath(id), PayloadPath(id) + ".tmp" }) ok &= TryDelete(path);
            return ok;
        }

        /// <summary>What a check of a kept record came to (it decides the retry schedule).</summary>
        internal enum RecoverResult { Done, Failed, Pending, Busy }

        /// <summary>
        /// How a check moves the record's backoff (see NextStep): it ADVANCES on a failed restore attempt or a
        /// check that is still pending; it STAYS on its step when the clipboard was busy (or a delivery was in
        /// flight); a check from a start or a delivery never consumes a step.
        /// </summary>
        internal enum RetryKind { Failed, Pending, Busy, Check }

        /// <summary>Under gate. Retry a kept record with its own backoff.</summary>
        static void ScheduleRetry(string id, RetryKind kind)
        {
            KeyValuePair<int, Timer> entry;
            bool known = retries.TryGetValue(id, out entry);
            int step = NextStep(known, known ? entry.Key : 0, kind);
            if (step == KeepSchedule) return; // already scheduled: a start or delivery check consumes nothing
            if (entry.Value != null) entry.Value.Dispose();
            if (step >= RetryDelaysMs.Length) { retries.Remove(id); Wire.Log("clipboard record " + id.Substring(0, 8) + ": retries used up; the next helper start checks it again (it stays offered)"); return; }
            int delay = kind == RetryKind.Busy ? 1000 : RetryDelaysMs[step];
            Timer timer = new Timer(delegate { RetryOne(id); }, null, delay, Timeout.Infinite);
            retries[id] = new KeyValuePair<int, Timer>(step, timer);
        }

        internal const int KeepSchedule = -1;

        /// <summary>
        /// The rule (unit-tested): the backoff step after a check. A first schedule starts at step 0; a failed
        /// restore attempt or a check that is still pending advances one step; a busy clipboard (or a delivery
        /// in flight) stays on its step; a check from a start or a delivery keeps an existing schedule.
        /// </summary>
        internal static int NextStep(bool scheduled, int step, RetryKind kind)
        {
            if (!scheduled) return 0;
            if (kind == RetryKind.Check) return KeepSchedule;
            return kind == RetryKind.Failed || kind == RetryKind.Pending ? step + 1 : step;
        }

        /// <summary>The retry kind a check's result asks for (unit-tested with NextStep).</summary>
        internal static RetryKind KindAfter(RecoverResult result, bool fromTimer)
        {
            if (!fromTimer) return RetryKind.Check;
            return result == RecoverResult.Busy ? RetryKind.Busy : result == RecoverResult.Pending ? RetryKind.Pending : RetryKind.Failed;
        }

        /// <summary>The retry step a kept record is on (tests); -1 when none is scheduled.</summary>
        internal static int RetryStep(string id)
        {
            lock (gate)
            {
                KeyValuePair<int, Timer> entry;
                return retries.TryGetValue(id, out entry) ? entry.Key : -1;
            }
        }

        static void CancelRetry(string id)
        {
            KeyValuePair<int, Timer> entry;
            if (retries.TryGetValue(id, out entry)) { if (entry.Value != null) entry.Value.Dispose(); retries.Remove(id); }
        }

        static void RetryOne(string id)
        {
            lock (gate)
            {
                // Never while a delivery of ours is in flight (our write may be on the clipboard): wait, not consumed.
                if (inFlight.Count > 0) { ScheduleRetry(id, RetryKind.Busy); return; }
                if (!File.Exists(StatePath(id))) { CancelRetry(id); return; }
                RecoverResult result;
                string verdict = RecoverOne(id, out result, false, 0);
                if (verdict != null) Wire.Log("clipboard record " + id.Substring(0, 8) + " (retry): " + verdict);
                AfterCheck(id, result, true);
            }
        }

        /// <summary>Under gate.</summary>
        static void AfterCheck(string id, RecoverResult result, bool fromTimer)
        {
            if (result == RecoverResult.Done) { CancelRetry(id); return; }
            ScheduleRetry(id, KindAfter(result, fromTimer));
        }

        /// <summary>
        /// Check every record that is not in flight here (Decide). Runs at start, before a delivery, when the
        /// app asks for the offers, and per record on its retry timer. Orphaned payloads (no state file, no
        /// running writer) and round-8 records are deleted. Only this identity's files are touched.
        /// </summary>
        public static void RecoverLeftover(string why)
        {
            StartExpiryTimer();
            lock (gate)
            {
                string[] files;
                try { files = System.IO.Directory.GetFiles(Directory, "DoodleNote-Bark-clipboard-" + HelperIdentity.Sanitized + "*"); }
                catch (Exception) { return; }
                Regex names = RecordName;
                List<string> states = new List<string>();
                foreach (string path in files)
                {
                    string name = Path.GetFileName(path);
                    // Round 8 wrote one record per identity with no id: never restored from, just removed.
                    if (name == "DoodleNote-Bark-clipboard-" + HelperIdentity.Sanitized + ".bin") { TryDelete(path); Wire.Log("a round-8 clipboard record was removed (never restored from)"); continue; }
                    Match match = names.Match(name);
                    if (!match.Success) continue; // another identity's file (X-foo for X), or not a record
                    string id = match.Groups[1].Value;
                    bool isState = match.Groups[2].Value == "state";
                    if (isState && !match.Groups[3].Success) { states.Add(id); continue; }
                    if (isState) continue; // a state .tmp: replaced atomically by its writer, removed with its record
                    if (File.Exists(StatePath(id)) || writing.Contains(id) || inFlight.Contains(id)) continue;
                    TryDelete(path);
                    Wire.Log("an orphaned clipboard payload (" + name.Substring(Prefix.Length) + ") was deleted; never restored from");
                }
                foreach (string id in states)
                {
                    if (inFlight.Contains(id)) continue;
                    RecoverResult result;
                    string verdict = RecoverOne(id, out result, false, 0);
                    if (verdict != null) Wire.Log("clipboard record " + id.Substring(0, 8) + " (" + why + "): " + verdict);
                    AfterCheck(id, result, false);
                }
            }
        }

        /// <summary>The offers this helper's records stand for now (checked again first).</summary>
        public static List<Dictionary<string, object>> Offers()
        {
            RecoverLeftover("offers");
            List<Dictionary<string, object>> list = new List<Dictionary<string, object>>();
            lock (gate) foreach (ClipboardOffer offer in offers.Values) list.Add(offer.Fields());
            return list;
        }

        /// <summary>
        /// The user asked to restore an offered record. It runs only while the clipboard is exactly as it was
        /// when offered (the same sequence): otherwise "changed", with what a restore would overwrite (formats
        /// and size only) and the new sequence, so the app can ask again.
        /// </summary>
        public static Dictionary<string, object> RestoreOffer(string id, uint expectSequence)
        {
            lock (gate)
            {
                if (!RecordName.IsMatch(Prefix + id + ".state") || !File.Exists(StatePath(id))) return Wire.Fields("result", "gone");
                RecoverResult result;
                Dictionary<string, object> reply = Wire.Fields();
                string verdict = RecoverOne(id, out result, true, expectSequence, reply);
                if (verdict != null) Wire.Log("clipboard record " + id.Substring(0, 8) + " (the user's restore): " + verdict);
                if (result != RecoverResult.Done) ScheduleRetry(id, RetryKind.Check);
                return reply;
            }
        }

        /// <summary>The user dismissed an offer: its record is deleted now.</summary>
        public static bool DismissOffer(string id)
        {
            lock (gate)
            {
                if (!RecordName.IsMatch(Prefix + id + ".state")) return false;
                if (inFlight.Contains(id)) return false;
                Dictionary<string, object> state = null;
                try { state = Wire.Parse(File.ReadAllText(StatePath(id))); } catch (Exception) { }
                if (state != null)
                {
                    RecordFacts facts = RecordFacts.Of(state);
                    if (facts.Pid != Process.GetCurrentProcess().Id && HelperRunning(facts.Pid)) return false; // its helper still runs
                }
                // The real result: false when the files could not be deleted (the card stays, retryable).
                return DeleteId(id, "dismissed by the user") || !File.Exists(StatePath(id));
            }
        }

        /// <summary>Under gate. Null when there was nothing to say. `byUser`: the user's restore of an offer (reply filled).</summary>
        static string RecoverOne(string id, out RecoverResult result, bool byUser, uint expectSequence, Dictionary<string, object> reply = null)
        {
            result = RecoverResult.Done;
            if (reply == null) reply = Wire.Fields();
            reply["result"] = "gone";
            // A read that fails (another process holds the file: an AV scan, the helper writing it) is never
            // corruption: the record is kept and checked again. Only a fully read file that does not parse is.
            string text;
            try { text = File.ReadAllText(StatePath(id)); }
            catch (Exception error)
            {
                if (!(error is IOException || error is UnauthorizedAccessException)) throw;
                result = RecoverResult.Busy; reply["result"] = "busy";
                return "its state file could not be read now (" + error.GetType().Name + "); kept";
            }
            Dictionary<string, object> state = Wire.Parse(text);
            if (state == null) { DeleteId(id, "a corrupt state file"); return "corrupt state; deleted"; }
            RecordFacts facts = RecordFacts.Of(state);
            if (facts.Pid != Process.GetCurrentProcess().Id && HelperRunning(facts.Pid)) { result = RecoverResult.Busy; reply["result"] = "busy"; return "its helper (pid " + facts.Pid + ") still runs; left to it"; }
            if (inFlight.Contains(id)) { result = RecoverResult.Busy; reply["result"] = "busy"; return "in flight here"; }
            if (facts.Stage == "saved") { DeleteId(id, "nothing had been emptied"); return "stage saved: nothing to put back"; }
            if (writing.Contains(id)) { result = RecoverResult.Busy; reply["result"] = "busy"; return "its payload is still being written; checked again later"; }
            SavedClipboard saved;
            string nonce;
            byte[] dictatedHash;
            try
            {
                FileInfo info = new FileInfo(PayloadPath(id));
                if (!info.Exists) { DeleteId(id, "no payload (the paste went ahead before it was written)"); return "ERROR: stage " + facts.Stage + " but no payload; cannot put back"; }
                if (info.Length > MaxRecordBytes) { DeleteId(id, "payload over the size cap"); return "ERROR: payload of " + info.Length + " bytes over the cap; not read"; }
                byte[] sealedBytes = null;
                string readError = null;
                try { sealedBytes = File.ReadAllBytes(PayloadPath(id)); }
                catch (Exception error)
                {
                    if (!(error is IOException || error is UnauthorizedAccessException)) throw;
                    readError = error.GetType().Name;
                }
                if (readError != null)
                {
                    result = RecoverResult.Busy; reply["result"] = "busy";
                    return "its payload could not be read now (" + readError + "); kept";
                }
                byte[] plain = ProtectedData.Unprotect(sealedBytes, Entropy, DataProtectionScope.CurrentUser);
                using (BinaryReader reader = new BinaryReader(new MemoryStream(plain), Encoding.UTF8))
                {
                    string magic = reader.ReadString();
                    if (magic != "DNCB3")
                    {
                        // Round-10 records (payload v2, never shipped in a release) cannot be read by this helper.
                        DeleteId(id, "a " + magic + " record from an earlier build: removed, never restored from");
                        return "a record from an earlier build (" + magic + "): removed";
                    }
                    if (reader.ReadString() != id) { DeleteId(id, "payload does not match"); return "ERROR: payload does not match its state"; }
                    nonce = reader.ReadString();
                    dictatedHash = reader.ReadBytes(32);
                    saved = SavedClipboard.ReadFrom(reader);
                }
            }
            catch (Exception error)
            {
                // A payload that was read in full and does not decrypt or parse: demonstrated corruption.
                DeleteId(id, "payload corrupt"); return "ERROR: payload corrupt (" + error.GetType().Name + ")";
            }
            if (!ClipboardText.Open()) { result = RecoverResult.Busy; reply["result"] = "busy"; return "the clipboard is busy; kept for a retry"; }
            PendingRecord journal = null;
            string outcome;
            try
            {
                ClipboardView view = ClipboardView.Read(saved, id, nonce, dictatedHash);
                LogonMatch match = facts.Compare(Now());
                RecoveryVerdict verdict = Decide(facts, view, match);
                string seen = view.Describe() + "; sequence " + view.Sequence + ", recorded " + facts.Stage + " " + facts.SequenceAtStage + "/" + facts.SequenceClosed + "/" + facts.SequenceAfterWrite
                    + (facts.OriginStage.Length > 0 ? " (found " + facts.OriginStage + " " + facts.OriginSequenceAtStage + "/" + facts.OriginSequenceClosed + ")" : "") + ", logon " + match.ToString().ToLowerInvariant();
                if (verdict == RecoveryVerdict.OtherSession) { result = RecoverResult.Busy; reply["result"] = "busy"; return "another session's record (" + seen + "); left to it"; }
                if (verdict == RecoveryVerdict.Stale) { DeleteId(id, "another boot or logon"); return "another boot or logon (" + seen + "); deleted"; }
                if (verdict == RecoveryVerdict.Untouched)
                {
                    if (byUser) reply["result"] = "restored";
                    DeleteId(id, "nothing of the user's is missing");
                    // A restore of it had been reported failed: the app learns the clipboard holds the user's content.
                    if (facts.Unrestored) Wire.Send(Wire.Fields("event", "clipboard", "phase", "recovered", "id", facts.Delivery, "record", id, "clipboard", "restored"));
                    return "untouched (" + seen + "): the user's content is there";
                }
                if (byUser)
                {
                    // The user's Restore: only while the clipboard is exactly as offered.
                    if (view.Sequence != expectSequence)
                    {
                        result = RecoverResult.Pending;
                        reply["result"] = "changed";
                        reply["sequence"] = (double)view.Sequence;
                        reply["formats"] = view.FormatCount;
                        long bytes = ClipboardText.OpenClipboardBytes(view.OwnerAlive && !view.OwnerIsUs);
                        reply["bytes"] = bytes >= 0 ? (object)(double)bytes : null;
                        Offer(id, facts, saved, view, verdict);
                        return "the user's restore: the clipboard changed since the offer (" + seen + "); asked again";
                    }
                }
                else if (verdict == RecoveryVerdict.Pending)
                {
                    // The retention applies only to what was offered and never restored (a provable state restores
                    // however old it is), measured on the tick count from the first offer.
                    if (Expired(facts, Now()))
                    {
                        DeleteId(id, "expired: offered longer than the " + Retention.TotalHours + " h retention");
                        return "expired; deleted";
                    }
                    result = RecoverResult.Pending;
                    reply["result"] = "pending";
                    Offer(id, facts, saved, view, verdict);
                    return "pending (" + seen + "): not provably ours, kept and offered; nothing written";
                }
                // Journaled like a delivery, keeping the stage FOUND as its origin (unwrapped only when the found
                // stage is itself a recovery that never emptied: then the clipboard is as that recovery found it).
                journal = new PendingRecord(id, nonce) { Persisted = true, SequenceAfterWrite = facts.SequenceAfterWrite, DeliveryId = facts.Delivery, Unrestored = facts.Unrestored, CreatedUtc = facts.CreatedUtc, CreatedTick = facts.Tick, DictatedHash = dictatedHash };
                RecordFacts origin = facts.Stage == "recovering" && facts.OriginStage.Length > 0 ? facts.AsOrigin() : facts;
                journal.OriginStage = origin.Stage;
                journal.OriginSequenceAtStage = origin.SequenceAtStage;
                journal.OriginSequenceClosed = origin.SequenceClosed;
                if (!Stage(journal, "recovering", view.Sequence))
                {
                    result = RecoverResult.Failed;
                    reply["result"] = "failed";
                    return "the recovery could not be journaled; nothing emptied, kept (" + verdict + ")";
                }
                int beforeEmpty = TestMode.Int("DICTATION_HELPER_TEST_RECOVERY_STALL_BEFORE_EMPTY_MS", 0);
                if (beforeEmpty > 0) Thread.Sleep(beforeEmpty); // test build only: die before the recovery empties
                if (TestMode.Env("DICTATION_HELPER_TEST_FAIL_RECOVERY_EMPTY") == "1" || !Native.EmptyClipboard())
                {
                    result = RecoverResult.Failed;
                    reply["result"] = "failed";
                    journal = null;
                    return "the clipboard could not be emptied; kept for a retry (" + verdict + ")";
                }
                NoteEmptied(id);
                bool journaled = Stage(journal, "recovering-emptied", Native.GetClipboardSequenceNumber());
                int stall = TestMode.Int("DICTATION_HELPER_TEST_RECOVERY_STALL_MS", 0);
                if (stall > 0) Thread.Sleep(stall); // test build only: die with the clipboard emptied by the recovery
                string restored = saved.PutBackResult(saved.PutBackOpen());
                reply["result"] = restored;
                if (!journaled)
                {
                    // Put back now (the user's content must not stay off the clipboard), but an interruption could not
                    // have been proven ours: the backup is kept, as an offer.
                    result = RecoverResult.Pending;
                    return "put back (" + verdict + "; " + seen + "): " + restored + ", but its stage could not be journaled: kept as an offer";
                }
                if (restored == "unrestored") { result = RecoverResult.Failed; return "put back only in part; kept for a retry (" + verdict + ")"; }
                outcome = "put back (" + verdict + "; " + seen + "): " + restored;
                DeleteId(id, outcome);
                journal = null;
                Wire.Send(Wire.Fields("event", "clipboard", "phase", "recovered", "id", facts.Delivery, "record", id, "clipboard", restored));
            }
            finally
            {
                Native.CloseClipboard();
                // A kept record whose recovery emptied the clipboard: the sequence after our close, confirmed.
                if (journal != null) ConfirmClosed(journal);
            }
            return outcome;
        }

        /// <summary>
        /// Under gate: the record is offered to the user. The offered sequence and the time of the first offer
        /// are fixed when it is first offered (persisted in the state file): a retry never refreshes them, so a
        /// later change to the clipboard always shows as "changed" at the user's click.
        /// </summary>
        static void Offer(string id, RecordFacts facts, SavedClipboard saved, ClipboardView view, RecoveryVerdict verdict)
        {
            if (facts.OfferedSequence == 0)
            {
                facts.OfferedSequence = view.Sequence;
                facts.OfferedTick = (long)Native.GetTickCount64();
                facts.OfferedBoot = bootId;
                PersistOffer(id, facts);
            }
            ClipboardOffer offer = new ClipboardOffer
            {
                Record = id, Delivery = facts.Delivery, Formats = saved.FormatCount, Bytes = saved.ByteCount,
                Sequence = facts.OfferedSequence, Created = facts.CreatedUtc, LikelyOurs = view.LooksInterrupted
            };
            if (offers.ContainsKey(id)) return; // already announced by this helper: unchanged (the app lists offers itself)
            offers[id] = offer;
            Dictionary<string, object> fields = offer.Fields();
            fields["event"] = "clipboard";
            fields["phase"] = "pending";
            fields["id"] = offer.Delivery ?? "";
            fields["clipboard"] = "unrestored";
            Wire.Send(fields);
        }

        /// <summary>Under gate: the first offer's sequence and tick go into the record's state file.</summary>
        static void PersistOffer(string id, RecordFacts facts)
        {
            try
            {
                Dictionary<string, object> state = Wire.Parse(File.ReadAllText(StatePath(id)));
                if (state == null) return;
                state["offeredSequence"] = (double)facts.OfferedSequence;
                state["offeredTick"] = (double)facts.OfferedTick;
                state["offeredBoot"] = facts.OfferedBoot ?? "";
                state["offered"] = DateTime.UtcNow.ToString("o");
                WriteStateJson(StatePath(id), Wire.Serialize(state));
            }
            catch (Exception error) { Wire.Log("the offer could not be recorded in the state file (" + error.GetType().Name + "); offered from memory"); }
        }

        /// <summary>A record nobody restored, dismissed or proved for this long is deleted (a sanity cap on the wall clock).</summary>
        public static readonly TimeSpan RetentionCap = TimeSpan.FromDays(30);

        /// <summary>
        /// The retention rule (unit-tested): 24 h from the FIRST OFFER, measured on the tick count of the same boot
        /// (no wall clock, so a clock correction never deletes anything). A record from another boot is deleted as
        /// such (Compare). Only a record whose first offer has no tick (an older build) falls back to the wall
        /// clock, and then only past RetentionCap.
        /// </summary>
        internal static bool Expired(RecordFacts facts, LogonNow now)
        {
            if (facts.OfferedTick > 0)
            {
                bool sameBoot = facts.OfferedBoot.Length > 0 && now.BootId.Length > 0 ? facts.OfferedBoot == now.BootId : now.Tick >= facts.OfferedTick;
                return sameBoot && now.Tick - facts.OfferedTick > (long)Retention.TotalMilliseconds;
            }
            return facts.CreatedUtc != DateTime.MinValue && DateTime.UtcNow - facts.CreatedUtc > RetentionCap;
        }

        static Timer expiryTimer;

        /// <summary>
        /// The retention runs on its own, every 30 min while this helper lives, whatever else happens: an idle app
        /// never keeps a copy past it. (The app also asks for the offers at start and every hour.)
        /// </summary>
        static void StartExpiryTimer()
        {
            if (expiryTimer != null) return;
            expiryTimer = new Timer(delegate { ExpireSweep(); }, null, 30 * 60 * 1000, 30 * 60 * 1000);
        }

        internal static void ExpireSweep()
        {
            lock (gate)
            {
                string[] files;
                try { files = System.IO.Directory.GetFiles(Directory, Prefix + "*.state"); } catch (Exception) { return; }
                Regex names = RecordName;
                LogonNow now = Now();
                foreach (string path in files)
                {
                    Match match = names.Match(Path.GetFileName(path));
                    if (!match.Success || match.Groups[3].Success) continue;
                    string id = match.Groups[1].Value;
                    if (inFlight.Contains(id)) continue;
                    Dictionary<string, object> state;
                    try { state = Wire.Parse(File.ReadAllText(path)); } catch (Exception) { continue; }
                    if (state == null) continue;
                    RecordFacts facts = RecordFacts.Of(state);
                    if (facts.Pid != Process.GetCurrentProcess().Id && HelperRunning(facts.Pid)) continue;
                    if (Expired(facts, now)) DeleteId(id, "expired: offered longer than the " + Retention.TotalHours + " h retention");
                }
            }
        }

        public enum RecoveryVerdict { Stale, Untouched, Pending, OtherSession, OursByWrite, OursByOwner, InterruptedEmpty }

        static bool PostEmpty(string stage) { return stage == "emptied" || stage == "restore-emptied" || stage == "recovering-emptied"; }

        /// <summary>
        /// The rule (unit-tested). Writes back on its own ONLY when the clipboard is provably ours:
        ///  (a) our complete write: our sentinel with this transaction's nonce, our exact marker values, our text
        ///      by its hash, and nothing else but what Windows synthesizes from that text, AT a sequence within our
        ///      own operations from the journaled write (continuity: a replay of every format is offered instead);
        ///  (c) our own live window still owns the clipboard and our last EmptyClipboard was for THIS transaction
        ///      (nobody has emptied it since we did, and no other transaction of ours has);
        ///  (b) an empty clipboard at exactly the sequence journaled for a stage after OUR EmptyClipboard (under
        ///      our lock, or confirmed after our close); for a recovery that never emptied, its found stage's.
        /// Every proof needs the same logon (Compare: session, LUID, per-logon key, boot). A record is deleted
        /// without writing only when that loses nothing: nothing was emptied, the clipboard already holds exactly
        /// the saved content, or another boot (the clipboard did not survive it). Another session's record is
        /// left alone. Everything else is PENDING (offered): an unknown logon, our write cut short, only saved
        /// formats, an empty clipboard right after a pre-empty stage, a live foreign owner, a sequence beyond our
        /// bounds. A pending record goes only by the user's Restore or Dismiss, the retention, or a reboot.
        /// </summary>
        public static RecoveryVerdict Decide(RecordFacts facts, ClipboardView view, LogonMatch logonMatch)
        {
            string stage = facts.Stage;
            if (stage == "saved") return RecoveryVerdict.Untouched;
            if (logonMatch == LogonMatch.OtherSession) return RecoveryVerdict.OtherSession;
            if (logonMatch == LogonMatch.Different) return RecoveryVerdict.Stale;
            if (view.HoldsSavedExactly) return RecoveryVerdict.Untouched;
            // Nothing of the user's was emptied: the clipboard is unchanged since before our EmptyClipboard.
            if (stage == "emptying" && view.Sequence == facts.SequenceAtStage) return RecoveryVerdict.Untouched;
            if (logonMatch == LogonMatch.Unknown) return RecoveryVerdict.Pending;
            if (view.OwnedByThisTransaction) return RecoveryVerdict.OursByOwner;
            // (a) needs continuity too: the content proves where it came from, not that nobody replayed it since
            // (a clipboard manager that kept every format, our sentinel included). Within our own operations from
            // the journaled write, or our window owning it: ours. Beyond them: offered, never written on its own.
            if (view.OurWrite == OurWrite.Complete && !Beyond(facts, view)) return RecoveryVerdict.OursByWrite;
            RecordFacts proof = stage == "recovering" && facts.OriginStage.Length > 0 ? facts.AsOrigin() : facts;
            if (view.FormatCount == 0 && PostEmpty(proof.Stage) && proof.SequenceAtStage != 0
                && (view.Sequence == proof.SequenceAtStage || (proof.SequenceClosed != 0 && view.Sequence == proof.SequenceClosed)))
                return RecoveryVerdict.InterruptedEmpty;
            // Everything else is offered. A live foreign owner, a sequence beyond our bounds (the user's later copy,
            // or our own later transactions), another offer's restore: none of them deletes the user's backup.
            return RecoveryVerdict.Pending;
        }

        /// <summary>
        /// The sequence moved beyond anything our own operations from the journaled stage could explain (each of
        /// our writes and put-backs, Windows' moves at a close, one per synthesized format present). Used ONLY to
        /// withhold proof (a) (a complete write beyond it may be a replay): it never deletes anything.
        /// </summary>
        internal static bool Beyond(RecordFacts facts, ClipboardView view)
        {
            uint basis = Math.Max(facts.SequenceAtStage, Math.Max(facts.SequenceClosed, facts.SequenceAfterWrite));
            if (basis == 0) return false;
            uint ops = (uint)Math.Max(WriteOps, view.RestoreOps);
            uint bound;
            switch (facts.Stage)
            {
                case "emptying":
                case "restoring":
                case "recovering":
                    bound = basis + 1 + ops; break;
                case "written":
                    bound = basis; break;
                default:
                    bound = basis + ops; break;
            }
            bound += (uint)(CloseMoves + view.SynthesizedPresent);
            return view.Sequence > bound;
        }

        static bool HelperRunning(int pid)
        {
            if (pid <= 0) return false;
            try
            {
                using (Process other = Process.GetProcessById(pid))
                    return !other.HasExited && other.ProcessName.IndexOf("dictation-helper", StringComparison.OrdinalIgnoreCase) >= 0;
            }
            catch (Exception) { return false; }
        }
    }

    /// <summary>Whether a record was written in this logon (see RecordFacts.Compare).</summary>
    internal enum LogonMatch { Same, Different, OtherSession, Unknown }

    /// <summary>This helper's logon identity.</summary>
    internal sealed class LogonNow
    {
        public int Session;
        public string Logon = "", SessionKey = "", BootId = "";
        /// <summary>When this logon's key was created (tick since boot).</summary>
        public long KeyCreatedTick;
        public long Tick;
    }

    /// <summary>What a record's state file says.</summary>
    internal sealed class RecordFacts
    {
        public int Format;
        public string Stage = "saved";
        public int Pid;
        public uint SequenceAtStage, SequenceClosed, SequenceAfterWrite;
        public string OriginStage = "";
        public uint OriginSequenceAtStage, OriginSequenceClosed;
        public bool Unrestored;
        public string Delivery = "";
        public int Session = -1;
        public string Logon = "";
        public string SessionKey = "";
        public string BootId = "";
        public long Tick;
        public DateTime CreatedUtc = DateTime.MinValue;
        /// <summary>Fixed at the first offer (see PendingClipboard.Offer).</summary>
        public uint OfferedSequence;
        public long OfferedTick;
        public string OfferedBoot = "";

        public static RecordFacts Of(Dictionary<string, object> state)
        {
            RecordFacts facts = new RecordFacts();
            facts.Format = (int)(Wire.Num(state, "format") ?? 0);
            facts.Stage = Wire.Str(state, "stage") ?? "saved";
            facts.Pid = (int)(Wire.Num(state, "pid") ?? 0);
            facts.SequenceAtStage = (uint)(Wire.Num(state, "sequenceAtStage") ?? 0);
            facts.SequenceClosed = (uint)(Wire.Num(state, "sequenceClosed") ?? 0);
            facts.SequenceAfterWrite = (uint)(Wire.Num(state, "sequenceAfterWrite") ?? 0);
            facts.OriginStage = Wire.Str(state, "originStage") ?? "";
            facts.OriginSequenceAtStage = (uint)(Wire.Num(state, "originSequenceAtStage") ?? 0);
            facts.OriginSequenceClosed = (uint)(Wire.Num(state, "originSequenceClosed") ?? 0);
            facts.Unrestored = Wire.Bool(state, "unrestored") ?? false;
            facts.Delivery = Wire.Str(state, "delivery") ?? "";
            facts.Session = (int)(Wire.Num(state, "session") ?? -1);
            facts.Logon = Wire.Str(state, "logon") ?? "";
            facts.SessionKey = Wire.Str(state, "sessionKey") ?? "";
            facts.BootId = Wire.Str(state, "bootId") ?? "";
            facts.Tick = (long)(Wire.Num(state, "tick") ?? 0);
            facts.OfferedSequence = (uint)(Wire.Num(state, "offeredSequence") ?? 0);
            facts.OfferedTick = (long)(Wire.Num(state, "offeredTick") ?? 0);
            facts.OfferedBoot = Wire.Str(state, "offeredBoot") ?? "";
            DateTime created;
            if (DateTime.TryParse(Wire.Str(state, "created") ?? "", null, System.Globalization.DateTimeStyles.RoundtripKind, out created)) facts.CreatedUtc = created.ToUniversalTime();
            return facts;
        }

        /// <summary>The stage a recovery found, judged as if the recovery had not journaled.</summary>
        public RecordFacts AsOrigin()
        {
            RecordFacts origin = (RecordFacts)MemberwiseClone();
            origin.Stage = OriginStage;
            origin.SequenceAtStage = OriginSequenceAtStage;
            origin.SequenceClosed = OriginSequenceClosed;
            origin.OriginStage = "";
            origin.OriginSequenceAtStage = 0;
            origin.OriginSequenceClosed = 0;
            return origin;
        }

        /// <summary>
        /// The rule (unit-tested). DIFFERENT (another boot: the clipboard did not survive it, so the record is
        /// deleted): Windows' boot counter differs, or the tick count is below the record's (ticks restart at
        /// boot). OTHER SESSION (left alone: its own session's helper restores it): another window-station
        /// session of the same user sharing %TEMP%. UNKNOWN (offered, never deleted for it): another per-logon
        /// key (a cleaner deleted it, a persistent one was replaced, or a relogin while the boot lasts), another
        /// LUID in the same session (an elevated helper), anything missing. SAME: session, LUID and key equal.
        /// No wall clock. The logoff contract, stated plainly: a record is deleted at reboot and by the 24 h
        /// retention; across a relogin in the same boot it stays offered.
        /// </summary>
        public LogonMatch Compare(LogonNow now)
        {
            if (BootId.Length > 0 && now.BootId.Length > 0 && BootId != now.BootId) return LogonMatch.Different;
            if (Tick > 0 && now.Tick > 0 && now.Tick < Tick) return LogonMatch.Different;
            if (Session >= 0 && Session != now.Session) return LogonMatch.OtherSession;
            if (SessionKey.Length > 0 && now.SessionKey.Length > 0 && SessionKey != now.SessionKey) return LogonMatch.Unknown;
            if (Logon.Length > 0 && now.Logon.Length > 0 && Logon != now.Logon) return LogonMatch.Unknown;
            if (Session < 0 || Logon.Length == 0 || now.Logon.Length == 0 || SessionKey.Length == 0 || now.SessionKey.Length == 0) return LogonMatch.Unknown;
            return LogonMatch.Same;
        }
    }

    /// <summary>What a clipboard holds against our write (see ClipboardView.OurWrite).</summary>
    internal enum OurWrite { None, Partial, Complete }

    /// <summary>What recovery sees on the (open) clipboard; read without asking any live owner to render.</summary>
    internal sealed class ClipboardView
    {
        public bool OwnerAlive, OwnerIsUs, OnlySavedFormats;
        /// <summary>Our live window owns the clipboard and our last EmptyClipboard was for THIS transaction.</summary>
        public bool OwnedByThisTransaction;
        /// <summary>Every saved format is present with identical content, and nothing else (but synthesized formats).</summary>
        public bool HoldsSavedExactly;
        public OurWrite OurWrite;
        public uint Sequence;
        public int FormatCount;
        /// <summary>Clipboard operations a put-back of the saved content performs after its EmptyClipboard.</summary>
        public int RestoreOps;
        /// <summary>Present standard formats Windows may synthesize (each can move the sequence once when first read).</summary>
        public int SynthesizedPresent;
        /// <summary>A hint for the offer only: our write or the saved content, cut short.</summary>
        public bool LooksInterrupted { get { return OurWrite == OurWrite.Partial || OnlySavedFormats || FormatCount == 0; } }

        public string Describe()
        {
            return "owner " + (OwnerIsUs ? "ours" : OwnerAlive ? "another app" : "none") + ", " + FormatCount + " format(s), our write "
                + OurWrite.ToString().ToLowerInvariant() + (FormatCount > 0 ? ", only saved formats " + (OnlySavedFormats ? "yes" : "no") + (HoldsSavedExactly ? " (all of them)" : "") : "");
        }

        /// <summary>Under the clipboard lock.</summary>
        public static ClipboardView Read(SavedClipboard saved, string recordId, string nonce, byte[] dictatedHash)
        {
            ClipboardView view = new ClipboardView();
            IntPtr owner = Native.GetClipboardOwner();
            view.OwnerIsUs = owner != IntPtr.Zero && owner == Ui.ClipboardWindow;
            view.OwnerAlive = owner != IntPtr.Zero && Native.IsWindow(owner);
            view.OwnedByThisTransaction = view.OwnerIsUs && view.OwnerAlive && PendingClipboard.LastEmptiedBy == recordId;
            view.Sequence = Native.GetClipboardSequenceNumber();
            view.RestoreOps = saved.RestoreOps;
            List<uint> present = new List<uint>();
            for (uint f = Native.EnumClipboardFormats(0); f != 0; f = Native.EnumClipboardFormats(f)) present.Add(f);
            view.FormatCount = present.Count;
            // Every present format Windows may synthesize counts (also when the saved content had it): Windows adds
            // them at a close and when first read, one sequence step each. Over-counting only widens the bound
            // that withholds proof (a), never a deletion.
            foreach (uint f in present) if (SavedClipboard.MaybeSynthesized(f)) view.SynthesizedPresent++;
            // A live owner that is not ours could render on demand: never read its data.
            if (view.OwnerAlive && !view.OwnerIsUs) return view;
            Func<uint, int, byte[]> read = delegate (uint f, int cap) { return ClipboardText.ReadBytes(f, cap); };
            view.OurWrite = ClipboardText.ClassifyOurWrite(present, read, recordId, nonce, dictatedHash);
            view.OnlySavedFormats = present.Count > 0 && saved.MatchesOpenClipboard();
            view.HoldsSavedExactly = view.OnlySavedFormats && saved.AllPresent(present);
            return view;
        }
    }
}
