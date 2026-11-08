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
        public readonly string Id = Guid.NewGuid().ToString("N");
        /// <summary>False when the saved content carried a privacy marker: then it never leaves memory.</summary>
        public bool Persisted;
        public string Stage = "saved";
        /// <summary>The clipboard sequence number right after OUR write (0 until it is known).</summary>
        public uint SequenceAfterWrite;
        public readonly DateTime CreatedUtc = DateTime.UtcNow;
        /// <summary>The background write of the encrypted payload (null when nothing is written to disk).</summary>
        public Thread PayloadWriter;
        public volatile bool PayloadWritten;
    }

    /// <summary>
    /// The user's saved clipboard, written down for the moment between our clipboard write and its
    /// restore, so a helper that ends in that moment (killed, crashed, or quitting before the restore)
    /// does not lose it: the next helper of the same identity, or this one later, puts it back.
    ///
    /// Each paste is one record with its own id: an encrypted payload (DPAPI, current user, the saved
    /// formats and a hash of the dictated text) and a small plain state file (stage, the sequence
    /// number right after our write, owner, times; no user content), both in the per-user %TEMP% under
    /// the app identity. The stage follows the transaction: saved, emptied, written, restoring; a
    /// failed restore leaves it "unrestored". A record is deleted only after a restore that ran (or a
    /// verdict that it is stale), never after a failed one: then it is retried (3 s, 10 s, 30 s, 60 s,
    /// 120 s, before the next delivery, and at the next helper start).
    ///
    /// Recovery restores only when the clipboard is provably ours or provably the interrupted stage:
    /// its sequence number is still the one right after our write, or it carries our record's sentinel
    /// format and our privacy markers (text equality alone is never ownership); or, in the emptied or
    /// restoring stage, it is empty with no live owner, or holds only formats identical to the saved
    /// ones (a restore cut short). A live owner that is not ours means someone copied since: their copy
    /// is left alone and the record is stale.
    ///
    /// Privacy: content that carries any of the three clipboard privacy markers (password managers set
    /// them to say "do not record") is never written to disk; such a transaction is kept in memory only,
    /// so a helper that ends between our write and the restore cannot give it back.
    /// </summary>
    internal static class PendingClipboard
    {
        static readonly byte[] Entropy = Encoding.UTF8.GetBytes("DoodleNote-Bark-clipboard-v2");
        static readonly object gate = new object();
        /// <summary>A payload larger than this is not read back (corrupt or not ours): logged and deleted.</summary>
        public const long MaxRecordBytes = 64L * 1024 * 1024;
        /// <summary>How long a paste waits for its payload to be on disk before going ahead anyway.</summary>
        public const int PayloadWaitMs = 250;
        /// <summary>The private format our write carries, holding the record id (see ClipboardText.Write).</summary>
        public const string SentinelFormat = "DoodleNote.Bark.Transaction";
        static readonly int[] RetryDelaysMs = { 3000, 10000, 30000, 60000, 120000 };
        static readonly HashSet<string> inFlight = new HashSet<string>();
        static Timer retryTimer;
        static int retryIndex;

        /// <summary>Tests point the records elsewhere.</summary>
        internal static string Directory = Path.GetTempPath();
        static string Prefix { get { return "DoodleNote-Bark-clipboard-" + HelperIdentity.Sanitized + "-"; } }
        static string PayloadPath(string id) { return Path.Combine(Directory, Prefix + id + ".bin"); }
        static string StatePath(string id) { return Path.Combine(Directory, Prefix + id + ".state"); }

        static byte[] Hash(string text)
        {
            using (SHA256 sha = SHA256.Create()) return sha.ComputeHash(Encoding.Unicode.GetBytes(text));
        }

        /// <summary>Whether a record with this id is on disk (tests, diagnostics).</summary>
        internal static bool OnDisk(string id) { return File.Exists(StatePath(id)) || File.Exists(PayloadPath(id)); }

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
                record.PayloadWriter = new Thread(delegate ()
                {
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
                        string path = PayloadPath(record.Id), tmp = path + ".tmp";
                        File.WriteAllBytes(tmp, sealedBytes);
                        File.Move(tmp, path);
                        record.PayloadWritten = true;
                        Wire.Log("the saved clipboard was written down (" + sealedBytes.Length + " bytes sealed and written in " + watch.ElapsedMilliseconds + " ms)");
                    }
                    catch (Exception error) { Wire.Log("ERROR: the saved clipboard could not be written down: " + error.GetType().Name); }
                });
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

        /// <summary>The transaction moved on (emptied, written, restoring); recorded for a later recovery.</summary>
        public static void Stage(PendingRecord record, string stage, uint sequenceAfterWrite = 0)
        {
            if (record == null) return;
            record.Stage = stage;
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
        /// The transaction is over for this delivery: its record is deleted when the restore ran (or
        /// nothing was emptied), and kept for a retry when it did not.
        /// </summary>
        public static void Finish(PendingRecord record, string restoreResult)
        {
            if (record == null) return;
            lock (gate) inFlight.Remove(record.Id);
            if (Settled(restoreResult))
            {
                if (record.Persisted) Delete(record.Id, "restore ran (" + restoreResult + ")");
                return;
            }
            Stage(record, "unrestored");
            if (record.Persisted) ScheduleRetry();
            else Wire.Log("the restore failed and the saved clipboard was memory-only (privacy marker): it cannot be retried later");
        }

        static void WriteState(PendingRecord record)
        {
            string json = Wire.Serialize(Wire.Fields(
                "id", record.Id,
                "pid", Process.GetCurrentProcess().Id,
                "stage", record.Stage,
                "sequenceAfterWrite", (double)record.SequenceAfterWrite,
                "ownerWindow", Ui.ClipboardWindow.ToInt64().ToString("x"),
                "session", Process.GetCurrentProcess().SessionId,
                "created", record.CreatedUtc.ToString("o"),
                "updated", DateTime.UtcNow.ToString("o")));
            string path = StatePath(record.Id), tmp = path + ".tmp";
            File.WriteAllText(tmp, json);
            if (File.Exists(path)) File.Delete(path);
            File.Move(tmp, path);
        }

        static void Delete(string id, string why)
        {
            foreach (string path in new[] { PayloadPath(id), StatePath(id) })
            {
                try { if (File.Exists(path)) File.Delete(path); }
                catch (Exception error) { Wire.Log("ERROR: the clipboard record " + Path.GetFileName(path) + " could not be deleted: " + error.GetType().Name); }
            }
            Wire.Log("clipboard record " + id.Substring(0, 8) + " deleted: " + why);
        }

        static void ScheduleRetry()
        {
            lock (gate)
            {
                if (retryTimer != null || retryIndex >= RetryDelaysMs.Length) return;
                int delay = RetryDelaysMs[retryIndex++];
                retryTimer = new Timer(delegate
                {
                    lock (gate) { retryTimer.Dispose(); retryTimer = null; }
                    RecoverLeftover("retry");
                }, null, delay, Timeout.Infinite);
            }
        }

        /// <summary>
        /// Put back every record that is not in flight here and whose clipboard is provably ours or the
        /// interrupted stage (see the class). Runs at start, on the retry timer, and before a delivery.
        /// A record of another helper that still runs is left to it (and re-checked later).
        /// </summary>
        public static void RecoverLeftover(string why)
        {
            lock (gate)
            {
                // The retry timer never acts while a delivery of ours is in flight: our own write is then
                // on the clipboard, and an older record must not be judged against it.
                if (why == "retry" && inFlight.Count > 0) { ScheduleRetry(); return; }
                string[] states;
                try { states = System.IO.Directory.GetFiles(Directory, Prefix + "*.state"); }
                catch (Exception) { return; }
                bool retry = false;
                foreach (string statePath in states)
                {
                    string id = Path.GetFileName(statePath).Substring(Prefix.Length);
                    id = id.Substring(0, id.Length - ".state".Length);
                    if (inFlight.Contains(id)) continue;
                    string verdict = RecoverOne(id, statePath, ref retry);
                    if (verdict != null) Wire.Log("clipboard record " + id.Substring(0, Math.Min(8, id.Length)) + " (" + why + "): " + verdict);
                }
                if (retry) ScheduleRetry();
            }
        }

        /// <summary>Under gate. Null when there was nothing to say; sets retry when the record is kept for later.</summary>
        static string RecoverOne(string id, string statePath, ref bool retry)
        {
            Dictionary<string, object> state = null;
            try { state = Wire.Parse(File.ReadAllText(statePath)); } catch (Exception) { }
            if (state == null) { Delete(id, "unreadable state"); return "unreadable state; deleted"; }
            string stage = Wire.Str(state, "stage") ?? "saved";
            int pid = (int)(Wire.Num(state, "pid") ?? 0);
            uint sequence = (uint)(Wire.Num(state, "sequenceAfterWrite") ?? 0);
            if (pid != Process.GetCurrentProcess().Id && HelperRunning(pid)) { retry = true; return "its helper (pid " + pid + ") still runs; left to it"; }
            if (stage == "saved") { Delete(id, "nothing had been emptied"); return "stage saved: nothing to put back"; }
            string payloadPath = PayloadPath(id);
            SavedClipboard saved;
            byte[] hash;
            try
            {
                FileInfo info = new FileInfo(payloadPath);
                if (!info.Exists) { Delete(id, "no payload (the paste went ahead before it was written)"); return "ERROR: stage " + stage + " but no payload; cannot put back"; }
                if (info.Length > MaxRecordBytes) { Delete(id, "payload over the size cap"); return "ERROR: payload of " + info.Length + " bytes over the cap; not read"; }
                byte[] plain = ProtectedData.Unprotect(File.ReadAllBytes(payloadPath), Entropy, DataProtectionScope.CurrentUser);
                using (BinaryReader reader = new BinaryReader(new MemoryStream(plain), Encoding.UTF8))
                {
                    if (reader.ReadString() != "DNCB2" || reader.ReadString() != id) { Delete(id, "payload does not match"); return "ERROR: payload does not match its state"; }
                    hash = reader.ReadBytes(32);
                    saved = SavedClipboard.ReadFrom(reader);
                }
            }
            catch (Exception error) { Delete(id, "payload unreadable"); return "ERROR: payload unreadable (" + error.GetType().Name + ")"; }
            if (!ClipboardText.Open()) { retry = true; return "the clipboard is busy; kept for a retry"; }
            string outcome;
            try
            {
                ClipboardView view = ClipboardView.Read(saved, id);
                RecoveryVerdict verdict = Decide(stage, sequence, view);
                if (verdict == RecoveryVerdict.Stale) { outcome = "stale (" + view.Describe() + "); left as it is"; }
                else if (!Native.EmptyClipboard()) { retry = true; return "the clipboard could not be emptied; kept for a retry"; }
                else outcome = (saved.PutBackOpen() ? "put back" : "put back in part") + " (" + verdict + ")";
            }
            finally { Native.CloseClipboard(); }
            Delete(id, outcome);
            return outcome;
        }

        public enum RecoveryVerdict { Stale, OursBySequence, OursBySentinel, InterruptedEmpty, InterruptedRestore }

        /// <summary>
        /// The rule (unit-tested): a live owner that is not ours: stale. Otherwise ours when the sequence
        /// number is still the one right after our write, or our sentinel and our privacy markers are
        /// there; in the emptied or restoring stage, also when the clipboard is empty, or (restoring)
        /// holds only formats identical to the saved ones. Anything else: stale.
        /// </summary>
        public static RecoveryVerdict Decide(string stage, uint sequenceAfterWrite, ClipboardView view)
        {
            if (view.OwnerAlive && !view.OwnerIsUs) return RecoveryVerdict.Stale;
            bool interruptible = stage == "emptied" || stage == "restoring" || stage == "written" || stage == "unrestored";
            if (!interruptible) return RecoveryVerdict.Stale;
            if (sequenceAfterWrite != 0 && view.Sequence == sequenceAfterWrite) return RecoveryVerdict.OursBySequence;
            if (view.SentinelMatches && view.MarkersPresent) return RecoveryVerdict.OursBySentinel;
            if ((stage == "emptied" || stage == "restoring") && view.FormatCount == 0) return RecoveryVerdict.InterruptedEmpty;
            if (stage == "restoring" && view.FormatCount > 0 && view.OnlySavedFormats) return RecoveryVerdict.InterruptedRestore;
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

    /// <summary>What recovery sees on the (open) clipboard; read without asking any live owner to render.</summary>
    internal sealed class ClipboardView
    {
        public bool OwnerAlive, OwnerIsUs, SentinelMatches, MarkersPresent, OnlySavedFormats;
        public uint Sequence;
        public int FormatCount;

        public string Describe()
        {
            return "owner " + (OwnerIsUs ? "ours" : OwnerAlive ? "another app" : "none") + ", " + FormatCount + " format(s), sentinel "
                + (SentinelMatches ? "ours" : "absent") + ", markers " + (MarkersPresent ? "present" : "absent");
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
            byte[] sentinel = ClipboardText.ReadBytes(Native.RegisterClipboardFormat(PendingClipboard.SentinelFormat), 256);
            view.SentinelMatches = sentinel != null && Encoding.UTF8.GetString(sentinel).TrimEnd('\0') == recordId;
            view.MarkersPresent = true;
            foreach (string marker in ClipboardText.MarkerNames)
                if (!Native.IsClipboardFormatAvailable(Native.RegisterClipboardFormat(marker))) view.MarkersPresent = false;
            view.OnlySavedFormats = saved.MatchesOpenClipboard();
            return view;
        }
    }
}
