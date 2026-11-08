using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

namespace DoodleNote.DictationHelper
{
    /// <summary>One paste's clipboard transaction: the user's saved clipboard, from before our write until its restore.</summary>
    internal sealed class PendingRecord
    {
        public readonly string Id;
        public PendingRecord() { Id = Guid.NewGuid().ToString("N"); }
        /// <summary>An existing record (a recovery journals its own stages under the same id).</summary>
        public PendingRecord(string id) { Id = id; }
        /// <summary>False when the saved content carried a privacy marker: then it never leaves memory.</summary>
        public bool Persisted;
        public string Stage = "saved";
        /// <summary>The clipboard sequence number right after OUR write (0 until it is known).</summary>
        public uint SequenceAfterWrite;
        /// <summary>The sequence number that goes with the current stage (see PendingClipboard.Decide).</summary>
        public uint SequenceAtStage;
        public readonly DateTime CreatedUtc = DateTime.UtcNow;
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
    /// Each paste is one record with its own id: an encrypted payload (DPAPI, current user) and a small
    /// plain state file (no user content) in the per-user %TEMP% under the app identity. The state file
    /// journals the transaction: saved, emptying, emptied, written, restoring, unrestored; a recovery
    /// journals itself the same way (recovering-emptying, recovering-restoring). Each stage carries the
    /// clipboard sequence number that goes with it, and every record carries its boot, logon session
    /// and window-station session, because sequence numbers restart with a new boot or logon.
    ///
    /// A record is deleted only after a restore that completed (or a verdict that it is stale), never
    /// after a failed one: then it is retried with its own backoff (3, 10, 30, 60, 120 s), before the next
    /// delivery, and at the next helper start. Recovery restores only on transaction-specific evidence
    /// (see Decide): our record's sentinel format on the clipboard, or the sequence number recorded for
    /// the stage within the same boot and logon. Matching text is never ownership. A failed or partial
    /// put-back keeps the record.
    ///
    /// Privacy: content that carries any clipboard privacy marker (password managers set them to say
    /// "do not record") is never written to disk; such a transaction stays in memory only.
    /// </summary>
    internal static class PendingClipboard
    {
        static readonly byte[] Entropy = Encoding.UTF8.GetBytes("DoodleNote-Bark-clipboard-v2");
        static readonly object gate = new object();
        /// <summary>A payload larger than this is not read back (corrupt or not ours): logged and deleted.</summary>
        public const long MaxRecordBytes = 64L * 1024 * 1024;
        /// <summary>How long a paste waits for its payload to be on disk before going ahead anyway.</summary>
        public const int PayloadWaitMs = 250;
        /// <summary>The private format our write (and every restore) carries first, holding the record id.</summary>
        public const string SentinelFormat = "DoodleNote.Bark.Transaction";
        static readonly int[] RetryDelaysMs = { 3000, 10000, 30000, 60000, 120000 };
        static readonly HashSet<string> inFlight = new HashSet<string>();
        /// <summary>Payload writers still running in this process (their record must not be judged "no payload").</summary>
        static readonly HashSet<string> writing = new HashSet<string>();
        /// <summary>Per transaction: its retry backoff step and timer.</summary>
        static readonly Dictionary<string, KeyValuePair<int, Timer>> retries = new Dictionary<string, KeyValuePair<int, Timer>>();

        /// <summary>Tests point the records elsewhere, and can slow the payload writer down.</summary>
        internal static string Directory = Path.GetTempPath();
        internal static int TestPayloadDelayMs = TestMode.Int("DICTATION_HELPER_TEST_PAYLOAD_DELAY_MS", 0);
        static string Prefix { get { return "DoodleNote-Bark-clipboard-" + HelperIdentity.Sanitized + "-"; } }
        static string PayloadPath(string id) { return Path.Combine(Directory, Prefix + id + ".bin"); }
        static string StatePath(string id) { return Path.Combine(Directory, Prefix + id + ".state"); }

        static readonly string logon = Native.LogonId();
        static readonly int session = Process.GetCurrentProcess().SessionId;

