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
        /// <summary>A recovery's journal keeps the stage it found (and its sequence), so "unchanged since" is judged by it.</summary>
        public string OriginStage;
        public uint OriginSequenceAtStage;
        /// <summary>The delivery (request id) this transaction belongs to: late and recovered results name it.</summary>
        public string DeliveryId = "";
        /// <summary>A restore ran and failed: the record is kept for a retry (its stage says where it stopped).</summary>
        public bool Unrestored;
        public DateTime CreatedUtc = DateTime.UtcNow;
        /// <summary>Guards publication of the payload against settlement (a settled record is never published).</summary>
        public readonly object Gate = new object();
        public bool Settled;
        public Thread PayloadWriter;
    }

    /// <summary>
    /// The user's saved clipboard, written down for the moment between our clipboard write and its
    /// restore, so a helper that ends in that moment (killed, crashed, or quitting before the restore)
    /// does not lose it: the next helper of the same identity, or this one later, puts it back.
    ///
    /// Each paste is one record with its own id: an encrypted payload (DPAPI, current user: the saved
    /// formats, whether the save was complete, the transaction's nonce and the dictated text's SHA-256)
    /// and a small plain state file (no user content) in the per-user %TEMP% under the app identity.
    ///
    /// The state file journals the transaction, each stage with the clipboard sequence number that goes
    /// with it. Stages BEFORE an EmptyClipboard of ours carry the sequence before it (emptying, restoring,
    /// recovering); stages AFTER one carry the sequence read under the same clipboard lock right after our
    /// EmptyClipboard returned (emptied, restore-emptied, recovering-emptied); "written" carries the sequence
    /// read inside our write's lock. A recovery keeps the stage it found (origin). Every record carries
    /// its logon identity: the window-station session, the logon session (LUID) and a per-logon key in a
    /// volatile registry key (gone at logoff and reboot), because sequence numbers restart then. The
    /// wall clock is never part of it.
    ///
    /// A record is deleted only after a restore that completed, a verdict that it is stale, or proof that
    /// nothing was emptied; never after a failed restore or an ambiguous state (then it is kept, retried
    /// with its own backoff 3, 10, 30, 60, 120 s, before the next delivery, and at the next helper start).
    /// Recovery restores only on evidence specific to the transaction (Decide): our complete write
    /// (sentinel with this transaction's nonce, our exact markers, our text by hash), or the journaled
    /// sequence number with a clipboard that is only our write or only the saved content, within the same
    /// logon. An empty clipboard right after a stage journaled BEFORE our EmptyClipboard is ambiguous (ours
    /// or a deliberate clear): kept, reported as pending, never restored over.
    ///
    /// Privacy: content that carries any clipboard privacy marker (password managers set them to say
    /// "do not record") is never written to disk; such a transaction stays in memory only.
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
        static readonly int[] RetryDelaysMs = { 3000, 10000, 30000, 60000, 120000 };
        static readonly HashSet<string> inFlight = new HashSet<string>();
        /// <summary>Payload writers still running in this process (their record must not be judged "no payload").</summary>
        static readonly HashSet<string> writing = new HashSet<string>();
        /// <summary>Per transaction: its retry backoff step and timer.</summary>
        static readonly Dictionary<string, KeyValuePair<int, Timer>> retries = new Dictionary<string, KeyValuePair<int, Timer>>();
        /// <summary>Records already reported to the app as pending (ambiguous), so a retry does not repeat it.</summary>
        static readonly HashSet<string> reportedPending = new HashSet<string>();

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
        static readonly string sessionKey = Native.LogonSessionKey(HelperIdentity.Sanitized);

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
                byte[] hash = Hash(dictated);
                Stopwatch watch = Stopwatch.StartNew();
                lock (gate) writing.Add(record.Id);
                record.PayloadWriter = new Thread(delegate () { WritePayload(record, saved, hash, watch); });
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
        /// False when a written-down transaction could not be journaled (the caller decides what that
        /// means: before our EmptyClipboard, no paste).
        /// </summary>
        public static bool Stage(PendingRecord record, string stage, uint sequenceAtStage = 0, uint sequenceAfterWrite = 0)
        {
            if (record == null) return true;
            record.Stage = stage;
            record.SequenceAtStage = sequenceAtStage;
            if (sequenceAfterWrite != 0) record.SequenceAfterWrite = sequenceAfterWrite;
            if (!record.Persisted) return true;
            if (TestMode.Env("DICTATION_HELPER_TEST_FAIL_JOURNAL") == stage) { Wire.Log("ERROR: the clipboard transaction stage could not be recorded: test"); return false; }
            try { WriteState(record); return true; }
            catch (Exception error) { Wire.Log("ERROR: the clipboard transaction stage could not be recorded: " + error.GetType().Name); return false; }
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
                try { WriteState(record); } catch (Exception error) { Wire.Log("ERROR: the kept clipboard record could not be updated: " + error.GetType().Name); }
                lock (gate) ScheduleRetry(record.Id, RetryKind.Failed);
            }
            else Wire.Log("the restore failed and the saved clipboard was memory-only (privacy marker): it cannot be retried later");
        }

        static void WriteState(PendingRecord record)
        {
            string json = Wire.Serialize(Wire.Fields(
                "id", record.Id,
                "pid", Process.GetCurrentProcess().Id,
                "stage", record.Stage,
                "sequenceAtStage", (double)record.SequenceAtStage,
                "sequenceAfterWrite", (double)record.SequenceAfterWrite,
                "originStage", record.OriginStage ?? "",
                "originSequenceAtStage", (double)record.OriginSequenceAtStage,
                "unrestored", record.Unrestored,
                "delivery", record.DeliveryId ?? "",
                "ownerWindow", Ui.ClipboardWindow.ToInt64().ToString("x"),
                "session", session,
                "logon", logon,
                "sessionKey", sessionKey,
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

        static void TryDelete(string path)
        {
            try { if (File.Exists(path)) File.Delete(path); }
            catch (Exception error) { Wire.Log("ERROR: " + Path.GetFileName(path) + " could not be deleted: " + error.GetType().Name); }
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
            lock (gate) CancelRetry(record.Id);
            Wire.Log("clipboard record " + record.Id.Substring(0, 8) + " deleted: " + why);
        }

        static void DeleteId(string id, string why)
        {
            DeleteFiles(id);
            CancelRetry(id);
            Wire.Log("clipboard record " + id.Substring(0, Math.Min(8, id.Length)) + " deleted: " + why);
        }

        static void DeleteFiles(string id)
        {
            foreach (string path in new[] { PayloadPath(id), PayloadPath(id) + ".tmp", StatePath(id), StatePath(id) + ".tmp" }) TryDelete(path);
        }

        /// <summary>What a check of a kept record came to (it decides the retry schedule).</summary>
        internal enum RecoverResult { Done, Failed, Pending, Busy }

        /// <summary>
        /// How a check moves the record's backoff: a failed restore attempt or an ambiguous state moves to
        /// the next step; a busy clipboard (or a delivery in flight) waits on the same step; a check from
        /// a start or a delivery leaves an existing schedule alone (it never consumes a step).
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
            if (step >= RetryDelaysMs.Length) { retries.Remove(id); Wire.Log("clipboard record " + id.Substring(0, 8) + ": retries used up; the next helper start checks it again"); return; }
            int delay = kind == RetryKind.Busy ? 1000 : RetryDelaysMs[step];
            Timer timer = new Timer(delegate { RetryOne(id); }, null, delay, Timeout.Infinite);
            retries[id] = new KeyValuePair<int, Timer>(step, timer);
        }

        internal const int KeepSchedule = -1;

        /// <summary>
        /// The rule (unit-tested): the backoff step after a check. A first schedule starts at step 0; a failed
        /// restore attempt or an ambiguous state moves on one step; a busy clipboard (or a delivery in flight)
        /// stays on its step; a check from a start or a delivery keeps an existing schedule (KeepSchedule).
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
                string verdict = RecoverOne(id, out result);
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
        /// Check every record that is not in flight here (Decide). Runs at start, before a delivery, and per
        /// record on its retry timer. Orphaned payloads (no state file, no running writer) and round-8 records
        /// are deleted. Only this identity's files are touched (exact names).
        /// </summary>
        public static void RecoverLeftover(string why)
        {
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
                    string verdict = RecoverOne(id, out result);
                    if (verdict != null) Wire.Log("clipboard record " + id.Substring(0, 8) + " (" + why + "): " + verdict);
                    AfterCheck(id, result, false);
                }
            }
        }

        /// <summary>Under gate. Null when there was nothing to say.</summary>
        static string RecoverOne(string id, out RecoverResult result)
        {
            result = RecoverResult.Done;
            Dictionary<string, object> state = null;
            try { state = Wire.Parse(File.ReadAllText(StatePath(id))); } catch (Exception) { }
            if (state == null) { DeleteId(id, "unreadable state"); return "unreadable state; deleted"; }
            RecordFacts facts = RecordFacts.Of(state);
            if (facts.Pid != Process.GetCurrentProcess().Id && HelperRunning(facts.Pid)) { result = RecoverResult.Busy; return "its helper (pid " + facts.Pid + ") still runs; left to it"; }
            if (facts.Stage == "saved") { DeleteId(id, "nothing had been emptied"); return "stage saved: nothing to put back"; }
            if (writing.Contains(id)) { result = RecoverResult.Busy; return "its payload is still being written; checked again later"; }
            SavedClipboard saved;
            string nonce;
            byte[] dictatedHash;
            try
            {
                FileInfo info = new FileInfo(PayloadPath(id));
                if (!info.Exists) { DeleteId(id, "no payload (the paste went ahead before it was written)"); return "ERROR: stage " + facts.Stage + " but no payload; cannot put back"; }
                if (info.Length > MaxRecordBytes) { DeleteId(id, "payload over the size cap"); return "ERROR: payload of " + info.Length + " bytes over the cap; not read"; }
                byte[] plain = ProtectedData.Unprotect(File.ReadAllBytes(PayloadPath(id)), Entropy, DataProtectionScope.CurrentUser);
                using (BinaryReader reader = new BinaryReader(new MemoryStream(plain), Encoding.UTF8))
                {
                    if (reader.ReadString() != "DNCB3" || reader.ReadString() != id) { DeleteId(id, "payload does not match"); return "ERROR: payload does not match its state"; }
                    nonce = reader.ReadString();
                    dictatedHash = reader.ReadBytes(32);
                    saved = SavedClipboard.ReadFrom(reader);
                }
            }
            catch (Exception error) { DeleteId(id, "payload unreadable"); return "ERROR: payload unreadable (" + error.GetType().Name + ")"; }
            if (!ClipboardText.Open()) { result = RecoverResult.Busy; return "the clipboard is busy; kept for a retry"; }
            string outcome;
            try
            {
                ClipboardView view = ClipboardView.Read(saved, id, nonce, dictatedHash);
                LogonMatch match = facts.Compare(session, logon, sessionKey);
                RecoveryVerdict verdict = Decide(facts, view, match);
                string seen = view.Describe() + "; sequence " + view.Sequence + ", recorded " + facts.Stage + " " + facts.SequenceAtStage + "/" + facts.SequenceAfterWrite
                    + (facts.OriginStage.Length > 0 ? " (found " + facts.OriginStage + " " + facts.OriginSequenceAtStage + ")" : "") + ", logon " + match.ToString().ToLowerInvariant();
                if (verdict == RecoveryVerdict.Stale) { DeleteId(id, "stale"); return "stale (" + seen + "); left as it is"; }
                if (verdict == RecoveryVerdict.Untouched) { DeleteId(id, "nothing of the user's was emptied"); return "untouched (" + seen + "): the user's content is still there"; }
                if (verdict == RecoveryVerdict.Pending)
                {
                    result = RecoverResult.Pending;
                    if (reportedPending.Add(id)) Wire.Send(Wire.Fields("event", "clipboard", "phase", "pending", "id", facts.Delivery, "clipboard", "unrestored"));
                    return "pending (" + seen + "): ambiguous, kept and left as it is";
                }
                // Journaled like a delivery, keeping what it found: an interrupted recovery is itself recoverable,
                // and "unchanged since this journal" is judged by the stage it found.
                PendingRecord journal = new PendingRecord(id, nonce) { Persisted = true, SequenceAfterWrite = facts.SequenceAfterWrite, DeliveryId = facts.Delivery, Unrestored = facts.Unrestored };
                journal.OriginStage = facts.OriginStage.Length > 0 ? facts.OriginStage : facts.Stage;
                journal.OriginSequenceAtStage = facts.OriginStage.Length > 0 ? facts.OriginSequenceAtStage : facts.SequenceAtStage;
                Stage(journal, "recovering", view.Sequence);
                int beforeEmpty = TestMode.Int("DICTATION_HELPER_TEST_RECOVERY_STALL_BEFORE_EMPTY_MS", 0);
                if (beforeEmpty > 0) Thread.Sleep(beforeEmpty); // test build only: die before the recovery empties
                if (TestMode.Env("DICTATION_HELPER_TEST_FAIL_RECOVERY_EMPTY") == "1" || !Native.EmptyClipboard())
                {
                    result = RecoverResult.Failed;
                    return "the clipboard could not be emptied; kept for a retry (" + verdict + ")";
                }
                Stage(journal, "recovering-emptied", Native.GetClipboardSequenceNumber());
                int stall = TestMode.Int("DICTATION_HELPER_TEST_RECOVERY_STALL_MS", 0);
                if (stall > 0) Thread.Sleep(stall); // test build only: die with the clipboard emptied by the recovery
                string restored = saved.PutBackResult(saved.PutBackOpen());
                if (restored == "unrestored") { result = RecoverResult.Failed; return "put back only in part; kept for a retry (" + verdict + ")"; }
                outcome = "put back (" + verdict + "; " + seen + "): " + restored;
                DeleteId(id, outcome);
                reportedPending.Remove(id);
                Wire.Send(Wire.Fields("event", "clipboard", "phase", "recovered", "id", facts.Delivery, "record", id.Substring(0, 8), "clipboard", restored));
            }
            finally { Native.CloseClipboard(); }
            return outcome;
        }

        public enum RecoveryVerdict { Stale, Untouched, Pending, OursBySequence, OursByWrite, InterruptedEmpty, InterruptedWrite, InterruptedRestore }

        /// <summary>
        /// The rule (unit-tested). Restore only on evidence specific to THIS transaction, within the same logon:
        ///  - a live owner that is not ours: stale; another logon (or boot): stale; an unknown logon: pending;
        ///  - our complete write (sentinel with this transaction's nonce, our exact markers, our text by its
        ///    hash, nothing else but what Windows synthesizes from it): ours, at any stage after "saved";
        ///  - stages journaled BEFORE an EmptyClipboard of ours (emptying, restoring, recovering), with N:
        ///    unchanged at N: as journaled (emptying: the user's content is still there, nothing to do;
        ///    restoring: our write). Empty at N+1: ours or a deliberate clear, which cannot be told apart:
        ///    pending (kept, never restored over). A recovery is otherwise judged by the stage it found;
        ///  - stages journaled AFTER an EmptyClipboard of ours under the same lock (emptied, restore-emptied,
        ///    recovering-emptied), with M: empty at exactly M is our empty; otherwise only our write (emptied)
        ///    or only the saved content, compared (any of them), at a sequence within the operations that
        ///    could follow (M + WriteOps, or M + the restore's operations, plus one per synthesized format
        ///    present, which Windows renders on a first read) is ours cut short;
        ///  - written: the sequence read inside our write's lock, unchanged;
        ///  - anything else (including a clipboard someone emptied or filled since): stale.
        /// </summary>
        public static RecoveryVerdict Decide(RecordFacts facts, ClipboardView view, LogonMatch logonMatch)
        {
            if (view.OwnerAlive && !view.OwnerIsUs) return RecoveryVerdict.Stale;
            string stage = facts.Stage;
            if (stage == "saved") return RecoveryVerdict.Untouched;
            if (logonMatch == LogonMatch.Different) return RecoveryVerdict.Stale;
            if (logonMatch == LogonMatch.Unknown) return RecoveryVerdict.Pending;
            if (view.OurWrite == OurWrite.Complete) return RecoveryVerdict.OursByWrite;
            uint at = facts.SequenceAtStage;
            bool empty = view.FormatCount == 0;
            switch (stage)
            {
                case "emptying":
                    if (view.Sequence == at) return RecoveryVerdict.Untouched;
                    return empty && view.Sequence == at + 1 ? RecoveryVerdict.Pending : RecoveryVerdict.Stale;
                case "restoring":
                    if (view.Sequence == at) return RecoveryVerdict.OursBySequence;
                    return empty && view.Sequence == at + 1 ? RecoveryVerdict.Pending : RecoveryVerdict.Stale;
                case "recovering":
                    // An empty clipboard right after the recovery journaled: its own empty or a deliberate clear.
                    if (empty && view.Sequence == at + 1) return RecoveryVerdict.Pending;
                    // Otherwise judge by what the recovery found, with that stage's own evidence (one level only).
                    if (facts.OriginStage.Length == 0 || facts.OriginStage == "recovering") return RecoveryVerdict.Pending;
                    return Decide(facts.AsOrigin(), view, logonMatch);
                case "emptied":
                case "restore-emptied":
                case "recovering-emptied":
                    if (at == 0) return RecoveryVerdict.Stale;
                    if (empty) return view.Sequence == at ? RecoveryVerdict.InterruptedEmpty : RecoveryVerdict.Stale;
                    // Bounds: the operations that could follow our empty, plus one per synthesized format present (Windows
                    // renders a synthesized format on its first read, and that moves the sequence number too).
                    if (view.OurWrite == OurWrite.Partial && view.Sequence > at && view.Sequence <= at + WriteOps + (uint)view.SynthesizedPresent) return RecoveryVerdict.InterruptedWrite;
                    if (view.OnlySavedFormats && view.Sequence > at && view.Sequence <= at + (uint)view.RestoreOps + (uint)view.SynthesizedPresent) return RecoveryVerdict.InterruptedRestore;
                    return RecoveryVerdict.Stale;
                case "written":
                case "unrestored": // a round-10 record
                    return facts.SequenceAfterWrite != 0 && view.Sequence == facts.SequenceAfterWrite ? RecoveryVerdict.OursBySequence : RecoveryVerdict.Stale;
            }
            return RecoveryVerdict.Stale;
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
    internal enum LogonMatch { Same, Different, Unknown }

    /// <summary>What a record's state file says.</summary>
    internal sealed class RecordFacts
    {
        public string Stage = "saved";
        public int Pid;
        public uint SequenceAtStage, SequenceAfterWrite;
        public string OriginStage = "";
        public uint OriginSequenceAtStage;
        public bool Unrestored;
        public string Delivery = "";
        public int Session = -1;
        public string Logon = "";
        public string SessionKey = "";

        public static RecordFacts Of(Dictionary<string, object> state)
        {
            RecordFacts facts = new RecordFacts();
            facts.Stage = Wire.Str(state, "stage") ?? "saved";
            facts.Pid = (int)(Wire.Num(state, "pid") ?? 0);
            facts.SequenceAtStage = (uint)(Wire.Num(state, "sequenceAtStage") ?? 0);
            facts.SequenceAfterWrite = (uint)(Wire.Num(state, "sequenceAfterWrite") ?? 0);
            facts.OriginStage = Wire.Str(state, "originStage") ?? "";
            facts.OriginSequenceAtStage = (uint)(Wire.Num(state, "originSequenceAtStage") ?? 0);
            facts.Unrestored = Wire.Bool(state, "unrestored") ?? false;
            facts.Delivery = Wire.Str(state, "delivery") ?? "";
            facts.Session = (int)(Wire.Num(state, "session") ?? -1);
            facts.Logon = Wire.Str(state, "logon") ?? "";
            facts.SessionKey = Wire.Str(state, "sessionKey") ?? "";
            return facts;
        }

        /// <summary>The stage a recovery found, judged as if the recovery had not journaled.</summary>
        public RecordFacts AsOrigin()
        {
            RecordFacts origin = (RecordFacts)MemberwiseClone();
            origin.Stage = OriginStage;
            origin.SequenceAtStage = OriginSequenceAtStage;
            origin.OriginStage = "";
            origin.OriginSequenceAtStage = 0;
            return origin;
        }

        /// <summary>
        /// Same logon: the same window-station session, logon session (LUID) and per-logon key (a volatile
        /// registry value, gone at logoff and reboot; LUIDs alone can repeat across boots). Only then do
        /// clipboard sequence numbers compare. Different when any of them differs; Unknown when the record
        /// or this helper could not read one (never a reason to delete the only backup: pending). The wall
        /// clock is not used, so a clock correction changes nothing.
        /// </summary>
        public LogonMatch Compare(int session, string logon, string sessionKey)
        {
            if (Session >= 0 && Session != session) return LogonMatch.Different;
            if (Logon.Length > 0 && logon.Length > 0 && Logon != logon) return LogonMatch.Different;
            if (SessionKey.Length > 0 && sessionKey.Length > 0 && SessionKey != sessionKey) return LogonMatch.Different;
            if (Session < 0 || Logon.Length == 0 || logon.Length == 0 || SessionKey.Length == 0 || sessionKey.Length == 0) return LogonMatch.Unknown;
            return LogonMatch.Same;
        }
    }

    /// <summary>What a clipboard holds against our write (see ClipboardView.OurWrite).</summary>
    internal enum OurWrite { None, Partial, Complete }

    /// <summary>What recovery sees on the (open) clipboard; read without asking any live owner to render.</summary>
    internal sealed class ClipboardView
    {
        public bool OwnerAlive, OwnerIsUs, OnlySavedFormats;
        public OurWrite OurWrite;
        public uint Sequence;
        public int FormatCount;
        /// <summary>Clipboard operations a put-back of the saved content performs after its EmptyClipboard.</summary>
        public int RestoreOps;
        /// <summary>Present standard formats Windows may synthesize (each can move the sequence once when first read).</summary>
        public int SynthesizedPresent;

        public string Describe()
        {
            return "owner " + (OwnerIsUs ? "ours" : OwnerAlive ? "another app" : "none") + ", " + FormatCount + " format(s), our write "
                + OurWrite.ToString().ToLowerInvariant() + (FormatCount > 0 ? ", only saved formats " + (OnlySavedFormats ? "yes" : "no") : "");
        }

        /// <summary>Under the clipboard lock.</summary>
        public static ClipboardView Read(SavedClipboard saved, string recordId, string nonce, byte[] dictatedHash)
        {
            ClipboardView view = new ClipboardView();
            IntPtr owner = Native.GetClipboardOwner();
            view.OwnerIsUs = owner != IntPtr.Zero && owner == Ui.ClipboardWindow;
            view.OwnerAlive = owner != IntPtr.Zero && Native.IsWindow(owner);
            view.Sequence = Native.GetClipboardSequenceNumber();
            view.RestoreOps = saved.RestoreOps;
            List<uint> present = new List<uint>();
            for (uint f = Native.EnumClipboardFormats(0); f != 0; f = Native.EnumClipboardFormats(f)) present.Add(f);
            view.FormatCount = present.Count;
            foreach (uint f in present) if (SavedClipboard.MaybeSynthesized(f) && !saved.Has(f)) view.SynthesizedPresent++;
            // A live owner that is not ours could render on demand: never read its data.
            if (view.OwnerAlive && !view.OwnerIsUs) return view;
            Func<uint, int, byte[]> read = delegate (uint f, int cap) { return ClipboardText.ReadBytes(f, cap); };
            view.OurWrite = ClipboardText.ClassifyOurWrite(present, read, recordId, nonce, dictatedHash);
            view.OnlySavedFormats = present.Count > 0 && saved.MatchesOpenClipboard();
            return view;
        }
    }
}
