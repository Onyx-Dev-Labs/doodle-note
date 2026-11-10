using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
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
        /// <summary>The first offer (sequence, tick, boot), kept through every journal write once set.</summary>
        public uint OfferedSequence;
        public long OfferedTick;
        public string OfferedBoot = "";
        public string OfferedUtc = "";
        public int OfferBoots;
        /// <summary>The tick count (since boot) when the transaction began: a smaller one now means a new boot.</summary>
        public long CreatedTick = (long)Native.GetTickCount64();
        /// <summary>Guards publication of the payload against settlement (a settled record is never published).</summary>
        public readonly object Gate = new object();
        public bool Settled;
        public Thread PayloadWriter;
        /// <summary>Round 33: the payload was moved into place (under Gate): the precondition of our EmptyClipboard.</summary>
        public volatile bool PayloadPublished;
        /// <summary>Round 33: Begin's writer has finished (under Gate): whoever sees the other's flag removes the files.</summary>
        public bool WriterDone;
        /// <summary>
        /// OFFER-ONLY (round 17): once set, never cleared (only the record's deletion removes it). The record can then only
        /// be offered (or deleted when the clipboard already holds exactly the saved content): no automatic restore, by
        /// any proof, in this helper or any later one. Persisted with every state write.
        /// </summary>
        public bool OfferOnly;
        public string OfferOnlyWhy = "";
        /// <summary>A state rebuilt from its payload: written with an UNKNOWN identity (session -1, no logon, pid 0).</summary>
        public bool IdentityUnknown;
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
        /// <summary>Round 22 (S3): part of this clipboard could not be saved or read back; Missing names what (the card says so).</summary>
        public bool Incomplete;
        public List<string> Missing = new List<string>();
        /// <summary>Round 24 (Opus): how many formats with the user's CONTENT a Restore can put back (Formats also counts
        /// flags and CF_LOCALE).</summary>
        public int Content;
        /// <summary>The first offer's tick and boot (kept in memory too, in case the state file could not take them).</summary>
        public long Tick;
        public string Boot = "";

        public Dictionary<string, object> Fields()
        {
            return Wire.Fields("record", Record, "delivery", Delivery ?? "", "formats", Formats, "bytes", (double)Bytes,
                "sequence", (double)Sequence, "created", Created.ToString("o"), "likelyOurs", LikelyOurs,
                "incomplete", Incomplete, "missing", Missing, "content", Content);
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
    /// The state file journals the transaction's stage (round 33: two DURABLE writes, the rest diagnostics). DURABLE
    /// (flushed, outside every clipboard open and outside the paste's 1 s): the first state, "emptying" ("may be
    /// emptied"), written with the payload in Begin BEFORE any EmptyClipboard of ours (both on disk is its precondition);
    /// and "settled", written before a restored record is deleted. DIAGNOSTIC (no flush, queued to one serialized
    /// background writer, written after the clipboard is closed, their failure never changes behaviour): emptied,
    /// written, restore-emptied, recovering-emptied, and the offer-only and unrestored facts of a live record. No stage
    /// is a proof of anything (round 18); recovery decides by content (Decide), never by stage, except "settled". Every record carries its logon
    /// identity: the window-station session, the logon session (LUID), a per-logon key in a volatile
    /// registry key, Windows' boot counter and the tick count; the wall clock is never part of it.
    ///
    /// POLICY (round 18). No automatic restore authority ever comes from disk: a record read back here is OFFERED
    /// (Decide), except another session's (left alone) and one whose saved content is already exactly on the clipboard
    /// (deleted, nothing written). The only automatic restore is the live transaction's own, in the process that wrote
    /// (SavedClipboard.Restore, behind its one guard). The app offers the user a Restore (a journaled transaction of
    /// its own, run only if the clipboard is still as it was when offered) or a Dismiss. The full list of what deletes
    /// a record is in docs/WINDOWS-RELEASE-QA.md; retention and the boot limit are policies, not proofs the content is
    /// no longer wanted. The persisted offerOnly field is informational. The state file is validated strictly
    /// (RecordFacts.Validate): an invalid one proves nothing and never deletes a valid payload.
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
        /// <summary>
        /// Round 33: how long Begin waits for its durable state and payload to be on disk. Not met: the write is not
        /// established (nothing emptied, no paste), so the user's clipboard is never off the clipboard without being on
        /// disk (round 32 and earlier: the paste went ahead after 250 ms). Outside the paste's 1 s write budget.
        /// </summary>
        internal static int BeginDeadlineMs = TestMode.Int("DICTATION_HELPER_TEST_BEGIN_DEADLINE_MS", 2000);
        /// <summary>Why the last Begin on this thread was not established (null when it was).</summary>
        [ThreadStatic] internal static string LastBeginFailure;
        /// <summary>The private format our WRITE carries last ("&lt;record id&gt;:&lt;nonce&gt;"). Restores never set it.</summary>
        public const string SentinelFormat = "DoodleNote.Bark.Transaction";
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
        /// <summary>Round 33: File.Replace's temporary of an earlier build, for one of this identity's states.</summary>
        static Regex ReplaceLeftover { get { return new Regex("^" + Regex.Escape(Prefix) + "[0-9a-f]{32}\\.state~RF[0-9a-f]+\\.TMP$", RegexOptions.IgnoreCase); } }

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

        /// <summary>Whether any file of a record with this id may be on disk (only a positive ABSENT counts as gone).</summary>
        internal static bool OnDisk(string id)
        {
            foreach (string path in new[] { StatePath(id), StatePath(id) + ".tmp", PayloadPath(id), PayloadPath(id) + ".tmp" })
                if (Probe(path) != Presence.Absent) return true;
            return false;
        }

        /// <summary>What a look at a path proves (round 18): File.Exists is false on ANY error, which is no proof of absence.</summary>
        internal enum Presence { Absent, Present, Unknown }

        /// <summary>The rule (unit-tested): ABSENT only for ERROR_FILE_NOT_FOUND / ERROR_PATH_NOT_FOUND; any other error is UNKNOWN.</summary>
        internal static Presence ClassifyPresence(uint attributes, int error)
        {
            if (attributes != 0xFFFFFFFFu) return Presence.Present;
            return error == 2 || error == 3 ? Presence.Absent : Presence.Unknown;
        }

        /// <summary>
        /// Every destructive or deletion-deciding look at a record file goes through this: "missing payload" cleanup,
        /// adoption's "none", the orphan sweeps and the deletion's own verification act only on ABSENT; UNKNOWN keeps the
        /// record whole (bounded by the unreadable-payload policy).
        /// </summary>
        internal static Presence Probe(string path)
        {
            string unknown = TestMode.Env("DICTATION_HELPER_TEST_PROBE_UNKNOWN"); // test build only: metadata unreadable
            if (!string.IsNullOrEmpty(unknown) && path.EndsWith(unknown, StringComparison.Ordinal)) return Presence.Unknown;
            uint attributes = Native.GetFileAttributesW(path);
            return ClassifyPresence(attributes, attributes == 0xFFFFFFFFu ? Marshal.GetLastWin32Error() : 0);
        }

        /// <summary>
        /// Start a transaction before our write. Content with a privacy marker stays in memory only.
        /// Otherwise (round 33) the first durable state ("emptying") and then the payload are written, flushed, on their
        /// own thread; Begin waits for both at most BeginDeadlineMs. Null when they are not on disk by then, or cannot be
        /// written at all: no paste, nothing emptied (LastBeginFailure says why).
        /// </summary>
        public static PendingRecord Begin(SavedClipboard saved, string dictated)
        {
            LastBeginFailure = null;
            PendingRecord record = new PendingRecord();
            record.DeliveryId = Delivery.CurrentRequestId ?? "";
            record.DictatedHash = Hash(dictated);
            lock (gate) inFlight.Add(record.Id);
            if (saved.PrivacyMarked)
            {
                Wire.Log("the saved clipboard carries a privacy marker: kept in memory only (not written down)");
                return record;
            }
            record.Persisted = true;
            // Round 33: the first state says "may be emptied" (there is no durable "saved" stage any more): a crash from
            // here on leaves a record that recovery judges by CONTENT only (already there exactly: deleted; anything
            // else: offered), never by its stage.
            record.Stage = "emptying";
            string json = StateJson(record);
            Stopwatch watch = Stopwatch.StartNew();
            lock (gate) writing.Add(record.Id);
            bool stateOk = false;
            // State first, then the payload, one after the other (a payload never exists without its state), on their own
            // thread so that a stalled disk cannot hold the delivery past BeginDeadlineMs.
            record.PayloadWriter = new Thread(delegate ()
            {
                try
                {
                    stateOk = WriteStateDurable(record, json, "emptying");
                    if (stateOk) WritePayload(record, saved, record.DictatedHash, watch);
                    else lock (gate) writing.Remove(record.Id);
                }
                catch (Exception error)
                {
                    Wire.Log("ERROR: the clipboard transaction could not be written down: " + error.GetType().Name);
                    lock (gate) writing.Remove(record.Id);
                }
                finally
                {
                    // Begin gave up meanwhile (it saw this writer still running): this writer removes what it published.
                    bool givenUp;
                    lock (record.Gate) { record.WriterDone = true; givenUp = record.Settled; }
                    if (givenUp) RemoveNotEstablished(record);
                }
            });
            record.PayloadWriter.IsBackground = true;
            record.PayloadWriter.Name = "pending-clipboard";
            record.PayloadWriter.Start();
            bool done = record.PayloadWriter.Join(BeginDeadlineMs);
            if (done && stateOk && record.PayloadPublished)
            {
                Wire.Log("the clipboard transaction was written down in " + watch.ElapsedMilliseconds + " ms (state and payload, flushed)");
                return record;
            }
            string why = !done ? "not on disk within " + BeginDeadlineMs + " ms" : !stateOk ? "its state could not be written" : "its payload could not be written";
            LastBeginFailure = why;
            // Settled under the publication lock: a writer still running publishes nothing from now on; what it already
            // published is removed, by Begin if the writer is done, else by the writer when it ends (exactly one of them
            // sees the other's flag). A crash meanwhile leaves a record judged by content: nothing was emptied.
            bool writerDone;
            lock (record.Gate) { record.Settled = true; writerDone = record.WriterDone; }
            lock (gate) inFlight.Remove(record.Id);
            Wire.Log("not pasting: the clipboard transaction was not written down (" + why + "); nothing emptied");
            if (writerDone) RemoveNotEstablished(record);
            return null;
        }

        static void RemoveNotEstablished(PendingRecord record)
        {
            lock (gate)
            {
                bool gone = DeleteFiles(record.Id);
                if (!gone) NotDeleted(record.Id, "a transaction that was not established");
                else Wire.Log("clipboard record " + record.Id.Substring(0, 8) + ": not established; its files removed");
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
                // Round 33: flushed (it is the precondition of our EmptyClipboard: on disk means on disk).
                using (FileStream stream = new FileStream(tmp, FileMode.Create, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
                {
                    stream.Write(sealedBytes, 0, sealedBytes.Length);
                    stream.Flush(true);
                }
                // A slow disk / AV scan: set by the test build's hook, or directly by the logic tests (which are not a
                // DICTATION_TEST build, so not through TestMode.Stall); always 0 in a release build.
                if (TestPayloadDelayMs > 0) { TestMode.Trace("stall PAYLOAD_DELAY_MS " + TestPayloadDelayMs + " ms"); Thread.Sleep(TestPayloadDelayMs); }
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
                    record.PayloadPublished = true;
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
        /// Round 33: a DIAGNOSTIC stage of a live transaction (emptied, written, restore-emptied): its fields are set now
        /// and a snapshot of the state is queued to the journal writer (no flush). Its failure never changes behaviour;
        /// it is never written inside a clipboard open (the writer thread never opens the clipboard). Always true (the
        /// return value is kept for the callers' shape).
        /// </summary>
        public static bool Stage(PendingRecord record, string stage, uint sequenceAtStage = 0, uint sequenceAfterWrite = 0)
        {
            if (record == null) return true;
            record.Stage = stage;
            record.SequenceAtStage = sequenceAtStage;
            record.SequenceClosed = 0;
            if (sequenceAfterWrite != 0) record.SequenceAfterWrite = sequenceAfterWrite;
            QueueSnapshot(record, false, null);
            return true;
        }

        /// <summary>
        /// Round 33 (g): a snapshot of the record's state now (immutable: serialized at the call), written later by the one
        /// serialized writer, flushed or not. A record settled meanwhile is never written again (an older queued write can
        /// never overwrite settlement or recreate a deleted state). `then` runs after it on the writer, in order.
        /// </summary>
        static void QueueSnapshot(PendingRecord record, bool durable, Action then)
        {
            if (!record.Persisted) { if (then != null) EnqueueJournal(then); return; }
            string json = StateJson(record);
            string stage = record.Stage;
            EnqueueJournal(delegate
            {
                bool settled;
                lock (record.Gate) settled = record.Settled;
                if (!settled) WriteSnapshot(record.Id, json, stage, durable);
                if (then != null) then();
            });
        }

        /// <summary>Writes one snapshot now (the journal writer, or a recovery outside every open); false on failure.</summary>
        static bool WriteSnapshot(string id, string json, string stage, bool durable)
        {
            if (TestMode.Env("DICTATION_HELPER_TEST_FAIL_JOURNAL") == stage) { Wire.Log("ERROR: the clipboard transaction stage could not be recorded: test (" + stage + ")" + (durable ? "" : "; a diagnostic stage: nothing changes")); return false; }
            Stopwatch took = Stopwatch.StartNew();
            for (int attempt = 0; ; attempt++)
            {
                try
                {
                    WriteStateJson(StatePath(id), json, durable);
                    JournalTrace(id, stage, durable, took);
                    return true;
                }
                catch (Exception error)
                {
                    // A short retry: an AV scan or an indexer can hold the state file for a moment.
                    if (attempt >= 2 || !(error is IOException || error is UnauthorizedAccessException))
                    {
                        Wire.Log("ERROR: the clipboard transaction stage could not be recorded: " + error.GetType().Name + (durable ? "" : "; a diagnostic stage: nothing changes"));
                        return false;
                    }
                    Thread.Sleep(attempt == 0 ? 15 : 40);
                }
            }
        }

        /// <summary>
        /// Round 33: every state write says where it ran (test build), and a write made by a thread that holds the
        /// clipboard open is an error (never expected: the timelines' check in CI).
        /// </summary>
        static void JournalTrace(string id, string stage, bool durable, Stopwatch took)
        {
            bool inOpen = ClipboardText.OpenOnThisThread;
            TestMode.Trace("journal " + stage + " " + id.Substring(0, Math.Min(8, id.Length)) + " durable=" + durable + " in-open=" + inOpen + " took " + took.ElapsedMilliseconds + " ms");
        }

        /// <summary>The first durable state (Begin): published under the record's lock unless it was settled meanwhile.</summary>
        static bool WriteStateDurable(PendingRecord record, string json, string stage)
        {
            if (TestMode.Env("DICTATION_HELPER_TEST_FAIL_JOURNAL") == stage) { Wire.Log("ERROR: the clipboard transaction could not be written down: test (" + stage + ")"); return false; }
            Stopwatch took = Stopwatch.StartNew();
            for (int attempt = 0; ; attempt++)
            {
                try
                {
                    WriteStateJson(StatePath(record.Id), json, true, record);
                    JournalTrace(record.Id, stage, true, took);
                    lock (record.Gate) return !record.Settled;
                }
                catch (Exception error)
                {
                    if (attempt >= 2 || !(error is IOException || error is UnauthorizedAccessException))
                    {
                        Wire.Log("ERROR: the clipboard transaction could not be written down: " + error.GetType().Name);
                        return false;
                    }
                    Thread.Sleep(attempt == 0 ? 15 : 40);
                }
            }
        }

        // ---- Round 33 (g): the journal's one serialized background writer ----
        static readonly object journalGate = new object();
        static readonly Queue<Action> journalQueue = new Queue<Action>();
        static Thread journalThread;
        static int journalPending;

        static void EnqueueJournal(Action work)
        {
            lock (journalGate)
            {
                journalQueue.Enqueue(work);
                journalPending++;
                if (journalThread == null)
                {
                    journalThread = new Thread(JournalLoop);
                    journalThread.IsBackground = true;
                    journalThread.Name = "clipboard-journal";
                    journalThread.Start();
                }
                Monitor.PulseAll(journalGate);
            }
        }

        static void JournalLoop()
        {
            for (;;)
            {
                Action work;
                lock (journalGate)
                {
                    while (journalQueue.Count == 0) Monitor.Wait(journalGate);
                    work = journalQueue.Dequeue();
                }
                try
                {
                    // Test build only: a stalled disk under the journal (the delivery must not wait for it).
                    TestMode.Stall("JOURNAL_STALL_MS", TestMode.Int("DICTATION_HELPER_TEST_JOURNAL_STALL_MS", 0));
                    work();
                }
                catch (Exception error) { Wire.Log("ERROR: a clipboard journal step failed (" + error.GetType().Name + ")"); }
                finally { lock (journalGate) { journalPending--; Monitor.PulseAll(journalGate); } }
            }
        }

        /// <summary>How many payload writers still run in this process (the logic tests).</summary>
        internal static int WritersRunning() { lock (gate) return writing.Count; }

        /// <summary>Waits (bounded) until every queued journal step ran: the helper's exit, and the logic tests.</summary>
        public static bool DrainJournal(int ms)
        {
            Stopwatch waited = Stopwatch.StartNew();
            lock (journalGate)
            {
                while (journalPending > 0)
                {
                    int left = ms - (int)waited.ElapsedMilliseconds;
                    if (left <= 0) return false;
                    Monitor.Wait(journalGate, left);
                }
                return true;
            }
        }

        /// <summary>The record is kept, as an offer only (offer-only is persisted first): checked again later.</summary>
        public static void Keep(PendingRecord record, string why)
        {
            if (record == null) return;
            // Round 22 (nit): the record leaves in-flight whatever the offer-only journal does. Round 33: the journal is
            // queued, and the record leaves in-flight only after it (in order, on the writer), so no check judges it before.
            bool mark = !record.OfferOnly;
            record.OfferOnly = true;
            if (mark) { record.OfferOnlyWhy = why ?? ""; Wire.Log("clipboard record " + record.Id.Substring(0, 8) + ": offer-only from now on (" + why + ")"); }
            QueueSnapshot(record, true, delegate { lock (gate) { inFlight.Remove(record.Id); ScheduleRetry(record.Id, RetryKind.Failed); } });
        }

        /// <summary>A restore result that leaves nothing to do later: anything but "unrestored" and "user-changed" (both keep the record).</summary>
        public static bool Settled(string restoreResult) { return restoreResult != "unrestored" && restoreResult != "user-changed"; }

        /// <summary>
        /// The record's offer-only fact, journaled (write-through). INFORMATIONAL since round 18: no record read from disk
        /// grants authority whatever it says; the live transaction's guard is SavedClipboard.LoseAuthority. A journal that
        /// fails is healed by the record's next state write.
        /// </summary>
        public static void MarkOfferOnly(PendingRecord record, string why)
        {
            if (record == null) return;
            if (record.OfferOnly) return;
            record.OfferOnly = true;
            record.OfferOnlyWhy = why ?? "";
            Wire.Log("clipboard record " + record.Id.Substring(0, 8) + ": offer-only from now on (" + why + ")");
            // Round 33: queued (it can be called while the clipboard is open, e.g. the write's own put-back); informational.
            QueueSnapshot(record, true, null);
        }

        /// <summary>Under gate: the offer-only fact for a record on disk (its state file is rewritten with it).</summary>
        static void MarkOfferOnlyOnDisk(string id, RecordFacts facts, string why)
        {
            if (facts.OfferOnly) return; // already on disk
            try
            {
                Dictionary<string, object> state = Wire.Parse(File.ReadAllText(StatePath(id)));
                if (state == null) return;
                state["offerOnly"] = true;
                state["offerOnlyWhy"] = why;
                WriteStateJson(StatePath(id), Wire.Serialize(state), true);
                facts.OfferOnly = true;
                facts.OfferOnlyWhy = why;
                Wire.Log("clipboard record " + id.Substring(0, 8) + ": offer-only from now on (" + why + ")");
            }
            catch (Exception error) { Wire.Log("ERROR: the offer-only fact could not be written down (" + error.GetType().Name + "); this helper keeps it in memory"); }
        }

        /// <summary>
        /// The transaction is over for this delivery: its record is deleted when the restore completed (or
        /// nothing was emptied), and kept for a retry when it did not (its stage still says where it stopped).
        /// </summary>
        public static void Finish(PendingRecord record, string restoreResult)
        {
            if (record == null) return;
            if (Settled(restoreResult))
            {
                // Journaled "settled" (DURABLE) and deleted BEFORE it leaves in-flight: a concurrent check never finds content
                // that was already put back and offers it (a "settled" state is deleted on sight, never offered). Round 33:
                // on the journal writer, after the clipboard is closed (never inside an open, never holding up the reply);
                // the record stays in flight until then. A crash in that wider interval leaves a record judged by content
                // (already there: deleted; else a spurious offer, never a loss). It leaves in-flight whatever happens.
                if (!record.Persisted) { lock (gate) inFlight.Remove(record.Id); return; }
                record.Stage = "settled";
                string json = StateJson(record);
                EnqueueJournal(delegate
                {
                    try
                    {
                        bool settledBefore;
                        lock (record.Gate) settledBefore = record.Settled;
                        if (!settledBefore && !WriteSnapshot(record.Id, json, "settled", true)) Wire.Log("the settled stage could not be journaled; deleting anyway");
                        Delete(record, "restore ran (" + restoreResult + ")");
                    }
                    finally { lock (gate) inFlight.Remove(record.Id); }
                });
                return;
            }
            // Marked BEFORE it leaves in-flight: no concurrent check sees it unmarked (round 33: in order, on the writer).
            record.Unrestored = true;
            bool mark = !record.OfferOnly;
            record.OfferOnly = true;
            if (mark) { record.OfferOnlyWhy = "a restore that did not complete (" + restoreResult + ")"; Wire.Log("clipboard record " + record.Id.Substring(0, 8) + ": offer-only from now on (" + record.OfferOnlyWhy + ")"); }
            if (record.Persisted) QueueSnapshot(record, true, delegate { lock (gate) { inFlight.Remove(record.Id); ScheduleRetry(record.Id, RetryKind.Failed); } });
            else
            {
                lock (gate) inFlight.Remove(record.Id);
                Wire.Log("the restore failed and the saved clipboard was memory-only (privacy marker): it cannot be retried later");
            }
        }

        /// <summary>The record's state as it is now (a snapshot: serialized here, written later or now).</summary>
        static string StateJson(PendingRecord record)
        {
            return Wire.Serialize(Wire.Fields(
                "format", Format,
                "id", record.Id,
                "pid", record.IdentityUnknown ? 0 : Process.GetCurrentProcess().Id,
                "pidStart", record.IdentityUnknown ? 0.0 : (double)Process.GetCurrentProcess().StartTime.ToUniversalTime().Ticks,
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
                "session", record.IdentityUnknown ? -1 : session,
                "logon", record.IdentityUnknown ? "" : logon,
                "sessionKey", record.IdentityUnknown ? "" : SessionKey.Key,
                "bootId", record.IdentityUnknown ? "" : bootId,
                "tick", (double)record.CreatedTick,
                "boot", Native.BootTimeUtc.ToString("o"),
                "created", record.CreatedUtc.ToString("o"),
                "offeredSequence", (double)record.OfferedSequence,
                "offeredTick", (double)record.OfferedTick,
                "offeredBoot", record.OfferedBoot ?? "",
                "offered", record.OfferedUtc ?? "",
                "offerBoots", record.OfferBoots,
                "offerOnly", record.OfferOnly,
                "offerOnlyWhy", record.OfferOnlyWhy ?? "",
                "updated", DateTime.UtcNow.ToString("o")));
        }

        static void WriteState(PendingRecord record) { WriteStateJson(StatePath(record.Id), StateJson(record), true); }

        /// <summary>
        /// A state file written through its .tmp. DURABLE: flushed to the disk before it replaces the state file (a crash
        /// never leaves a zeroed journal). Round 33: a diagnostic write is not flushed (a crash may lose it; nothing
        /// depends on it). With `publish`, the move happens under its lock and only while it is not settled.
        /// </summary>
        static void WriteStateJson(string path, string json, bool durable, PendingRecord publish = null)
        {
            // Round 33: EVERY state write (also a recovery's offer facts and offer-only marks) is checked: never inside a
            // clipboard open (the CI run fails on this line).
            if (ClipboardText.OpenOnThisThread) Wire.Log("ERROR: a clipboard journal write ran inside a clipboard open (" + Path.GetFileName(path) + ")");
            string tmp = path + ".tmp";
            byte[] bytes = Encoding.UTF8.GetBytes(json);
            using (FileStream stream = new FileStream(tmp, FileMode.Create, FileAccess.Write, FileShare.None, 4096, durable ? FileOptions.WriteThrough : FileOptions.None))
            {
                stream.Write(bytes, 0, bytes.Length);
                if (durable) stream.Flush(true);
            }
            // Test build only (round 30): killed with the state's .tmp written and not yet in place (CI run 42842819157).
            TestMode.Stall("STATE_TMP_STALL_MS", TestMode.Int("DICTATION_HELPER_TEST_STATE_TMP_STALL_MS", 0));
            if (publish == null) { MoveIntoPlace(tmp, path, durable); return; }
            lock (publish.Gate)
            {
                if (publish.Settled) { TryDelete(tmp); return; }
                MoveIntoPlace(tmp, path, durable);
            }
        }

        /// <summary>
        /// Round 33: the .tmp renamed over the state in ONE step (MoveFileEx, replace-existing; write-through for a durable
        /// write). Until round 32 File.Replace, which moves the old state aside to a "~RF....TMP" file first: CI run
        /// 42883988202 found such files left by a helper killed during a (then newly asynchronous) journal write, and a
        /// kill between its steps could leave the state missing (its payload then swept as an orphan).
        /// </summary>
        static void MoveIntoPlace(string tmp, string path, bool durable)
        {
            uint flags = Native.MOVEFILE_REPLACE_EXISTING | (durable ? Native.MOVEFILE_WRITE_THROUGH : 0u);
            if (!Native.MoveFileExW(tmp, path, flags)) throw new IOException("the state could not be moved into place (error " + Marshal.GetLastWin32Error() + ")");
        }

        static bool TryDelete(string path)
        {
            try { File.Delete(path); return true; } // a missing file is not an error
            catch (Exception error) { Wire.Log("ERROR: " + Path.GetFileName(path) + " could not be deleted: " + error.GetType().Name); return false; }
        }

        static void Delete(PendingRecord record, string why)
        {
            // Settled first, under the publication lock: a payload writer still running cannot publish now.
            bool deleted;
            lock (record.Gate)
            {
                record.Settled = true;
                deleted = DeleteFiles(record.Id);
            }
            if (record.PayloadWriter != null && !record.PayloadWriter.Join(2000))
                Wire.Log("the payload writer of record " + record.Id.Substring(0, 8) + " is still running; it will not publish");
            if (!deleted)
            {
                lock (gate) { NotDeleted(record.Id, why); ScheduleRetry(record.Id, RetryKind.Check); }
                return;
            }
            lock (gate) { CancelRetry(record.Id); OfferGone(record.Id, "settled"); }
            Wire.Log("clipboard record " + record.Id.Substring(0, 8) + " deleted: " + why);
        }

        /// <summary>Under gate.</summary>
        static bool DeleteId(string id, string why)
        {
            bool deleted = DeleteFiles(id);
            if (!deleted) { NotDeleted(id, why); return false; }
            CancelRetry(id);
            OfferGone(id, why);
            Wire.Log("clipboard record " + id.Substring(0, Math.Min(8, id.Length)) + " deleted: " + why);
            return true;
        }

        /// <summary>
        /// Under gate: a deletion that did not complete, reported as it is. Intact: kept, checked again later. The state
        /// positively gone (a completed deletion that left the payload): no longer an offer (the card is withdrawn), the
        /// payload is an orphan swept after 10 minutes.
        /// </summary>
        static void NotDeleted(string id, string why)
        {
            string shortId = id.Substring(0, Math.Min(8, id.Length));
            if (Probe(StatePath(id)) == Presence.Absent)
            {
                Wire.Log("clipboard record " + shortId + " was deleted only in part (" + why + "): its state is gone, its payload is left (never restored from; swept after 10 minutes)");
                OfferGone(id, why);
                return;
            }
            Wire.Log("clipboard record " + shortId + " could not be deleted (" + why + "); kept whole, checked again later");
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
        /// A record's deletion. Every file (state .tmp, payload .tmp, state, payload, in that order) is opened with delete
        /// access and no sharing (another process holding any of them, an AV scan or an indexer, makes the whole deletion
        /// wait: nothing deleted), every handle is marked for deletion, and the close removes them. NOT atomic across the
        /// helper's death: the marks are honoured when a killed process's handles close, and they are set in that order,
        /// so a deletion cut short leaves either the whole record, or the payload WITHOUT its state, which is never restored
        /// from and is swept after 10 minutes (it completes a deletion already decided; never offered again). A mark that
        /// fails clears the marks already set; if clearing one fails too, that file goes at the close, so the deletion is
        /// completed instead (reported as such). False: something is left.
        /// </summary>
        static bool DeleteFiles(string id)
        {
            string[] paths = { StatePath(id) + ".tmp", PayloadPath(id) + ".tmp", StatePath(id), PayloadPath(id) };
            List<Microsoft.Win32.SafeHandles.SafeFileHandle> held = new List<Microsoft.Win32.SafeHandles.SafeFileHandle>();
            bool completing = false;
            try
            {
                foreach (string path in paths)
                {
                    Presence presence = Probe(path);
                    if (presence == Presence.Absent) continue;
                    if (presence == Presence.Unknown) { Wire.Log(Path.GetFileName(path) + " could not be looked at: nothing deleted, the record is kept whole"); return false; }
                    Microsoft.Win32.SafeHandles.SafeFileHandle handle = Native.CreateFileForDelete(path, Native.DELETE_ACCESS | Native.GENERIC_READ_ACCESS, 0, IntPtr.Zero, Native.OPEN_EXISTING_FILE, Native.FILE_ATTRIBUTE_NORMAL_, IntPtr.Zero);
                    if (handle.IsInvalid)
                    {
                        int error = Marshal.GetLastWin32Error();
                        handle.Dispose();
                        if (error == 2 || error == 3) continue; // gone meanwhile (ERROR_FILE_NOT_FOUND / PATH_NOT_FOUND)
                        Wire.Log(Path.GetFileName(path) + " could not be opened for deletion (error " + error + ": held by another process, or already pending deletion): nothing more is deleted now; what is there stays");
                        return false;
                    }
                    held.Add(handle);
                }
                Native.FILE_DISPOSITION_INFO mark = new Native.FILE_DISPOSITION_INFO { DeleteFile = 1 };
                Native.FILE_DISPOSITION_INFO keep = new Native.FILE_DISPOSITION_INFO { DeleteFile = 0 };
                // Test build only: clearing marks fails ("1": every one; otherwise a comma list of 1-based handle indexes).
                string hookUnmark = TestMode.Env("DICTATION_HELPER_TEST_FAIL_DELETE_UNMARK") ?? "";
                for (int i = 0; i < held.Count; i++)
                {
                    bool hook = TestMode.Env("DICTATION_HELPER_TEST_FAIL_DELETE_MARK") == (i + 1).ToString();
                    if (!hook && Native.SetFileInformationByHandle(held[i], Native.FileDispositionInfo, ref mark, 1))
                    {
                        // Test build only: be killed between two marks (the marks set so far are honoured at termination).
                        if (TestMode.Int("DICTATION_HELPER_TEST_DELETE_STALL_AFTER_MARK", 0) == i + 1) TestMode.Stall("DELETE_STALL_AFTER_MARK", 15000);
                        continue;
                    }
                    Wire.Log("a record file could not be marked for deletion (" + (hook ? "test hook" : "error " + Marshal.GetLastWin32Error()) + ")");
                    bool cleared = true;
                    for (int j = 0; j < i; j++)
                        if (hookUnmark == "1" || Array.IndexOf(hookUnmark.Split(','), (j + 1).ToString()) >= 0 || !Native.SetFileInformationByHandle(held[j], Native.FileDispositionInfo, ref keep, 1)) cleared = false;
                    if (cleared) { Wire.Log("every mark already set was cleared: nothing deleted, the record is kept whole"); return false; }
                    // A mark that could not be cleared: that file goes at the close. Complete the deletion instead, from the
                    // BEGINNING in the stated order (every handle marked again). Physically, an interruption still leaves the
                    // record intact, a payload without its state (swept), or a state without its payload (removed by recovery
                    // on a positive ABSENT); see the deletion contract in docs/WINDOWS-RELEASE-QA.md.
                    Wire.Log("ERROR: a deletion mark could not be cleared: completing the deletion instead");
                    completing = true;
                    for (int k = 0; k < held.Count; k++)
                        if (!Native.SetFileInformationByHandle(held[k], Native.FileDispositionInfo, ref mark, 1))
                            Wire.Log("ERROR: handle " + (k + 1) + " could not be marked again (error " + Marshal.GetLastWin32Error() + "): that file stays unless its earlier mark still holds; the files left are listed below");
                    break;
                }
            }
            finally { foreach (Microsoft.Win32.SafeHandles.SafeFileHandle handle in held) handle.Dispose(); }
            if (completing) foreach (string path in paths) TryDelete(path);
            bool left = false;
            foreach (string path in paths) if (Probe(path) != Presence.Absent) { Wire.Log("ERROR: " + Path.GetFileName(path) + " is still there (or cannot be looked at) after the deletion" + (path == PayloadPath(id) && Probe(StatePath(id)) == Presence.Absent ? " (a payload without its state: never restored from, swept after 10 minutes)" : "")); left = true; }
            return !left;
        }

        /// <summary>What a check of a kept record came to (it decides the retry schedule).</summary>
        internal enum RecoverResult { Done, Failed, Pending, Busy, Foreign }

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
            // A check that could not decide now (the clipboard busy, a file or the key unavailable) backs off like a pending one:
            // 3, 10, 30, 60, 120 s, then the next helper start; never a tight loop. (RetryKind.Busy, 1 s on the same step, is
            // only for waiting out a delivery of ours in flight.)
            return result == RecoverResult.Failed ? RetryKind.Failed : RetryKind.Pending;
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
            // Test build only (round 31): a retry can be held until the harness has made its change (the order fixed).
            TestMode.Gate("RETRY");
            lock (gate)
            {
                // Never while a delivery of ours is in flight (our write may be on the clipboard): wait, not consumed.
                if (inFlight.Count > 0) { ScheduleRetry(id, RetryKind.Busy); return; }
                if (Probe(StatePath(id)) == Presence.Absent) { CancelRetry(id); return; }
                RecoverResult result;
                string verdict;
                try { verdict = RecoverOne(id, out result, false, 0); }
                catch (Exception error) { verdict = "ERROR: " + error.GetType().Name + "; kept"; result = RecoverResult.Failed; }
                // Round 30: every retry says it ran (a check with nothing to report too), so its effect can be awaited.
                Wire.Log("clipboard record " + id.Substring(0, 8) + " (retry): " + (verdict ?? "checked (" + result.ToString().ToLowerInvariant() + ")"));
                AfterCheck(id, result, true);
            }
        }

        /// <summary>Under gate.</summary>
        static void AfterCheck(string id, RecoverResult result, bool fromTimer)
        {
            if (result == RecoverResult.Done || result == RecoverResult.Foreign) { CancelRetry(id); return; } // another session's: not ours to retry
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
                    if (name == "DoodleNote-Bark-clipboard-" + HelperIdentity.Sanitized + ".bin") { Wire.Log(TryDelete(path) ? "a round-8 clipboard record was removed (never restored from)" : "a round-8 clipboard record could not be removed now (never restored from; tried again later)"); continue; }
                    Match match = names.Match(name);
                    if (!match.Success)
                    {
                        // Round 33: a File.Replace leftover of an earlier build ("<state>~RF<hex>.TMP": a copy of an old state,
                        // no user content), older than 10 minutes: removed. Anything else that does not match is not ours.
                        if (ReplaceLeftover.IsMatch(name) && OlderThanTenMinutes(path))
                            Wire.Log("a stray replace leftover (" + name.Substring(Prefix.Length) + ") " + (TryDelete(path) ? "was deleted" : "could not be deleted now (tried again later)"));
                        continue; // another identity's file (X-foo for X), or not a record
                    }
                    string id = match.Groups[1].Value;
                    bool isState = match.Groups[2].Value == "state";
                    if (isState && !match.Groups[3].Success) { states.Add(id); continue; }
                    if (isState)
                    {
                        // A state .tmp is replaced atomically by its writer and removed with its record; one left with no state
                        // file, older than 10 minutes, is a stray (no payload depends on it).
                        if (Probe(StatePath(id)) != Presence.Absent || !OlderThanTenMinutes(path)) continue;
                        // Round 22 (S7): the log says what happened, never "deleted" for a deletion that failed.
                        Wire.Log("a stray state .tmp (" + name.Substring(Prefix.Length) + ") " + (TryDelete(path) ? "was deleted" : "could not be deleted now (tried again later)"));
                        continue;
                    }
                    // Only a payload whose state is positively ABSENT, old enough not to be another helper mid-step.
                    if (Probe(StatePath(id)) != Presence.Absent || writing.Contains(id) || inFlight.Contains(id) || !OlderThanTenMinutes(path)) continue;
                    Wire.Log("an orphaned clipboard payload (" + name.Substring(Prefix.Length) + ") " + (TryDelete(path) ? "was deleted" : "could not be deleted now (tried again later)") + "; never restored from");
                }
                foreach (string id in states)
                {
                    if (inFlight.Contains(id)) continue;
                    try
                    {
                        RecoverResult result;
                        string verdict = RecoverOne(id, out result, false, 0);
                        if (verdict != null) Wire.Log("clipboard record " + id.Substring(0, 8) + " (" + why + "): " + verdict);
                        AfterCheck(id, result, false);
                    }
                    catch (Exception error)
                    {
                        // One bad record never stops the others (or the helper): logged, kept, checked again.
                        Wire.Log("ERROR: clipboard record " + id.Substring(0, 8) + " (" + why + "): " + error.GetType().Name + "; kept");
                        try { ScheduleRetry(id, RetryKind.Check); } catch (Exception) { }
                    }
                }
                // An offer whose record vanished another way (another session's Dismiss of a rebuilt record, a cleaner):
                // withdrawn, only when its state is positively absent.
                foreach (string id in new List<string>(offers.Keys))
                    if (!states.Contains(id) && Probe(StatePath(id)) == Presence.Absent) OfferGone(id, "its record is gone");
            }
        }

        /// <summary>A file's last write is readable and more than 10 minutes ago (an unreadable time is never "old").</summary>
        static bool OlderThanTenMinutes(string path)
        {
            try
            {
                DateTime written = File.GetLastWriteTimeUtc(path);
                if (written.Year <= 1601) return false; // the "could not be read" value
                return DateTime.UtcNow - written >= TimeSpan.FromMinutes(10);
            }
            catch (Exception) { return false; }
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
        /// Round 22 (F5), an abandoned late write: its own record stays in flight here until its rollback is done ("busy",
        /// never judged meanwhile), and while it waits inside EmptyClipboard it holds the clipboard open, so neither this
        /// Restore nor a leftover check can open the clipboard ("busy", retried) until it returns and has put its saved
        /// content back. They are serialized by the clipboard lock, so nothing here waits for it.
        /// Round 22 (S3): an INCOMPLETE record is put back only when the app showed the user what is missing
        /// (acceptIncomplete); otherwise "incomplete" with the missing names, nothing emptied. Its put-back answers
        /// "restored-partially" with what it could not include.
        public static Dictionary<string, object> RestoreOffer(string id, uint expectSequence, bool acceptIncomplete = false)
        {
            // Round 31 (Opus): the user's Restore says where its time went (CI run 42842819157 saw Restores of 1.1-1.2 s,
            // about 1 s over their usual 0.05-0.07 s, that nothing in the log explained). Steps and times only, no content.
            StepTimeline steps = new StepTimeline();
            lock (gate)
            {
                steps.Mark("lock taken");
                if (!RecordName.IsMatch(Prefix + id + ".state") || Probe(StatePath(id)) == Presence.Absent) return Wire.Fields("result", "gone");
                RecoverResult result;
                Dictionary<string, object> reply = Wire.Fields();
                restoreSteps = steps;
                string verdict;
                try { verdict = RecoverOne(id, out result, true, expectSequence, reply, 0, acceptIncomplete); }
                finally { restoreSteps = null; }
                if (verdict != null) Wire.Log("clipboard record " + id.Substring(0, 8) + " (the user's restore): " + verdict);
                if (result != RecoverResult.Done && result != RecoverResult.Foreign) ScheduleRetry(id, RetryKind.Check); // never for another session's
                Wire.Log("clipboard record " + id.Substring(0, 8) + " (the user's restore) timeline: " + steps.Describe());
                return reply;
            }
        }

        /// <summary>Round 31: the steps of the user's Restore in progress on this thread (null otherwise).</summary>
        [ThreadStatic] static StepTimeline restoreSteps;
        static void RestoreStep(string step) { StepTimeline steps = restoreSteps; if (steps != null) steps.Mark(step); }

        /// <summary>The user dismissed an offer: its record is deleted now.</summary>
        public static bool DismissOffer(string id)
        {
            lock (gate)
            {
                if (!RecordName.IsMatch(Prefix + id + ".state")) return false;
                if (inFlight.Contains(id)) return false;
                Presence onDisk = Probe(StatePath(id));
                if (onDisk == Presence.Unknown) return false; // its isolation cannot be checked now: not deleted (retryable)
                if (onDisk == Presence.Present)
                {
                    // A state file that cannot be read now could belong to a running helper: not deleted (retryable).
                    Dictionary<string, object> state = null;
                    try { state = Wire.Parse(File.ReadAllText(StatePath(id))); } catch (Exception) { return false; }
                    if (state != null)
                    {
                        RecordFacts facts = RecordFacts.Of(state);
                        if (facts.Compare(Now()) == LogonMatch.OtherSession) return false; // another session's record: never deleted from here
                        // Its helper still runs, or whether it does could not be told (round 22, F7: unknown is never "not running").
                        if (facts.Pid != Process.GetCurrentProcess().Id && HelperLiveness(facts.Pid, facts.PidStart) != Liveness.NotRunning) return false;
                    }
                }
                // The real result: true only when every file of the record is gone (else the card stays, retryable;
                // a payload left without its state file is removed by the orphan sweep).
                DeleteId(id, "dismissed by the user");
                return !OnDisk(id);
            }
        }

        /// <summary>Under gate. Null when there was nothing to say. `byUser`: the user's restore of an offer (reply filled).</summary>
        static string RecoverOne(string id, out RecoverResult result, bool byUser, uint expectSequence, Dictionary<string, object> reply = null, int depth = 0, bool acceptIncomplete = false)
        {
            result = RecoverResult.Done;
            if (reply == null) reply = Wire.Fields();
            reply["result"] = "gone";
            // In flight here, or its payload still being written here: nothing is judged (also not a damaged state).
            if (inFlight.Contains(id)) { result = RecoverResult.Busy; reply["result"] = "busy"; return "in flight here"; }
            if (writing.Contains(id)) { result = RecoverResult.Busy; reply["result"] = "busy"; return "its payload is still being written; checked again later"; }
            // A read that fails (another process holds the file: an AV scan, the helper writing it) is never
            // corruption: the record is kept and checked again. Only a fully read file that is not a valid state is.
            string text;
            if (depth == 0) RestoreStep("checks");
            try { text = File.ReadAllText(StatePath(id)); }
            catch (Exception error)
            {
                if (!(error is IOException || error is UnauthorizedAccessException)) throw;
                result = RecoverResult.Busy; reply["result"] = "busy";
                return "its state file could not be read now (" + error.GetType().Name + "); kept";
            }
            Dictionary<string, object> state = Wire.Parse(text);
            string invalid = RecordFacts.Validate(state, id);
            if (invalid != null && depth > 0) { result = RecoverResult.Busy; reply["result"] = "busy"; return "its rebuilt state is still invalid (" + invalid + "); kept, checked again later"; }
            if (invalid != null)
            {
                // STRICT (round 17): a state that does not parse, or is not exactly a state this helper writes (a missing
                // or extra field, a wrong type, an unknown stage), proves nothing; no default may stand in for a field.
                // What it still says about isolation is honoured: another session's, or a running helper's, is left alone.
                if (state != null)
                {
                    double? otherSession = Wire.Num(state, "session"), otherPid = Wire.Num(state, "pid"), otherStart = Wire.Num(state, "pidStart"), otherTick = Wire.Num(state, "tick");
                    string otherBootId = Wire.Str(state, "bootId");
                    // The boot first, as Compare does for a valid state: a record of an EARLIER boot (its session number means
                    // nothing now) is rebuilt and offered here, never left to a session that no longer exists.
                    bool earlierBoot = (!string.IsNullOrEmpty(otherBootId) && bootId.Length > 0 && otherBootId != bootId)
                        || (otherTick.HasValue && otherTick.Value > 0 && (long)Native.GetTickCount64() < (long)otherTick.Value);
                    if (!earlierBoot && otherSession.HasValue && otherSession.Value >= 0 && (int)otherSession.Value != session) { result = RecoverResult.Foreign; reply["result"] = "busy"; return "an invalid state naming another session (" + invalid + "); left to it"; }
                    Liveness otherHelper = !earlierBoot && otherPid.HasValue && otherPid.Value > 0 && (int)otherPid.Value != Process.GetCurrentProcess().Id
                        ? HelperLiveness((int)otherPid.Value, (long)(otherStart ?? 0)) : Liveness.NotRunning;
                    if (otherHelper == Liveness.Running) { result = RecoverResult.Busy; reply["result"] = "busy"; return "an invalid state whose helper still runs (" + invalid + "); left to it"; }
                    // Round 22 (F7): whether its helper runs could not be told: left to it, bounded by the retention (its
                    // state file's age); only then rebuilt and offered (never deleted on that unknown).
                    if (otherHelper == Liveness.Unknown && !OlderThan(StatePath(id), Retention)) { result = RecoverResult.Busy; reply["result"] = "busy"; return "an invalid state whose helper may still run (that could not be told) (" + invalid + "); left to it (bounded by the retention)"; }
                }
                // Its payload may still be whole: then the record is rebuilt OFFER-ONLY with an unknown identity and offered,
                // never deleted and never restored on its own. Without a usable payload there is nothing to restore from.
                string kept = RebuildState(id, state, invalid);
                if (kept == "busy") { result = RecoverResult.Busy; reply["result"] = "busy"; return "an invalid state (" + invalid + "); its payload could not be read now; kept"; }
                if (kept != "rebuilt") return "invalid state, no usable payload; " + (DeleteId(id, "an invalid state (" + invalid + ") and no usable payload (" + kept + ")") ? "deleted" : "deletion deferred (kept)");
                Wire.Log("clipboard record " + id.Substring(0, 8) + ": an invalid state (" + invalid + ") was rebuilt from its payload (offer-only, unknown identity)");
                return RecoverOne(id, out result, byUser, expectSequence, reply, depth + 1, acceptIncomplete);
            }
            RecordFacts facts = RecordFacts.Of(state); // facts.OfferOnly is the ON-DISK value (a later write heals a failed one)
            // First of all: another session's record (same user, same boot, shared %TEMP%) is never touched here.
            if (facts.Compare(Now()) == LogonMatch.OtherSession) { result = RecoverResult.Foreign; reply["result"] = "busy"; return "another session's record; left to it"; }
            RestoreStep("state read");
            Liveness itsHelper = facts.Pid != Process.GetCurrentProcess().Id ? HelperLiveness(facts.Pid, facts.PidStart) : Liveness.NotRunning;
            RestoreStep("liveness checked");
            if (itsHelper == Liveness.Running) { result = RecoverResult.Busy; reply["result"] = "busy"; return "its helper (pid " + facts.Pid + ") still runs; left to it"; }
            if (itsHelper == Liveness.Unknown)
            {
                // Round 22 (F7): a failed query is UNKNOWN, never "not running": nothing is judged or deleted on it. Kept
                // (offer-only), bounded like an unreadable payload (the retention and the boot limit).
                string ended = UnreadablePolicy(id, facts, "whether its helper (pid " + facts.Pid + ") still runs could not be told");
                if (ended != null) return PolicyEnded(ended, ref result, reply);
                result = RecoverResult.Busy; reply["result"] = "busy";
                return "whether its helper (pid " + facts.Pid + ") still runs could not be told; kept (bounded by the retention)";
            }
            // Its restore had run (journaled before the deletion): deleted on sight, never offered.
            if (facts.Stage == "settled") return "settled earlier (never offered); " + (DeleteId(id, "settled: its restore had run") ? "deleted" : "deletion deferred (kept)");
            // Round 33 (a): no record is deleted by its stage alone any more (until round 32 a non-offer "saved" record was
            // deleted as "nothing had been emptied"). Begin writes "emptying" ("may be emptied") as its first durable state;
            // whether anything was emptied is decided by CONTENT below: the saved content exactly there (deleted), anything
            // else (offered). Test build only: the mutation check puts the old rule back, keyed on the first durable stage,
            // to prove a CI case catches it (DICTATION_HELPER_TEST_MUTANT_STAGE_RULE).
            if (TestMode.Env("DICTATION_HELPER_TEST_MUTANT_STAGE_RULE") == "1" && (facts.Stage == "saved" || facts.Stage == "emptying") && !facts.OfferOnly)
                return "MUTANT (test): stage " + facts.Stage + ": nothing to put back; " + (DeleteId(id, "nothing had been emptied (mutant)") ? "deleted" : "deletion deferred (kept)");
            SavedClipboard saved;
            string nonce;
            byte[] dictatedHash;
            // The payload's metadata and read: a failure to look at it or read it now is never corruption (kept).
            byte[] sealedBytes = null;
            string readError = null;
            try
            {
                Presence payload = Probe(PayloadPath(id));
                Presence payloadTmp = payload == Presence.Absent ? Probe(PayloadPath(id) + ".tmp") : Presence.Absent;
                if (payload == Presence.Unknown || payloadTmp == Presence.Unknown)
                {
                    // Not proof of absence: kept whole, bounded like an undecryptable payload.
                    string ended = UnreadablePolicy(id, facts, "its payload could not be looked at now");
                    if (ended != null) return PolicyEnded(ended, ref result, reply);
                    result = RecoverResult.Busy; reply["result"] = "busy";
                    return "its payload could not be looked at now; kept (offer-only; bounded by the retention)";
                }
                if (payload == Presence.Absent)
                {
                    // Positively absent. The writer completes .bin.tmp before moving it into place: a crash between the two
                    // leaves a whole payload under the temporary name, adopted (its offer-only fact persisted BEFORE the
                    // move) when it decrypts and names this record. Neither: a state without a payload, removed.
                    if (payloadTmp == Presence.Absent) return "stage " + facts.Stage + " but no payload; nothing to restore from: " + (DeleteId(id, "a state without its payload (both positively absent)") ? "deleted" : "deletion deferred (kept)");
                    string adopted = AdoptPayload(id, delegate { MarkOfferOnlyOnDisk(id, facts, "its payload was adopted from .bin.tmp"); });
                    if (adopted == "busy")
                    {
                        string ended = UnreadablePolicy(id, facts, "its payload (.tmp) could not be read now");
                        if (ended != null) return PolicyEnded(ended, ref result, reply);
                        result = RecoverResult.Busy; reply["result"] = "busy"; return "its payload (.tmp) could not be read now; kept (bounded by the retention)";
                    }
                    if (adopted != "adopted") { return "ERROR: stage " + facts.Stage + " but no usable payload (" + adopted + "); " + (DeleteId(id, "no usable payload (" + adopted + ")") ? "deleted" : Deferred); }
                    Wire.Log("clipboard record " + id.Substring(0, 8) + ": a complete payload left under its temporary name was adopted (offered)");
                }
                FileInfo info = new FileInfo(PayloadPath(id));
                if (info.Length > MaxRecordBytes) { return "ERROR: payload of " + info.Length + " bytes over the cap; not read; " + (DeleteId(id, "payload over the size cap") ? "deleted" : Deferred); }
                sealedBytes = File.ReadAllBytes(PayloadPath(id));
                RestoreStep("payload read");
            }
            catch (Exception error)
            {
                if (!(error is IOException || error is UnauthorizedAccessException || error is System.Security.SecurityException)) throw;
                readError = error.GetType().Name;
            }
            if (readError != null)
            {
                string ended = UnreadablePolicy(id, facts, "its payload could not be read now (" + readError + ")");
                if (ended != null) return PolicyEnded(ended, ref result, reply);
                result = RecoverResult.Busy; reply["result"] = "busy";
                return "its payload could not be read now (" + readError + "); kept (bounded by the retention)";
            }
            // Only a payload read in full that does not decrypt or parse is corrupt (and only then deleted).
            string corrupt = null;
            try
            {
                byte[] plain = ProtectedData.Unprotect(sealedBytes, Entropy, DataProtectionScope.CurrentUser);
                using (BinaryReader reader = new BinaryReader(new MemoryStream(plain), Encoding.UTF8))
                {
                    string magic = reader.ReadString();
                    if (magic != "DNCB3")
                    {
                        // Round-10 records (payload v2, never shipped in a release) cannot be read by this helper.
                        bool removed = DeleteId(id, "a " + magic + " record from an earlier build: never restored from");
                        return "a record from an earlier build (" + magic + "): " + (removed ? "removed" : "deletion deferred (kept, never restored from)");
                    }
                    if (reader.ReadString() != id) { return "ERROR: payload does not match its state; " + (DeleteId(id, "payload does not match") ? "deleted" : Deferred); }
                    nonce = reader.ReadString();
                    dictatedHash = reader.ReadBytes(32);
                    saved = SavedClipboard.ReadFrom(reader);
                }
                RestoreStep("decrypted");
            }
            catch (CryptographicException error)
            {
                saved = null; nonce = null; dictatedHash = null;
                // Only "bad data" (NTE_BAD_DATA, ERROR_INVALID_DATA) is the payload's own damage; anything else (a key or
                // profile not available now, access denied) is transient: the record is kept.
                int hr = System.Runtime.InteropServices.Marshal.GetHRForException(error);
                if (hr == unchecked((int)0x80090005) || hr == unchecked((int)0x8007000D)) corrupt = "CryptographicException " + hr.ToString("x8");
                else
                {
                    // Not the payload's own damage (a key or profile not available now, e.g. after a password reset): kept,
                    // offer-only, and bounded by the same policies as an offer (24 h from the first failed attempt in a
                    // boot, at most two boots), then deleted as unrecoverable. It never lives for ever.
                    string ended = UnreadablePolicy(id, facts, "its payload could not be decrypted now (0x" + hr.ToString("x8") + ")");
                    if (ended != null) return PolicyEnded(ended, ref result, reply);
                    result = RecoverResult.Busy; reply["result"] = "busy";
                    return "its payload could not be decrypted now (0x" + hr.ToString("x8") + "); kept (offer-only; the retention runs from the first failed attempt)";
                }
            }
            catch (EndOfStreamException error) { corrupt = error.GetType().Name; saved = null; nonce = null; dictatedHash = null; }
            catch (FormatException error) { corrupt = error.GetType().Name; saved = null; nonce = null; dictatedHash = null; }
            catch (ArgumentException error) { corrupt = error.GetType().Name; saved = null; nonce = null; dictatedHash = null; }
            catch (OverflowException error) { corrupt = error.GetType().Name; saved = null; nonce = null; dictatedHash = null; }
            if (corrupt != null) { return "ERROR: payload corrupt (" + corrupt + "); " + (DeleteId(id, "payload corrupt") ? "deleted" : Deferred); }
            PutBackTrace trace = byUser ? new PutBackTrace("user-restore") : null; // log only
            if (!ClipboardText.Open()) { result = RecoverResult.Busy; reply["result"] = "busy"; return "the clipboard is busy; kept for a retry"; }
            RestoreStep("opened");
            string outcome;
            // Round 33 (e): the clipboard is open only for the look and, for the user's Restore, the empty and the put-back:
            // every file step (an offer's facts, a deletion, a journal) runs after closeNow().
            bool isOpen = true;
            Action closeNow = delegate
            {
                if (!isOpen) return;
                isOpen = false;
                Native.ClearLastError(0); // round 22 (S6): the error read is this close's own
                bool closed = ClipboardText.Close();
                int closeError = closed ? 0 : Marshal.GetLastWin32Error();
                RestoreStep(closed ? "closed" : "close failed");
                if (trace != null) trace.Closed(closed, closeError);
            };
            try
            {
                ClipboardView view = ClipboardView.Read(saved, id, nonce, dictatedHash);
                LogonMatch match = facts.Compare(Now());
                RecoveryVerdict verdict = Decide(facts, view, match);
                string seen = view.Describe() + "; sequence " + view.Sequence + ", recorded " + facts.Stage + ", logon " + match.ToString().ToLowerInvariant();
                if (verdict == RecoveryVerdict.OtherSession) { result = RecoverResult.Foreign; reply["result"] = "busy"; return "another session's record (" + seen + "); left to it"; } // not retried here (S-A)
                // Round 23 (B2): only a WHOLE save can be "already there" (AllPresent says so too; checked here again).
                if (verdict == RecoveryVerdict.Untouched && !saved.Incomplete)
                {
                    closeNow();
                    if (byUser) reply["result"] = "restored";
                    bool gone = DeleteId(id, "nothing of the user's is missing");
                    // A restore of it had been reported failed: the app learns the clipboard holds the user's content.
                    if (facts.Unrestored) Wire.Send(Wire.Fields("event", "clipboard", "phase", "recovered", "id", facts.Delivery, "record", id, "clipboard", "restored"));
                    return "untouched (" + seen + "): the user's content is there; " + (gone ? "deleted" : Deferred);
                }
                if (!byUser)
                {
                    closeNow();
                    // ROUND 18: no automatic restore authority ever comes from disk. Whatever the journal and the clipboard
                    // say, a record read back here is OFFERED; only the user's Restore writes. The boot limit and the
                    // retention (policies) apply to what is offered.
                    if (OfferBootStep(facts, bootId, (long)Native.GetTickCount64()) == "delete")
                    {
                        return PolicyEnded("offered in two boots without an answer; " + (DeleteId(id, "offered in two boots without an answer") ? "deleted" : Deferred), ref result, reply);
                    }
                    Offer(id, facts, saved, view);
                    if (Expired(facts, Now()))
                    {
                        return PolicyEnded("expired; " + (DeleteId(id, "expired: offered longer than the " + Retention.TotalHours + " h retention") ? "deleted" : Deferred), ref result, reply);
                    }
                    result = RecoverResult.Pending;
                    reply["result"] = "pending";
                    return "offered (" + seen + "); nothing written";
                }
                // Round 22 (S2): a zero, now or offered, is no evidence the clipboard is as offered: nothing emptied.
                if (view.Sequence == 0 || expectSequence == 0)
                {
                    result = RecoverResult.Pending;
                    reply["result"] = "busy";
                    return "the user's restore: the clipboard sequence is not usable evidence (0); nothing emptied, kept";
                }
                // The user's Restore: only while the clipboard is exactly as offered.
                if (view.Sequence != expectSequence)
                {
                    result = RecoverResult.Pending;
                    reply["result"] = "changed";
                    reply["sequence"] = (double)view.Sequence;
                    reply["formats"] = view.FormatCount;
                    long bytes = ClipboardText.OpenClipboardBytes(view.OwnerAlive && !view.OwnerIsUs);
                    reply["bytes"] = bytes >= 0 ? (object)(double)bytes : null;
                    closeNow();
                    Offer(id, facts, saved, view);
                    return "the user's restore: the clipboard changed since the offer (" + seen + "); asked again";
                }
                // Round 24 (Opus, the one rule at the user's Restore): an incomplete record with NO user content (an
                // all-skipped record of an earlier build, or one whose only content format was lost on read-back) would
                // empty the user's clipboard and put back nothing: refused, with the reason; nothing emptied.
                if (saved.Incomplete && saved.UserContentCount == 0)
                {
                    result = RecoverResult.Pending;
                    reply["result"] = "nothing-to-restore";
                    reply["missing"] = saved.Missing();
                    closeNow();
                    Offer(id, facts, saved, view);
                    return "the user's restore: nothing with the user's content can go back; nothing emptied, kept (Dismiss deletes it)";
                }
                // Round 22 (S3): part of it could not be saved or read back. Nothing is emptied unless the user was told
                // exactly what is missing (the card shows it and the app says so with acceptIncomplete).
                if (saved.Incomplete && !acceptIncomplete)
                {
                    result = RecoverResult.Pending;
                    reply["result"] = "incomplete";
                    reply["missing"] = saved.Missing();
                    closeNow();
                    Offer(id, facts, saved, view);
                    return "the user's restore: the record is incomplete and the user was not shown what is missing; nothing emptied, kept";
                }
                // Journaled like a delivery, offer-only from the start (an interrupted Restore is offered again, never
                // finished on its own). It carries no sequence facts: nothing on disk is proof of anything.
                PendingRecord journal = new PendingRecord(id, nonce) { Persisted = true, DeliveryId = facts.Delivery, Unrestored = facts.Unrestored, CreatedUtc = facts.CreatedUtc, DictatedHash = dictatedHash,
                    OfferedSequence = facts.OfferedSequence, OfferedTick = facts.OfferedTick, OfferedBoot = facts.OfferedBoot, OfferedUtc = facts.OfferedUtc, OfferBoots = facts.OfferBoots,
                    OfferOnly = true, OfferOnlyWhy = "the user's Restore of an offer" };
                Inherit(journal, facts, match, (long)Native.GetTickCount64());
                RestoreStep("looked");
                // Round 33 (c, e): no "recovering" journal before the empty (and none inside the open): the record is
                // offer-only on disk already, so a Restore cut short anywhere is offered again (judged by content).
                // EmptyClipboard waits on a live foreign owner's WM_DESTROYCLIPBOARD (up to ~5 s on a hung one) while we hold the
                // lock: an owner that does not answer a WM_NULL now is not asked at all (kept, tried again later).
                string ownerProblem = view.OwnerAlive && !view.OwnerIsUs ? ClipboardText.OwnerUnresponsive() : null;
                if (ownerProblem != null)
                {
                    result = RecoverResult.Failed;
                    reply["result"] = "busy";
                    return "the clipboard's owner is not responding (" + ownerProblem + "); nothing emptied, kept";
                }
                bool emptied = TestMode.Env("DICTATION_HELPER_TEST_FAIL_RECOVERY_EMPTY") != "1" && Native.EmptyClipboard();
                if (trace != null) trace.Emptied(emptied, emptied ? 0 : Marshal.GetLastWin32Error());
                if (!emptied)
                {
                    result = RecoverResult.Failed;
                    reply["result"] = "failed";
                    return "the clipboard could not be emptied; kept for a retry";
                }
                RestoreStep("emptied");
                uint emptiedAt = Native.GetClipboardSequenceNumber();
                // Test build only: die with the clipboard emptied by the user's Restore.
                TestMode.Stall("RECOVERY_STALL_MS", TestMode.Int("DICTATION_HELPER_TEST_RECOVERY_STALL_MS", 0));
                bool setOk = saved.PutBackOpen(trace);
                string restored = saved.PutBackResult(setOk);
                RestoreStep("put back");
                closeNow();
                // Round 22 (S3): an incomplete record's put-back of everything that survived answers exactly that.
                bool partially = setOk && saved.Incomplete;
                reply["result"] = partially ? "restored-partially" : restored;
                if (partially) reply["missing"] = saved.Missing();
                // Round 23 (Opus SF1): an ACCEPTED partial restore (the user was shown what is missing and chose it) is done:
                // settled and deleted like any completed restore, never offered again. Only a put-back that failed keeps it.
                if (restored == "unrestored" && !partially)
                {
                    journal.Stage = "recovering-emptied";
                    journal.SequenceAtStage = emptiedAt;
                    WriteSnapshot(id, StateJson(journal), "recovering-emptied", false); // diagnostic, after the close
                    result = RecoverResult.Failed;
                    return "put back only in part; kept, offered again";
                }
                if (partially) restored = "restored-partially";
                outcome = "the user's restore put back (" + seen + "): " + restored;
                // Settled (DURABLE) BEFORE the file cleanup, which may be deferred (a file held by another process): the offer
                // is withdrawn now and a "settled" state is deleted on sight, so restored content is never offered again.
                // Round 33 (d): written after the close (the interval from the put-back to here widened by the close: a
                // crash in it leaves the record judged by content: already there, deleted; else a spurious offer).
                journal.Stage = "settled";
                if (!WriteSnapshot(id, StateJson(journal), "settled", true)) Wire.Log("the settled stage could not be journaled; deleting anyway");
                RestoreStep("journaled settled");
                OfferGone(id, "restored");
                outcome += DeleteId(id, outcome) ? "; deleted" : "; " + Deferred;
                RestoreStep("files deleted");
                // Round 23 (Astra S1): the event names what is missing too (it can reach the app before the reply).
                Dictionary<string, object> recovered = Wire.Fields("event", "clipboard", "phase", "recovered", "id", facts.Delivery, "record", id, "clipboard", restored);
                if (partially) recovered["missing"] = saved.Missing();
                Wire.Send(recovered);
            }
            finally { closeNow(); }
            return outcome;
        }

        /// <summary>
        /// Under gate: an invalid state file (see RecordFacts.Validate) is replaced by a fresh one with stage "unknown",
        /// OFFER-ONLY and an UNKNOWN identity (session -1, no logon or key, pid 0: it can be offered and dismissed in any
        /// session of this user, and proves nothing anywhere), when a payload is there (adopted from .bin.tmp if need be)
        /// that names this record, or that cannot be decrypted NOW (then the unreadable-payload policy bounds it). Bounded,
        /// so that damage cannot extend the retention: it is offered in this boot only (counted as its second offer boot),
        /// and an offer tick of this boot that the damaged state still shows is kept. Its delivery id is lost (the card
        /// cannot name the dictation). rebuilt | busy | none | corrupt.
        /// </summary>
        static string RebuildState(string id, Dictionary<string, object> old, string why)
        {
            string payload = PayloadPath(id);
            Presence present = Probe(payload);
            if (present == Presence.Absent)
            {
                Presence tmp = Probe(payload + ".tmp");
                if (tmp == Presence.Absent) return "none";
                if (tmp == Presence.Present) { string adopted = AdoptPayload(id, null); if (adopted == "corrupt") return adopted; }
                present = Probe(payload);
            }
            // A payload that cannot be looked at or read now is rebuilt unverified (offer-only; the unreadable-payload
            // policy bounds it, and it must name this record once it can be read).
            byte[] bytes = null;
            if (present == Presence.Present)
            {
                try { bytes = File.ReadAllBytes(payload); }
                catch (Exception error) { if (!(error is IOException || error is UnauthorizedAccessException)) throw; }
            }
            string nonce = "";
            if (bytes != null) try
            {
                byte[] plain = ProtectedData.Unprotect(bytes, Entropy, DataProtectionScope.CurrentUser);
                using (BinaryReader reader = new BinaryReader(new MemoryStream(plain), Encoding.UTF8))
                {
                    if (reader.ReadString() != "DNCB3" || reader.ReadString() != id) return "corrupt";
                    nonce = reader.ReadString();
                }
            }
            catch (CryptographicException error)
            {
                int hr = Marshal.GetHRForException(error);
                if (hr == unchecked((int)0x80090005) || hr == unchecked((int)0x8007000D)) return "corrupt";
                // Not decryptable now: rebuilt all the same (nothing is restored from it unless it decrypts and names this record later).
            }
            catch (EndOfStreamException) { return "corrupt"; }
            PendingRecord record = new PendingRecord(id, nonce)
            {
                Persisted = true, Stage = "unknown", OfferOnly = true, OfferOnlyWhy = "rebuilt from its payload (" + why + ")",
                IdentityUnknown = true, OfferBoots = 2
            };
            if (old != null)
            {
                double? tick = Wire.Num(old, "offeredTick");
                string boot = Wire.Str(old, "offeredBoot");
                if (tick.HasValue && tick.Value > 0 && !string.IsNullOrEmpty(boot) && boot == bootId) { record.OfferedTick = (long)tick.Value; record.OfferedBoot = boot; }
            }
            try { WriteState(record); return "rebuilt"; }
            catch (Exception error) { if (error is IOException || error is UnauthorizedAccessException) return "busy"; throw; }
        }

        /// <summary>
        /// Under gate: a complete .bin.tmp whose .bin is missing is moved into place (the caller makes the record
        /// offer-only). Complete: it decrypts and names this record, or it cannot be decrypted NOW (checked again when it
        /// can; it then has to name this record). adopted | busy | none | corrupt.
        /// </summary>
        static string AdoptPayload(string id, Action beforeMove)
        {
            string tmp = PayloadPath(id) + ".tmp";
            Presence presence = Probe(tmp);
            if (presence == Presence.Absent) return "none";
            if (presence == Presence.Unknown) return "busy";
            byte[] bytes;
            try { bytes = File.ReadAllBytes(tmp); }
            catch (Exception error) { if (error is IOException || error is UnauthorizedAccessException) return "busy"; throw; }
            try
            {
                byte[] plain = ProtectedData.Unprotect(bytes, Entropy, DataProtectionScope.CurrentUser);
                using (BinaryReader reader = new BinaryReader(new MemoryStream(plain), Encoding.UTF8))
                    if (reader.ReadString() != "DNCB3" || reader.ReadString() != id) return "corrupt";
            }
            catch (CryptographicException error)
            {
                int hr = Marshal.GetHRForException(error);
                if (hr == unchecked((int)0x80090005) || hr == unchecked((int)0x8007000D)) return "corrupt";
            }
            catch (EndOfStreamException) { return "corrupt"; }
            // Persisted before it is published (hygiene: nothing on disk grants authority since round 18 either way).
            if (beforeMove != null) beforeMove();
            TestMode.Stall("STALL_IN_ADOPT_MS", TestMode.Int("DICTATION_HELPER_TEST_STALL_IN_ADOPT_MS", 0)); // test build only: killed before the move
            try { File.Move(tmp, PayloadPath(id)); return "adopted"; }
            catch (Exception error) { if (error is IOException || error is UnauthorizedAccessException) return "busy"; throw; }
        }

        /// <summary>
        /// Under gate. The unreadable-payload POLICY (not a proof): a payload DPAPI cannot decrypt for a reason other than
        /// bad data is kept offer-only, its retention clock starts at the first failed attempt (the first-offer fields),
        /// and the boot limit and the 24 h retention apply as to an offer; then it is deleted as unrecoverable. Null while
        /// it is kept.
        /// </summary>
        /// <summary>A policy deletion that could not be carried out is deferred: kept, and retried on the backoff (not cancelled).</summary>
        const string Deferred = "deletion deferred (kept; retried)";

        static string PolicyEnded(string ended, ref RecoverResult result, Dictionary<string, object> reply)
        {
            if (ended.EndsWith(Deferred, StringComparison.Ordinal)) { result = RecoverResult.Busy; reply["result"] = "busy"; }
            return ended;
        }

        static string UnreadablePolicy(string id, RecordFacts facts, string why)
        {
            long nowTick = (long)Native.GetTickCount64();
            string step = OfferBootStep(facts, bootId, nowTick);
            // A retention DECISION: the deletion itself may be deferred (a file that cannot be looked at keeps the record whole;
            // a later check retries). Reported as it happened.
            if (step == "delete") return "unrecoverable payload, two boots (the boot limit is a policy); " + (DeleteId(id, why + " in two boots: unrecoverable") ? "deleted" : Deferred);
            if (facts.OfferedTick == 0)
            {
                if (facts.OfferBoots == 0) facts.OfferBoots = 1;
                facts.OfferedTick = nowTick;
                facts.OfferedBoot = bootId;
                facts.OfferedUtc = DateTime.UtcNow.ToString("o");
                PersistOffer(id, facts);
            }
            MarkOfferOnlyOnDisk(id, facts, why);
            if (Expired(facts, Now())) return "unrecoverable payload, retention over (a policy); " + (DeleteId(id, why + " for the " + Retention.TotalHours + " h retention: unrecoverable") ? "deleted" : Deferred);
            return null;
        }

        /// <summary>
        /// The rule (unit-tested): what the user's Restore journal inherits from the record it found. Since round 18 no
        /// sequence fact on disk is proof of anything, so it inherits none (no origin stage, no sequences, no write
        /// sequence); only the creation tick, and only from a record of this same logon and boot (a tick of another boot
        /// would make a fresh journal look older or newer than it is).
        /// </summary>
        internal static void Inherit(PendingRecord journal, RecordFacts facts, LogonMatch match, long nowTick)
        {
            journal.SequenceAfterWrite = 0;
            journal.OriginStage = "";
            journal.OriginSequenceAtStage = 0;
            journal.OriginSequenceClosed = 0;
            journal.CreatedTick = match == LogonMatch.Same ? facts.Tick : nowTick;
        }

        /// <summary>
        /// Under gate: the record is offered to the user. The offered sequence and the time of the first offer
        /// are fixed when it is first offered (persisted in the state file): a retry never refreshes them, so a
        /// later change to the clipboard always shows as "changed" at the user's click.
        /// </summary>
        static void Offer(string id, RecordFacts facts, SavedClipboard saved, ClipboardView view)
        {
            ClipboardOffer known;
            if (facts.OfferedSequence == 0 && offers.TryGetValue(id, out known) && known.Boot == bootId && known.Tick > 0)
            {
                // Offered by this helper already, but the state file did not take it: the first offer stands (memory).
                facts.OfferedSequence = known.Sequence;
                facts.OfferedTick = known.Tick;
                facts.OfferedBoot = known.Boot;
            }
            // An offered record is offer-only from then on: whatever later looks like proof, the user decides.
            MarkOfferOnlyOnDisk(id, facts, "offered");
            if (facts.OfferedSequence == 0)
            {
                if (facts.OfferBoots == 0) facts.OfferBoots = 1;
                offers.Remove(id); // a fresh offer (after a reboot) is announced again
                facts.OfferedSequence = view.Sequence;
                // The retention clock is set once per boot (an unreadable payload may have started it already).
                if (facts.OfferedTick == 0)
                {
                    facts.OfferedTick = (long)Native.GetTickCount64();
                    facts.OfferedBoot = bootId;
                    facts.OfferedUtc = DateTime.UtcNow.ToString("o");
                }
                PersistOffer(id, facts);
            }
            ClipboardOffer offer = new ClipboardOffer
            {
                Record = id, Delivery = facts.Delivery, Formats = saved.FormatCount, Bytes = saved.ByteCount,
                Sequence = facts.OfferedSequence, Created = facts.CreatedUtc, LikelyOurs = view.LooksInterrupted,
                Tick = facts.OfferedTick, Boot = facts.OfferedBoot, Incomplete = saved.Incomplete, Missing = saved.Incomplete ? saved.Missing() : new List<string>(),
                Content = saved.UserContentCount
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
                state["offered"] = facts.OfferedUtc;
                state["offerBoots"] = facts.OfferBoots;
                state["offerOnly"] = true; // an offered record is offer-only (informational: disk never grants authority)
                if (!facts.OfferOnly) state["offerOnlyWhy"] = "offered";
                WriteStateJson(StatePath(id), Wire.Serialize(state), true);
                facts.OfferOnly = true;
            }
            catch (Exception error) { Wire.Log("the offer could not be recorded in the state file (" + error.GetType().Name + "); offered from memory"); }
        }

        /// <summary>
        /// The rule (unit-tested), a POLICY rather than a proof the content is no longer wanted: a record is offered in at most
        /// two boots, the boot in which it is first offered and the next one (a transaction whose boot crashed before any offer
        /// does not count that boot). In a boot after that it is deleted. "reoffer": offered in an earlier boot, so the
        /// offer starts again here (sequence numbers restarted); "delete"; "keep".
        /// </summary>
        internal static string OfferBootStep(RecordFacts facts, string bootNow, long tickNow)
        {
            if (facts.OfferedTick == 0) return "keep";
            // Another boot: the boot counters differ, or (when a counter is unknown) the tick count is below the offer's.
            bool otherBoot = facts.OfferedBoot.Length > 0 && bootNow.Length > 0 ? facts.OfferedBoot != bootNow : tickNow < facts.OfferedTick;
            if (!otherBoot) return "keep";
            if (facts.OfferBoots >= 2) return "delete";
            facts.OfferBoots = 2;
            facts.OfferedSequence = 0;
            facts.OfferedTick = 0; // this boot's offer sets its own tick (the retention runs per boot)
            facts.OfferedBoot = "";
            return "reoffer";
        }

        /// <summary>
        /// The retention rule (unit-tested): 24 h from the FIRST OFFER, measured on the tick count of the same boot
        /// (no wall clock), a POLICY rather than a proof. A record from another boot is offered again (OfferBootStep). A
        /// record not yet offered (also one from an older build) is offered first, which sets the tick; the 24 h run from then.
        /// </summary>
        internal static bool Expired(RecordFacts facts, LogonNow now)
        {
            if (facts.OfferedTick > 0)
            {
                bool sameBoot = facts.OfferedBoot.Length > 0 && now.BootId.Length > 0 ? facts.OfferedBoot == now.BootId : now.Tick >= facts.OfferedTick;
                return sameBoot && now.Tick - facts.OfferedTick > (long)Retention.TotalMilliseconds;
            }
            return false; // not offered yet: the offer sets the tick first (no wall clock, ever)
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

        /// <summary>
        /// The retention's own check runs the full decision procedure for every record of this identity (RecoverLeftover):
        /// the state is read, another session's records and those of a running helper are left alone, and an offered
        /// record is measured against the retention (nothing is restored here). Nothing is deleted on age alone.
        /// </summary>
        internal static void ExpireSweep()
        {
            try { RecoverLeftover("retention check"); }
            catch (Exception error) { Wire.Log("ERROR: the retention check failed: " + error.GetType().Name); }
        }

        public enum RecoveryVerdict { Untouched, Pending, OtherSession }

        /// <summary>
        /// The rule (unit-tested). ROUND 18: a record read back from disk never carries authority to write: whatever its
        /// journal says (a stage, a sequence, our complete write, an empty clipboard at a journaled sequence), it is
        /// OFFERED (Pending). The only exceptions: another session's record is left alone (OtherSession), and a record
        /// whose saved content is already on the clipboard exactly is deleted without writing (Untouched: nothing of the
        /// user's is missing). The only automatic restore is the live transaction's own, in the process that wrote
        /// (SavedClipboard.Restore).
        /// </summary>
        public static RecoveryVerdict Decide(RecordFacts facts, ClipboardView view, LogonMatch logonMatch)
        {
            if (logonMatch == LogonMatch.OtherSession) return RecoveryVerdict.OtherSession;
            return view.HoldsSavedExactly ? RecoveryVerdict.Untouched : RecoveryVerdict.Pending;
        }

        /// <summary>
        /// The helper that wrote a record still runs: the same pid AND the same process start time (a reused pid is
        /// another process). Records without a start time (earlier builds) fall back to the process name.
        /// </summary>
        /// <summary>Whether a helper process runs: a query that fails is UNKNOWN, never "not running" (round 22, F7).</summary>
        internal enum Liveness { NotRunning, Running, Unknown }

        /// <summary>
        /// Whether the helper `pid` (started at `startTicks`, when known) still runs. NotRunning only on proof: no such
        /// process, or one that has exited, or one with another start time or name. A query Windows refuses (access
        /// denied: a protected process that reused the pid) or any other failure is Unknown.
        /// </summary>
        internal static Liveness HelperLiveness(int pid, long startTicks = 0)
        {
            if (pid <= 0) return Liveness.NotRunning;
#if DICTATION_TEST
            if (TestMode.Env("DICTATION_HELPER_TEST_LIVENESS_UNKNOWN") == "1") return Liveness.Unknown; // test build only
#endif
            Process other;
            try { other = Process.GetProcessById(pid); }
            catch (ArgumentException) { return Liveness.NotRunning; } // no process with that id
            catch (Exception) { return Liveness.Unknown; }
            using (other)
            {
                try
                {
                    if (other.HasExited) return Liveness.NotRunning;
                    if (startTicks > 0) return Math.Abs(other.StartTime.ToUniversalTime().Ticks - startTicks) < TimeSpan.TicksPerSecond ? Liveness.Running : Liveness.NotRunning;
                    return other.ProcessName.IndexOf("dictation-helper", StringComparison.OrdinalIgnoreCase) >= 0 ? Liveness.Running : Liveness.NotRunning;
                }
                catch (InvalidOperationException) { return Liveness.NotRunning; } // it exited meanwhile (no process associated)
                catch (Exception) { return Liveness.Unknown; }
            }
        }

        /// <summary>A file's last write is readable and at least `age` ago (an unreadable time is never "old").</summary>
        internal static bool OlderThan(string path, TimeSpan age)
        {
            try
            {
                DateTime written = File.GetLastWriteTimeUtc(path);
                if (written.Year <= 1601) return false; // the "could not be read" value
                return DateTime.UtcNow - written >= age;
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
        public long PidStart;
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
        public string OfferedUtc = "";
        public int OfferBoots;
        /// <summary>See PendingRecord.OfferOnly.</summary>
        public bool OfferOnly;
        public string OfferOnlyWhy = "";

        /// <summary>Every stage this helper journals ("unknown": rebuilt; "settled": its restore ran, deleted on sight).</summary>
        internal static readonly string[] Stages = { "saved", "emptying", "emptied", "written", "restoring", "restore-emptied", "recovering", "recovering-emptied", "unknown", "settled" };

        /// <summary>The state file's schema: every field, always written. s string, b bool, u uint32, l long >= 0, i int >= -1.</summary>
        static readonly Dictionary<string, char> Schema = new Dictionary<string, char>
        {
            { "format", 'i' }, { "id", 's' }, { "pid", 'i' }, { "pidStart", 'l' }, { "stage", 's' },
            { "sequenceAtStage", 'u' }, { "sequenceClosed", 'u' }, { "sequenceAfterWrite", 'u' },
            { "originStage", 's' }, { "originSequenceAtStage", 'u' }, { "originSequenceClosed", 'u' },
            { "unrestored", 'b' }, { "delivery", 's' }, { "ownerWindow", 's' },
            { "session", 'i' }, { "logon", 's' }, { "sessionKey", 's' }, { "bootId", 's' }, { "tick", 'l' }, { "boot", 's' },
            { "created", 's' }, { "offeredSequence", 'u' }, { "offeredTick", 'l' }, { "offeredBoot", 's' }, { "offered", 's' },
            { "offerBoots", 'i' }, { "offerOnly", 'b' }, { "offerOnlyWhy", 's' }, { "updated", 's' }
        };

        /// <summary>
        /// The rule (unit-tested, STRICT): null when the state is exactly one this helper writes for this record (every
        /// field present with its type, nothing else, a known stage, this format and this id); otherwise why not. An
        /// invalid state proves nothing: no default ever stands in for a missing field (see RecoverOne).
        /// </summary>
        internal static string Validate(Dictionary<string, object> state, string id)
        {
            if (state == null) return "it does not parse";
            foreach (KeyValuePair<string, object> field in state) if (!Schema.ContainsKey(field.Key)) return "an unknown field (" + field.Key + ")";
            foreach (KeyValuePair<string, char> field in Schema)
            {
                object value;
                if (!state.TryGetValue(field.Key, out value)) return "a missing field (" + field.Key + ")";
                if (field.Value == 's') { if (!(value is string)) return "a wrong type (" + field.Key + ")"; continue; }
                if (field.Value == 'b') { if (!(value is bool)) return "a wrong type (" + field.Key + ")"; continue; }
                double? number = Wire.Num(state, field.Key);
                if (!number.HasValue || number.Value != Math.Floor(number.Value)) return "a wrong type (" + field.Key + ")";
                double n = number.Value;
                if (field.Value == 'u' && (n < 0 || n > uint.MaxValue)) return "out of range (" + field.Key + ")";
                if (field.Value == 'l' && (n < 0 || n > 9.2e18)) return "out of range (" + field.Key + ")";
                if (field.Value == 'i' && (n < -1 || n > int.MaxValue)) return "out of range (" + field.Key + ")";
            }
            if ((int)Wire.Num(state, "format").Value != PendingClipboard.Format) return "another format";
            if (Wire.Str(state, "id") != id) return "another record's id";
            if (Array.IndexOf(Stages, Wire.Str(state, "stage")) < 0) return "an unknown stage";
            string origin = Wire.Str(state, "originStage");
            if (origin.Length > 0 && Array.IndexOf(Stages, origin) < 0) return "an unknown origin stage";
            double boots = Wire.Num(state, "offerBoots").Value;
            if (boots < 0 || boots > 2) return "out of range (offerBoots)";
            if ((int)Wire.Num(state, "pid").Value < 0) return "out of range (pid)";
            DateTime created;
            if (!DateTime.TryParse(Wire.Str(state, "created"), null, System.Globalization.DateTimeStyles.RoundtripKind, out created)) return "a wrong type (created)";
            return null;
        }

        public static RecordFacts Of(Dictionary<string, object> state)
        {
            RecordFacts facts = new RecordFacts();
            facts.Format = (int)(Wire.Num(state, "format") ?? 0);
            facts.Stage = Wire.Str(state, "stage") ?? "saved";
            facts.Pid = (int)(Wire.Num(state, "pid") ?? 0);
            facts.PidStart = (long)(Wire.Num(state, "pidStart") ?? 0);
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
            facts.OfferedUtc = Wire.Str(state, "offered") ?? "";
            facts.OfferBoots = (int)(Wire.Num(state, "offerBoots") ?? 0);
            facts.OfferOnly = Wire.Bool(state, "offerOnly") ?? true; // only ever read from a validated state; absent would mean offer-only
            facts.OfferOnlyWhy = Wire.Str(state, "offerOnlyWhy") ?? "";
            DateTime created;
            if (DateTime.TryParse(Wire.Str(state, "created") ?? "", null, System.Globalization.DateTimeStyles.RoundtripKind, out created)) facts.CreatedUtc = created.ToUniversalTime();
            return facts;
        }

        /// <summary>
        /// The rule (unit-tested). DIFFERENT (another boot): Windows' boot counter differs, or the tick count is below
        /// the record's (ticks restart at boot); nothing is proven then, and the record is offered (an offer only
        /// writes on the user's confirmation against the clipboard as it is at the click). OTHER SESSION (left alone: its own session's helper restores it): another window-station
        /// session of the same user sharing %TEMP%. UNKNOWN (offered, never deleted for it): another per-logon
        /// key (a cleaner deleted it, a persistent one was replaced, or a relogin while the boot lasts), another
        /// LUID in the same session (an elevated helper), anything missing. SAME: session, LUID and key equal.
        /// No wall clock. The contract, stated plainly: a record stays offered across a relogin and across one reboot;
        /// it is deleted 24 h after its offer in a boot, or when a second reboot finds it unanswered.
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
        /// <summary>Every saved format is present with identical content, and nothing else (but synthesized formats).</summary>
        public bool HoldsSavedExactly;
        public OurWrite OurWrite;
        public uint Sequence;
        public int FormatCount;
        /// <summary>The enumeration was not complete (ClipboardText.EnumerateComplete): no proof of anything.</summary>
        public bool Incomplete;
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
            view.Sequence = ClipboardText.Sequence("view");
            List<uint> present;
            if (!ClipboardText.EnumerateComplete(out present, "view"))
            {
                // Incomplete (round 21): no proof of anything: not our write, not the saved content (offered, never deleted).
                view.FormatCount = present.Count;
                view.Incomplete = true;
                return view;
            }
            view.FormatCount = present.Count;
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