        static byte[] Hash(string text)
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
                    writer.Write("DNCB2");
                    writer.Write(record.Id);
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

        /// <summary>The transaction moved on; journaled (with the stage's sequence number) for a later recovery.</summary>
        public static void Stage(PendingRecord record, string stage, uint sequenceAtStage = 0, uint sequenceAfterWrite = 0)
        {
            if (record == null) return;
            record.Stage = stage;
            record.SequenceAtStage = sequenceAtStage;
            if (sequenceAfterWrite != 0) record.SequenceAfterWrite = sequenceAfterWrite;
            if (record.Persisted)
            {
                try { WriteState(record); }
                catch (Exception error) { Wire.Log("ERROR: the clipboard transaction stage could not be recorded: " + error.GetType().Name); }
            }
        }

        /// <summary>A restore result that leaves nothing to do later (anything but "unrestored").</summary>
        public static bool Settled(string restoreResult) { return restoreResult != "unrestored"; }

        /// <summary>
        /// The transaction is over for this delivery: its record is deleted when the restore completed (or
        /// nothing was emptied), and kept for a retry when it did not.
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
            Stage(record, "unrestored", record.SequenceAtStage);
            if (record.Persisted) ScheduleRetry(record.Id, false);
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
                "ownerWindow", Ui.ClipboardWindow.ToInt64().ToString("x"),
                "session", session,
                "logon", logon,
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
            CancelRetry(record.Id);
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

        /// <summary>Retry a kept record with its own backoff; a timer that fires during a delivery waits (not consumed).</summary>
        static void ScheduleRetry(string id, bool sameStep)
        {
            lock (gate)
            {
                KeyValuePair<int, Timer> entry;
                int step = retries.TryGetValue(id, out entry) ? entry.Key : 0;
                if (entry.Value != null) entry.Value.Dispose();
                if (!sameStep && retries.ContainsKey(id)) step++;
                if (step >= RetryDelaysMs.Length) { retries.Remove(id); Wire.Log("clipboard record " + id.Substring(0, 8) + ": retries used up; the next helper start tries again"); return; }
                int delay = sameStep ? 1000 : RetryDelaysMs[step];
                Timer timer = new Timer(delegate { RetryOne(id); }, null, delay, Timeout.Infinite);
                retries[id] = new KeyValuePair<int, Timer>(step, timer);
            }
        }

        static void CancelRetry(string id)
        {
            lock (gate)
            {
                KeyValuePair<int, Timer> entry;
                if (retries.TryGetValue(id, out entry)) { if (entry.Value != null) entry.Value.Dispose(); retries.Remove(id); }
            }
        }

        static void RetryOne(string id)
        {
            lock (gate)
            {
                // Never while a delivery of ours is in flight (our write may be on the clipboard): wait, not consumed.
                if (inFlight.Count > 0) { ScheduleRetry(id, true); return; }
                bool retry = false;
                string verdict = File.Exists(StatePath(id)) ? RecoverOne(id, ref retry) : null;
                if (verdict != null) Wire.Log("clipboard record " + id.Substring(0, 8) + " (retry): " + verdict);
                if (retry) ScheduleRetry(id, false); else CancelRetry(id);
            }
        }

        /// <summary>
        /// Put back every record that is not in flight here and whose clipboard state is provably ours or
        /// provably the interrupted stage (Decide). Runs at start, before a delivery, and per record on its
        /// retry timer. Orphaned payloads (no state file, no running writer) and round-8 records are deleted.
        /// </summary>
        public static void RecoverLeftover(string why)
        {
            lock (gate)
            {
                string[] files;
                try { files = System.IO.Directory.GetFiles(Directory, "DoodleNote-Bark-clipboard-" + HelperIdentity.Sanitized + "*"); }
                catch (Exception) { return; }
                foreach (string path in files)
                {
                    string name = Path.GetFileName(path);
                    // Round 8 wrote one record per identity with no id: never restored from, just removed.
                    if (name == "DoodleNote-Bark-clipboard-" + HelperIdentity.Sanitized + ".bin") { TryDelete(path); Wire.Log("a round-8 clipboard record was removed (never restored from)"); continue; }
                    if (!name.StartsWith(Prefix) || name.EndsWith(".state")) continue;
                    string id = name.Substring(Prefix.Length);
                    id = id.Substring(0, id.IndexOf('.'));
                    if (File.Exists(StatePath(id)) || writing.Contains(id) || inFlight.Contains(id)) continue;
                    TryDelete(path);
                    Wire.Log("an orphaned clipboard payload (" + name.Substring(Prefix.Length) + ") was deleted; never restored from");
                }
                foreach (string statePath in files)
                {
                    string name = Path.GetFileName(statePath);
                    if (!name.StartsWith(Prefix) || !name.EndsWith(".state")) continue;
                    string id = name.Substring(Prefix.Length, name.Length - Prefix.Length - ".state".Length);
                    if (inFlight.Contains(id)) continue;
                    bool retry = false;
                    string verdict = RecoverOne(id, ref retry);
                    if (verdict != null) Wire.Log("clipboard record " + id.Substring(0, Math.Min(8, id.Length)) + " (" + why + "): " + verdict);
                    if (retry) ScheduleRetry(id, false);
                }
            }
        }

        /// <summary>Under gate. Null when there was nothing to say; sets retry when the record is kept for later.</summary>
        static string RecoverOne(string id, ref bool retry)
        {
            Dictionary<string, object> state = null;
            try { state = Wire.Parse(File.ReadAllText(StatePath(id))); } catch (Exception) { }
            if (state == null) { DeleteId(id, "unreadable state"); return "unreadable state; deleted"; }
            RecordFacts facts = RecordFacts.Of(state);
            if (facts.Pid != Process.GetCurrentProcess().Id && HelperRunning(facts.Pid)) { retry = true; return "its helper (pid " + facts.Pid + ") still runs; left to it"; }
            if (facts.Stage == "saved") { DeleteId(id, "nothing had been emptied"); return "stage saved: nothing to put back"; }
            if (writing.Contains(id)) { retry = true; return "its payload is still being written; checked again later"; }
            SavedClipboard saved;
            try
            {
                FileInfo info = new FileInfo(PayloadPath(id));
                if (!info.Exists) { DeleteId(id, "no payload (the paste went ahead before it was written)"); return "ERROR: stage " + facts.Stage + " but no payload; cannot put back"; }
                if (info.Length > MaxRecordBytes) { DeleteId(id, "payload over the size cap"); return "ERROR: payload of " + info.Length + " bytes over the cap; not read"; }
                byte[] plain = ProtectedData.Unprotect(File.ReadAllBytes(PayloadPath(id)), Entropy, DataProtectionScope.CurrentUser);
                using (BinaryReader reader = new BinaryReader(new MemoryStream(plain), Encoding.UTF8))
                {
                    if (reader.ReadString() != "DNCB2" || reader.ReadString() != id) { DeleteId(id, "payload does not match"); return "ERROR: payload does not match its state"; }
                    reader.ReadBytes(32);
                    saved = SavedClipboard.ReadFrom(reader);
                }
            }
            catch (Exception error) { DeleteId(id, "payload unreadable"); return "ERROR: payload unreadable (" + error.GetType().Name + ")"; }
            if (!ClipboardText.Open()) { retry = true; return "the clipboard is busy; kept for a retry"; }
            string outcome;
            bool done;
            try
            {
                ClipboardView view = ClipboardView.Read(saved, id);
                bool sameLogon = facts.SameLogon(session, logon, Native.BootTimeUtc);
                RecoveryVerdict verdict = Decide(facts, view, sameLogon);
                string seen = view.Describe() + "; sequence " + view.Sequence + ", recorded " + facts.SequenceAtStage + "/" + facts.SequenceAfterWrite + (sameLogon ? ", same boot and logon" : ", another boot or logon");
                if (verdict == RecoveryVerdict.Stale) { outcome = "stale (" + seen + "); left as it is"; done = true; }
                else
                {
                    // Journaled like a delivery: an interrupted recovery is itself recoverable.
                    PendingRecord journal = new PendingRecord(id) { Persisted = true };
                    Stage(journal, "recovering-emptying", view.Sequence);
                    if (!Native.EmptyClipboard()) { retry = true; return "the clipboard could not be emptied; kept for a retry"; }
                    ClipboardText.SetSentinel(id);
                    Stage(journal, "recovering-restoring", view.Sequence);
                    int stall = TestMode.Int("DICTATION_HELPER_TEST_RECOVERY_STALL_MS", 0);
                    if (stall > 0) Thread.Sleep(stall); // test build only: die here
                    bool complete = saved.PutBackOpen();
                    if (complete) { outcome = "put back (" + verdict + "; " + seen + ")"; done = true; }
                    else { retry = true; return "put back only in part; kept for a retry (" + verdict + ")"; }
                }
            }
            finally { Native.CloseClipboard(); }
            if (done)
            {
                DeleteId(id, outcome);
                if (outcome.StartsWith("put back")) Wire.Send(Wire.Fields("event", "clipboard", "phase", "recovered", "clipboard", "restored"));
            }
            return outcome;
        }

        public enum RecoveryVerdict { Stale, OursBySequence, OursBySentinel, InterruptedEmpty, InterruptedRestore }

        /// <summary>
        /// The rule (unit-tested). A live owner that is not ours: stale. Every other verdict needs evidence
        /// specific to THIS transaction: our record's sentinel on the clipboard, or the sequence number
        /// recorded for the stage within the same boot, logon and session.
        ///  - written / unrestored: the sequence is still the one right after our write (same logon), or our
        ///    sentinel with our privacy markers is there;
        ///  - emptying / recovering-emptying: empty, and the sequence moved by exactly our EmptyClipboard (same logon);
        ///  - emptied: empty, and the sequence is the one right after our EmptyClipboard (same logon);
        ///  - restoring / recovering-restoring: empty with the sequence moved by exactly our EmptyClipboard (same
        ///    logon), or our sentinel (set first by every restore) alone or with nothing but saved formats, compared;
        ///  - anything else (including a clipboard someone emptied or filled since): stale.
        /// </summary>
        public static RecoveryVerdict Decide(RecordFacts facts, ClipboardView view, bool sameLogon)
        {
            if (view.OwnerAlive && !view.OwnerIsUs) return RecoveryVerdict.Stale;
            string stage = facts.Stage;
            if (stage == "written" || stage == "unrestored")
            {
                if (sameLogon && facts.SequenceAfterWrite != 0 && view.Sequence == facts.SequenceAfterWrite) return RecoveryVerdict.OursBySequence;
                if (view.SentinelMatches && view.MarkersPresent) return RecoveryVerdict.OursBySentinel;
                if (stage == "unrestored" && view.SentinelMatches && (view.FormatCount == 1 || view.OnlySavedFormats)) return RecoveryVerdict.InterruptedRestore;
                return RecoveryVerdict.Stale;
            }
            if (stage == "emptying" || stage == "recovering-emptying")
                return view.FormatCount == 0 && sameLogon && view.Sequence == facts.SequenceAtStage + 1 ? RecoveryVerdict.InterruptedEmpty : RecoveryVerdict.Stale;
            if (stage == "emptied")
                return view.FormatCount == 0 && sameLogon && facts.SequenceAtStage != 0 && view.Sequence == facts.SequenceAtStage ? RecoveryVerdict.InterruptedEmpty : RecoveryVerdict.Stale;
            if (stage == "restoring" || stage == "recovering-restoring")
            {
                if (view.FormatCount == 0) return sameLogon && view.Sequence == facts.SequenceAtStage + 1 ? RecoveryVerdict.InterruptedEmpty : RecoveryVerdict.Stale;
                // Our sentinel goes on first: alone, or with nothing but saved formats, it is our restore cut short.
                return view.SentinelMatches && (view.FormatCount == 1 || view.OnlySavedFormats) ? RecoveryVerdict.InterruptedRestore : RecoveryVerdict.Stale;
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

    /// <summary>What a record's state file says.</summary>
    internal sealed class RecordFacts
    {
        public string Stage = "saved";
        public int Pid;
        public uint SequenceAtStage, SequenceAfterWrite;
        public int Session = -1;
        public string Logon = "";
        public DateTime BootUtc = DateTime.MinValue;

        public static RecordFacts Of(Dictionary<string, object> state)
        {
            RecordFacts facts = new RecordFacts();
            facts.Stage = Wire.Str(state, "stage") ?? "saved";
            facts.Pid = (int)(Wire.Num(state, "pid") ?? 0);
            facts.SequenceAtStage = (uint)(Wire.Num(state, "sequenceAtStage") ?? 0);
            facts.SequenceAfterWrite = (uint)(Wire.Num(state, "sequenceAfterWrite") ?? 0);
            facts.Session = (int)(Wire.Num(state, "session") ?? -1);
            facts.Logon = Wire.Str(state, "logon") ?? "";
            DateTime boot;
            if (DateTime.TryParse(Wire.Str(state, "boot") ?? "", null, System.Globalization.DateTimeStyles.RoundtripKind, out boot)) facts.BootUtc = boot.ToUniversalTime();
            return facts;
        }

        /// <summary>
        /// Same boot (start times within a minute: the tick-derived boot time moves only with clock
        /// adjustments), same logon session (LUID) and same window-station session: only then do clipboard
        /// sequence numbers compare.
        /// </summary>
        public bool SameLogon(int session, string logon, DateTime bootUtc)
        {
            return Session == session && Logon.Length > 0 && Logon == logon && BootUtc != DateTime.MinValue
                && Math.Abs((BootUtc - bootUtc).TotalSeconds) < 60;
        }
    }

    /// <summary>What recovery sees on the (open) clipboard; read without asking any live owner to render.</summary>
    internal sealed class ClipboardView
    {
        public bool OwnerAlive, OwnerIsUs, SentinelMatches, MarkersPresent, OnlySavedFormats;
        public uint Sequence;
        public int FormatCount;

        public string Describe()
        {
            return "owner " + (OwnerIsUs ? "ours" : OwnerAlive ? "another app" : "none") + ", " + FormatCount + " format(s), sentinel "
                + (SentinelMatches ? "ours" : "absent") + ", markers " + (MarkersPresent ? "present" : "absent")
                + (FormatCount > 0 ? ", only saved formats " + (OnlySavedFormats ? "yes" : "no") : "");
        }

        /// <summary>Under the clipboard lock.</summary>
        public static ClipboardView Read(SavedClipboard saved, string recordId)
        {
            ClipboardView view = new ClipboardView();
            IntPtr owner = Native.GetClipboardOwner();
            view.OwnerIsUs = owner != IntPtr.Zero && owner == Ui.ClipboardWindow;
            view.OwnerAlive = owner != IntPtr.Zero && Native.IsWindow(owner);
            view.Sequence = Native.GetClipboardSequenceNumber();
            int count = 0;
            for (uint f = Native.EnumClipboardFormats(0); f != 0; f = Native.EnumClipboardFormats(f)) count++;
            view.FormatCount = count;
            // A live owner that is not ours could render on demand: never read its data.
            if (view.OwnerAlive && !view.OwnerIsUs) return view;
            uint sentinelFormat = Native.RegisterClipboardFormat(PendingClipboard.SentinelFormat);
            byte[] sentinel = ClipboardText.ReadBytes(sentinelFormat, 256);
            view.SentinelMatches = sentinel != null && Encoding.UTF8.GetString(sentinel).TrimEnd('\0') == recordId;
            view.MarkersPresent = true;
            foreach (string marker in ClipboardText.MarkerNames)
                if (!Native.IsClipboardFormatAvailable(Native.RegisterClipboardFormat(marker))) view.MarkersPresent = false;
            view.OnlySavedFormats = count > 0 && saved.MatchesOpenClipboard(sentinelFormat);
            return view;
        }
    }
}
