using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Automation;

namespace DoodleNote.DictationHelper
{
    /// <summary>
    /// How a delivery ended. uncertain: an insertion was attempted and could not be
    /// confirmed; the host must keep the text and must NOT retry blindly.
    /// </summary>
    internal enum DeliveryOutcome { Delivered, Uncertain, Refused, Failed }

    internal sealed class DeliveryTimings
    {
        public int ValidateMs, InsertMs, ConfirmMs, SettleMs;
        public Dictionary<string, object> Fields()
        {
            // Windows has no accessibility insertion to skip, so skippedAx is always false.
            return Wire.Fields("validateMs", ValidateMs, "insertMs", InsertMs, "confirmMs", ConfirmMs, "settleMs", SettleMs, "skippedAx", false);
        }
    }

    internal sealed class DeliveryResult
    {
        public DeliveryOutcome Outcome;
        public string Reason;
        /// <summary>paste (clipboard and Ctrl+V) or type (synthetic Unicode keystrokes).</summary>
        public string Method;
        public bool Verified;
        /// <summary>
        /// untouched | restored | user-changed | partial | skipped | unrestored. unrestored: the user's
        /// content could not be put back; ClipboardHolds says what the clipboard holds instead.
        /// </summary>
        public string Clipboard = "untouched";
        public DeliveryTimings Timings;
        /// <summary>
        /// Typing: the UTF-16 units of the text whose keys were each confirmed by the field (counted up
        /// to and including the last confirmed key); -1 for a paste.
        /// </summary>
        public int CharsDelivered = -1;
        /// <summary>Typing: 1 when one more key was sent but its arrival could not be confirmed (never counted as delivered).</summary>
        public int CharsUnconfirmed = -1;
        /// <summary>
        /// For clipboard "unrestored": what the clipboard holds now. dictated: our text is still on it.
        /// foreign: another app's newer copy. unknown: the helper could not tell.
        /// </summary>
        public string ClipboardHolds;
        /// <summary>Per-keystroke safety-check timing while typing (null for a paste).</summary>
        public GuardStats Guard;
        /// <summary>Per-keystroke wait for the target to process the key while typing (null for a paste).</summary>
        public GuardStats Settle;
        /// <summary>The slowest single provider (UIA) call during THIS delivery, in ms (diagnostics).</summary>
        public double ProviderSlowestMs = -1;
        /// <summary>
        /// Round 22: for a put-back that could not be whole (skipped, partial), what was not put back, by name and reason
        /// (for example "FileContents (not provided by the app that copied it)"), so the app can say so.
        /// </summary>
        public List<string> ClipboardMissing;
        /// <summary>Round 22: not-saved when the clipboard could not be saved or used, so nothing was pasted with it.</summary>
        public string ClipboardNotice;
        /// <summary>Round 23: why (too-large, unrendered, nothing-savable, owner-unresponsive, zero-sequence, no-record,
        /// deadline, no-window, unreadable), so the app can tell the user.</summary>
        public string ClipboardNoticeReason;

        public DeliveryResult(DeliveryOutcome outcome, string reason) { Outcome = outcome; Reason = reason; }

        public Dictionary<string, object> Fields()
        {
            Dictionary<string, object> output = Wire.Fields("outcome", Outcome.ToString().ToLowerInvariant(), "verified", Verified, "clipboard", Clipboard);
            if (Reason != null) output["reason"] = Reason;
            if (Method != null) output["method"] = Method;
            if (Timings != null) output["timings"] = Timings.Fields();
            if (CharsDelivered >= 0) output["charsDelivered"] = CharsDelivered;
            if (CharsUnconfirmed >= 0) output["charsUnconfirmed"] = CharsUnconfirmed;
            if (ClipboardHolds != null) output["clipboardHolds"] = ClipboardHolds;
            if (Guard != null && Guard.Count > 0) output["guard"] = Guard.Fields();
            if (Settle != null && Settle.Count > 0) output["settle"] = Settle.Fields();
            if (ProviderSlowestMs >= 0) output["providerSlowestMs"] = Math.Round(ProviderSlowestMs, 1);
            if (ClipboardMissing != null && ClipboardMissing.Count > 0) output["clipboardMissing"] = ClipboardMissing;
            if (ClipboardNotice != null) output["clipboardNotice"] = ClipboardNotice;
            if (ClipboardNoticeReason != null) output["clipboardNoticeReason"] = ClipboardNoticeReason;
            return output;
        }
    }

    /// <summary>
    /// How long the safety check before each typed keystroke took: a histogram (ms buckets) and the
    /// maximum, so the per-character cost of the password guard is measured, not assumed.
    /// </summary>
    internal sealed class GuardStats
    {
        static readonly double[] Edges = { 0.5, 1, 2, 4, 8, 16, 32 };
        readonly int[] buckets = new int[Edges.Length + 1];
        public int Count;
        public double MaxMs, TotalMs;

        public void Add(double ms)
        {
            Count++;
            TotalMs += ms;
            if (ms > MaxMs) MaxMs = ms;
            int i = 0;
            while (i < Edges.Length && ms >= Edges[i]) i++;
            buckets[i]++;
        }

        public Dictionary<string, object> Fields()
        {
            Dictionary<string, object> histogram = new Dictionary<string, object>();
            for (int i = 0; i <= Edges.Length; i++)
            {
                string label = i == 0 ? "<" + Edges[0] : i == Edges.Length ? ">=" + Edges[Edges.Length - 1] : Edges[i - 1] + "-" + Edges[i];
                histogram[label + "ms"] = buckets[i];
            }
            return Wire.Fields("count", Count, "maxMs", Math.Round(MaxMs, 3), "meanMs", Count > 0 ? Math.Round(TotalMs / Count, 3) : 0.0, "histogram", histogram);
        }
    }

    internal sealed class DeliveryGuards
    {
        /// <summary>The selection must be exactly this text, or the insertion is refused.</summary>
        public string ExpectSelection;
        /// <summary>This text must occur exactly once in the field; it is selected and replaced.</summary>
        public string Replace;

        public DeliveryGuards(string expectSelection, string replace)
        {
            ExpectSelection = expectSelection;
            Replace = replace;
        }
    }

    /// <summary>What a control holds, for before/after comparison.</summary>
    internal sealed class ControlState
    {
        public string Value;
        public int? Location;

        public static ControlState Read(AutomationElement element)
        {
            ControlState state = new ControlState();
            if (element == null) return state;
            try { state.Value = UIA.ReadValue(element, FieldRead.MaxCharacters * 4); }
            catch (ElementNotAvailableException) { }
            state.Location = UIA.SelectionStart(element);
            return state;
        }

        /// <summary>Read within timeoutMs of wall clock; null when the read throws or overruns.</summary>
        public static ControlState TryRead(AutomationElement element, int timeoutMs)
        {
            ControlState state;
            return Bounded.Run(() => Read(element), timeoutMs, out state) ? state : null;
        }

        public bool Observable { get { return Value != null || Location != null; } }

        public bool SameAs(ControlState other)
        {
            return other != null && Value == other.Value && Location == other.Location;
        }
    }

    /// <summary>Finding text in a field: a replacement may only go where its target is the one and only match.</summary>
    internal static class TextLocator
    {
        /// <summary>The start (UTF-16) of needle in haystack, only when it occurs exactly once; -1 otherwise.</summary>
        public static int UniqueIndex(string needle, string haystack)
        {
            if (string.IsNullOrEmpty(needle) || haystack == null) return -1;
            int first = haystack.IndexOf(needle, StringComparison.Ordinal);
            if (first < 0) return -1;
            // Search from the next unit, so overlapping copies count as two.
            return haystack.IndexOf(needle, first + 1, StringComparison.Ordinal) < 0 ? first : -1;
        }
    }

    internal static class Delivery
    {
        /// <summary>The deliver request being served on this thread (so a late clipboard rollback can name it).</summary>
        public static string CurrentRequestId { get { return currentRequestId; } set { currentRequestId = value; } }
        [ThreadStatic] static string currentRequestId;
        /// <summary>This delivery's established save (for the names of what its put-back could not include).</summary>
        [ThreadStatic] static SavedClipboard deliverySave;
        /// <summary>This delivery's paste could not save the clipboard (no window, or no established save).</summary>
        [ThreadStatic] static string deliveryNoSave; // round 23: why the paste did not use the clipboard (null: it did)

        static int Ms(Stopwatch watch) { return (int)watch.ElapsedMilliseconds; }

        /// <summary>Validate the target immediately before inserting, then insert once.</summary>
        public static DeliveryResult Deliver(TargetSnapshot snapshot, string text, DeliveryGuards guards, int deadlineMs = 0, int alreadyElapsedMs = 0)
        {
            DeliveryTimings timings = new DeliveryTimings();
            BoundedStats stats = Bounded.Track();
            try
            {
                deliverySave = null;
                deliveryNoSave = null;
                DeliveryResult result = DeliverInner(snapshot, text, guards, timings, deadlineMs, alreadyElapsedMs, stats);
                result.Timings = timings;
                ClipboardNotes(result, deliverySave, deliveryNoSave);
                if (result.ProviderSlowestMs < 0 && stats.SlowestMs > 0) result.ProviderSlowestMs = stats.SlowestMs;
                return result;
            }
            finally { Bounded.Untrack(); deliverySave = null; deliveryNoSave = null; }
        }

        /// <summary>
        /// Round 22: the reply names what a put-back short of whole did not include (skipped, partial), and says when the
        /// clipboard could not be saved at all (so nothing was pasted), so the user is told, never left guessing.
        /// </summary>
        internal static void ClipboardNotes(DeliveryResult result, SavedClipboard saved, string noSaveReason)
        {
            if (saved != null && (result.Clipboard == "skipped" || result.Clipboard == "partial"))
            {
                List<string> missing = saved.Missing();
                if (missing.Count > 0) result.ClipboardMissing = missing;
            }
            if (noSaveReason != null && result.Clipboard == "untouched")
            {
                result.ClipboardNotice = "not-saved";
                result.ClipboardNoticeReason = noSaveReason;
            }
        }

        /// <summary>How long a paste is expected to take, start to settled, for the deadline check.</summary>
        static int PasteEstimateMs { get { return 1600; } }

        /// <summary>How long typing `text` is expected to take, start to settled, for the deadline check.</summary>
        static int TypeEstimateMs(string text)
        {
            string normalized = text.Replace("\r\n", "\n");
            int boundaries = 0;
            foreach (char c in normalized) if (char.IsWhiteSpace(c) || char.IsPunctuation(c)) boundaries++;
            // Per character: the 8 ms pacing, the per-keystroke safety check and the wait for the target
            // to show it processed the key (measured on Dev04: 30-35 ms per character in Notepad and
            // WinForms besides the boundary pauses), plus 70 ms at each word boundary, plus confirm and
            // settle. Mirrored in dictation-helper-protocol.ts.
            return normalized.Length * 50 + boundaries * 70 + 3000;
        }

        /// <summary>Wall-clock bound for validating the target before any insertion.</summary>
        const int ValidateBudgetMs = 1500;
        /// <summary>Wall-clock bound for one guard check (all its provider calls together).</summary>
        const int GuardBudgetMs = 250;
        /// <summary>Wall-clock bound for the target to show it processed one typed key.</summary>
        const int KeySettleMs = 400;
        /// <summary>Wall-clock bound for one read of the field while confirming an insertion.</summary>
        const int ReadBudgetMs = 600;
        /// <summary>Wall-clock bound for saving the user's clipboard before a paste.</summary>
        const int CaptureBudgetMs = 1500;

        sealed class Validation
        {
            public string Refusal;
            public AutomationElement Current;
            public ControlState Before;
        }

        /// <summary>
        /// Everything checked before an insertion, in one bounded call: the snapshot's control is still
        /// focused, readable, not secure (UIA and Win32 ES_PASSWORD), not above us, editable, and the
        /// caller's guards hold. An unreadable control is refused (target-unverifiable), never trusted.
        /// The one side effect (selecting the text an undo replaces) goes through the call's token, so a
        /// validation the caller already gave up on never changes the user's selection.
        /// </summary>
        static Validation Validate(TargetSnapshot snapshot, DeliveryGuards guards, CallToken token)
        {
            Validation v = new Validation();
            AutomationElement current;
            if (!Target.StillFocused(snapshot, out current)) { v.Refusal = "focus-changed"; return v; }
            Native.GUITHREADINFO gui = Target.CurrentGui();
            ElementFacts now = ElementFacts.Of(current, gui);
            if (current != null && !now.Readable) { v.Refusal = "target-unverifiable"; return v; }
            if (snapshot.Facts.Secure || now.Secure || Target.IsPasswordEdit(gui.hwndFocus)) { v.Refusal = "secure-field"; return v; }
            if (snapshot.AboveUs) { v.Refusal = "elevated-target"; return v; }
            if (!now.Editable) { v.Refusal = "not-editable"; return v; }
            if (guards.ExpectSelection != null)
            {
                if (current == null || UIA.Selection(current) != guards.ExpectSelection) { v.Refusal = "selection-changed"; return v; }
            }
            if (guards.Replace != null)
            {
                // Undo and the like: find the one copy of the old text, select it, and let
                // the normal insertion below replace it.
                string value = null;
                try { value = current != null ? UIA.ReadValue(current, FieldRead.MaxCharacters * 4) : null; }
                catch (ElementNotAvailableException) { }
                if (value == null || TextLocator.UniqueIndex(guards.Replace, value) < 0 || !UIA.SelectText(current, guards.Replace, token))
                { v.Refusal = "text-changed"; return v; }
            }
            v.Current = current;
            v.Before = ControlState.Read(current);
            return v;
        }

        static DeliveryResult DeliverInner(TargetSnapshot snapshot, string text, DeliveryGuards guards, DeliveryTimings timings, int deadlineMs, int alreadyElapsedMs, BoundedStats stats)
        {
            // The deadline is measured from when the request was received, not from here: a
            // deliver stuck behind a slow UIA call must not begin after the app gave up.
            Stopwatch began = Stopwatch.StartNew();
            Func<long> elapsed = () => began.ElapsedMilliseconds + alreadyElapsedMs;
            // The snapshot could not be taken completely (a provider overran, or too many calls were
            // stuck): nothing it says about the field can be trusted.
            if (snapshot.Incomplete != null) return new DeliveryResult(DeliveryOutcome.Refused, snapshot.Incomplete);
            if (!snapshot.HasElement || snapshot.Facts == null) return new DeliveryResult(DeliveryOutcome.Refused, "no-target");
            Validation v;
            bool selectionMayHaveChanged;
            Bounded.Outcome validated = Bounded.Call(token => Validate(snapshot, guards, token), ValidateBudgetMs, out v, out selectionMayHaveChanged);
            if (validated == Bounded.Outcome.Busy) return new DeliveryResult(DeliveryOutcome.Refused, "helper-busy");
            // The validation overran while selecting the text an undo replaces: that selection may land
            // in the app after this refusal. Nothing is inserted, but the field may now show a selection,
            // so the result is uncertain (the host keeps the text and never retries on its own).
            if (validated != Bounded.Outcome.Ok && selectionMayHaveChanged) return new DeliveryResult(DeliveryOutcome.Uncertain, "selection-may-have-changed");
            if (validated != Bounded.Outcome.Ok) return new DeliveryResult(DeliveryOutcome.Refused, "target-unverifiable");
            if (v.Refusal != null) return new DeliveryResult(DeliveryOutcome.Refused, v.Refusal);
            AutomationElement current = v.Current;
            ControlState before = v.Before;
            timings.ValidateMs = Ms(began);

            // Windows has no caret insertion through UI Automation (ValuePattern replaces
            // the whole field), so text goes in the way people paste: the clipboard and
            // Ctrl+V, with the clipboard put back. Synthetic Unicode typing is the fallback
            // when the clipboard cannot be used. DICTATION_HELPER_STRATEGY=type forces the fallback
            // in a test build only (TestMode); the shipped helper has no such switch.
            bool forceType = TestMode.Env("DICTATION_HELPER_STRATEGY") == "type";
            // The client sized its wait from the text length; never begin an insertion it has
            // already given up on, or doubled text could land after the user pastes from the card.
            if (deadlineMs > 0 && !forceType && elapsed() + PasteEstimateMs > deadlineMs
                && elapsed() + TypeEstimateMs(text) > deadlineMs)
                return new DeliveryResult(DeliveryOutcome.Refused, "deadline-exceeded");
            // What happened to the user's clipboard when a paste could not complete, so the typing
            // fallback reports it instead of "untouched".
            string clipboardAfterPaste = "untouched", holdsAfterPaste = null;
            ClipboardText.LateWrite lateWrite = null;
            if (!forceType)
            {
                if (deadlineMs == 0 || elapsed() + PasteEstimateMs <= deadlineMs)
                {
                    Func<bool> stillInTime = delegate { return deadlineMs == 0 || elapsed() + PasteEstimateMs <= deadlineMs; };
                    DeliveryResult pasted = Paste(text, current, snapshot, before, timings, stillInTime, out clipboardAfterPaste, out holdsAfterPaste, out lateWrite);
                    if (pasted != null) return pasted;
                }
            }
            if (deadlineMs > 0 && elapsed() + TypeEstimateMs(text) > deadlineMs)
            {
                DeliveryResult late = new DeliveryResult(DeliveryOutcome.Refused, "deadline-exceeded");
                late.Clipboard = clipboardAfterPaste;
                late.ClipboardHolds = holdsAfterPaste;
                LatestClipboard(late, lateWrite);
                return late;
            }
            Wire.Log("deliver: the paste could not be used; the typing fallback starts at " + elapsed() + " ms");
            DeliveryResult typed = TypeText(text, snapshot, timings, deadlineMs, elapsed, stats);
            Wire.Log("deliver: typing ended at " + elapsed() + " ms");
            if (typed.Clipboard == "untouched")
            {
                typed.Clipboard = clipboardAfterPaste;
                typed.ClipboardHolds = holdsAfterPaste;
            }
            LatestClipboard(typed, lateWrite);
            return typed;
        }

        /// <summary>
        /// Every reply says the latest known clipboard outcome: an abandoned write that finished its
        /// rollback meanwhile has a real result by now (the late event says it too, naming this delivery).
        /// </summary>
        static void LatestClipboard(DeliveryResult result, ClipboardText.LateWrite lateWrite)
        {
            if (lateWrite == null || lateWrite.Outcome == null) return;
            result.Clipboard = lateWrite.Outcome;
            result.ClipboardHolds = lateWrite.Holds;
        }

        /// <summary>
        /// Null when the clipboard could not be used (nothing was pasted; the typing fallback may run).
        /// `clipboardAfterFailedWrite` (and `holdsAfterFailedWrite` for "unrestored") report what
        /// happened to the user's clipboard in that case.
        /// </summary>
#if DICTATION_TEST
        /// <summary>
        /// Test build only (the __clipboard-txn op): one clipboard transaction exactly as a paste runs it
        /// (save, record, bounded write, hold, restore), without a target or Ctrl+V, so recovery can be
        /// exercised natively without any window in front.
        /// </summary>
        public static string TestTransaction(string text, int holdMs)
        {
            SavedClipboard saved;
            ClipboardOwnership ours;
            ClipboardText.LateWrite late;
            bool written;
            string notStarted = BeginClipboardWrite(text, out saved, out ours, out written, out late,
                delegate (SavedClipboard s) { Wire.Log("test: saved formats [" + s.DescribeFormats() + "]"); });
            if (notStarted != null) return notStarted;
            string savedFormats = saved.DescribeFormats();
            if (late != null) return "late|" + savedFormats;
            if (!written)
            {
                string failed = ours.PutBack ?? (ours.Emptied ? saved.Restore(ours) : "untouched");
                saved.Settle(failed);
                return "write-failed/" + failed + "|" + savedFormats;
            }
            if (TestMode.Env("DICTATION_HELPER_TEST_THROW_AFTER_WRITE") == "1")
            {
                // The real after-write path: PasteAfterWrite throws (its own test hook) and the delivery's
                // catch puts the clipboard back and settles the record.
                try { PasteAfterWrite(text, null, null, null, new DeliveryTimings(), saved, ours, written, Stopwatch.StartNew(), out notStarted, out notStarted); }
                catch (Exception error)
                {
                    string clip, holds;
                    RestoreAfterFailure(saved, ours, error, out clip, out holds);
                    return "thrown/" + clip + "|" + savedFormats;
                }
            }
            if (holdMs > 0) Thread.Sleep(holdMs);
            // As before Ctrl+V (the real check): a clipboard that changed hands meanwhile is left alone; one that could
            // not be looked at keeps its record (the restore below then runs only on proof, or is kept for a retry).
            if (!ours.LooksOurs())
            {
                uint seen;
                SavedClipboard.Inspection look = saved.InspectOurWrite(ours, out seen);
                if (look == SavedClipboard.Inspection.Foreign) { saved.KeepAsOffer("the clipboard changed hands"); return "user-changed|" + savedFormats; }
                if (look == SavedClipboard.Inspection.Uninspectable) return "uninspectable/" + saved.Restore(ours) + "|" + savedFormats;
                if (look == SavedClipboard.Inspection.OwnedButChanged) { saved.KeepAsOffer("owned but not exactly our write"); return "owned-but-changed/unrestored|" + savedFormats; }
            }
            // Test build only: be killed after the "paste" and before the restore.
            int beforeRestore = TestMode.Int("DICTATION_HELPER_TEST_STALL_BEFORE_RESTORE_MS", 0);
            if (beforeRestore > 0) Thread.Sleep(beforeRestore);
            // Test build only: a target that pastes by reading the synthesized ANSI text formats (an ANSI or
            // RichEdit app does), on another thread right after "Ctrl+V", as a real target would.
            if (TestMode.Env("DICTATION_HELPER_TEST_TARGET_READ") == "ansi") SimulateAnsiTargetRead();
            string put = saved.Restore(ours);
            // Round 22: what the delivery's reply would name as not put back (clipboardMissing).
            DeliveryResult notes = new DeliveryResult(DeliveryOutcome.Delivered, null) { Clipboard = put };
            ClipboardNotes(notes, saved, null);
            return put + "|" + savedFormats + (notes.ClipboardMissing != null ? "|missing=" + string.Join(";", notes.ClipboardMissing.ToArray()) : "");
        }

        /// <summary>
        /// Test build only (round 22, the __seed op): this helper's own window becomes the clipboard's owner with the
        /// given formats ("name|base64" or "#id|base64"; "-" for no data: a format offered for delayed rendering that
        /// this window never renders, as Explorer's or Outlook's FileContents can be, and as presence-only formats are).
        /// Its window pumps messages, so a render request is answered (with nothing) instead of waiting.
        /// </summary>
        public static Dictionary<string, object> TestSeed(List<string> items)
        {
            if (!ClipboardText.Open()) return Wire.Fields("seeded", false, "why", "not opened");
            try
            {
                if (!Native.EmptyClipboard()) return Wire.Fields("seeded", false, "why", "not emptied");
                foreach (string item in items)
                {
                    int bar = item.IndexOf('|');
                    if (bar <= 0) return Wire.Fields("seeded", false, "why", "malformed item");
                    string key = item.Substring(0, bar), data = item.Substring(bar + 1);
                    uint format = key.StartsWith("#") ? uint.Parse(key.Substring(1)) : Native.RegisterClipboardFormat(key);
                    bool ok;
                    if (data == "-") { Native.SetClipboardData(format, IntPtr.Zero); ok = Native.IsClipboardFormatAvailable(format); }
                    else ok = ClipboardText.SetBytes(format, Convert.FromBase64String(data));
                    if (!ok) return Wire.Fields("seeded", false, "why", "format " + key + " not set");
                }
                return Wire.Fields("seeded", true, "sequence", (double)Native.GetClipboardSequenceNumber());
            }
            finally { Native.CloseClipboard(); }
        }

        static void SimulateAnsiTargetRead()
        {
            uint before = Native.GetClipboardSequenceNumber();
            Thread reader = new Thread(delegate ()
            {
                bool opened = false;
                for (int attempt = 0; attempt < 50 && !(opened = Native.OpenClipboard(IntPtr.Zero)); attempt++) Thread.Sleep(10);
                if (!opened) { Wire.Log("test: the simulated target could not open the clipboard"); return; }
                try { foreach (uint f in new uint[] { 1, 7, 16 }) Native.GetClipboardData(f); }
                finally { Native.CloseClipboard(); }
            });
            reader.SetApartmentState(ApartmentState.STA);
            reader.Start();
            reader.Join(2000);
            Wire.Log("test: a target read CF_TEXT, CF_OEMTEXT and CF_LOCALE; the sequence moved " + before + " -> " + Native.GetClipboardSequenceNumber());
        }
#endif

        /// <summary>Wall-clock bound for our clipboard write (open, empty, set, close) on its own thread.</summary>
        const int WriteBudgetMs = 1000;

        static DeliveryResult Paste(string text, AutomationElement element, TargetSnapshot snapshot, ControlState before, DeliveryTimings timings, Func<bool> stillInTime, out string clipboardAfterFailedWrite, out string holdsAfterFailedWrite, out ClipboardText.LateWrite lateWrite)
        {
            clipboardAfterFailedWrite = "untouched";
            holdsAfterFailedWrite = null;
            lateWrite = null;
            Stopwatch insert = Stopwatch.StartNew();
            SavedClipboard saved;
            ClipboardOwnership ours;
            ClipboardText.LateWrite late;
            bool written;
            if (BeginClipboardWrite(text, out saved, out ours, out written, out late, null, stillInTime) != null) return null;
            lateWrite = late;
            if (late != null)
            {
                // Our write is still waiting inside EmptyClipboard on the owner. When that returns, the
                // write puts the user's saved content back instead of ours (and finishes the record, and
                // tells the app); until then nobody can say what the clipboard will hold, so the result
                // says so (and nothing is pasted).
                Wire.Log("emptying the clipboard is waiting on its owner; not pasting (the saved content goes back when it returns)");
                clipboardAfterFailedWrite = "unrestored";
                holdsAfterFailedWrite = "unknown";
                return null;
            }
            try
            {
                return PasteAfterWrite(text, element, snapshot, before, timings, saved, ours, written, insert, out clipboardAfterFailedWrite, out holdsAfterFailedWrite);
            }
            catch (Exception error)
            {
                DeliveryResult failed = new DeliveryResult(DeliveryOutcome.Uncertain, "insertion-unverifiable");
                failed.Method = "paste";
                RestoreAfterFailure(saved, ours, error, out clipboardAfterFailedWrite, out holdsAfterFailedWrite);
                failed.Clipboard = clipboardAfterFailedWrite;
                failed.ClipboardHolds = holdsAfterFailedWrite;
                return failed;
            }
        }

        /// <summary>
        /// Everything a paste does before the keys (shared with the test transaction op): an earlier
        /// transaction gets its chance first, the user's clipboard is saved (bounded, in the reader
        /// process), an owner that does not answer is never asked to empty, the transaction is written
        /// down, and our bounded write runs. Null when the write ran (see `written` and `late`); otherwise
        /// why it did not start (nothing of the user's was touched).
        /// </summary>
        static string BeginClipboardWrite(string text, out SavedClipboard saved, out ClipboardOwnership ours, out bool written, out ClipboardText.LateWrite late, Action<SavedClipboard> afterSave = null, Func<bool> stillInTime = null)
        {
            ours = new ClipboardOwnership();
            written = false;
            late = null;
            saved = null;
            // Round 22: without the helper's own window nothing is opened at all (no save, no write): not pasting.
            if (Ui.ClipboardWindow == IntPtr.Zero) { Wire.Log("the helper has no clipboard window; not pasting (nothing opened)"); deliveryNoSave = "no-window"; return "no-save"; }
            // An earlier transaction that could not be put back gets its chance first (before our write).
            PendingClipboard.RecoverLeftover("delivery");
            // That check can take a while with several kept records (each opens the clipboard): the paste starts only if it
            // still fits the delivery's deadline (otherwise nothing of the user's is touched; the typing fallback decides).
            if (stillInTime != null && !stillInTime()) { Wire.Log("the paste no longer fits the deadline after the kept-records check; not pasting"); deliveryNoSave = "deadline"; return "deadline"; }
            // Round 22 (F4, the bound 1): an owner that does not answer a WM_NULL now is never asked to render either (the
            // save would wait in its render): checked BEFORE the save, and again after it (below) before emptying.
            string unresponsiveBefore = ClipboardText.OwnerUnresponsive();
            if (unresponsiveBefore != null)
            {
                Wire.Log("the clipboard's owner is not responding before the save (" + unresponsiveBefore + "); not saving, not pasting");
                deliveryNoSave = "owner-unresponsive";
                return "owner-unresponsive";
            }
            // Saving the user's clipboard renders lazily-provided formats (OLE "Embed Source" and the
            // like), which can take arbitrarily long; it runs in the reader process, bounded per format.
            saved = SavedClipboard.CaptureBounded(CaptureBudgetMs);
            if (saved == null)
            {
                deliveryNoSave = SavedClipboard.LastNoSaveReason ?? "unreadable";
                Wire.Log("not pasting: the clipboard could not be saved (" + deliveryNoSave + ")");
                return "no-save";
            }
            deliverySave = saved;
            if (afterSave != null) afterSave(saved);
            // Emptying the clipboard sends WM_DESTROYCLIPBOARD to its owner and waits for its answer
            // (measured on Dev04: Windows gave up after about 5.2 s on a hung owner). An owner that does
            // not answer a WM_NULL now is not asked at all; one that answers and then stalls is bounded
            // by the write's own thread (WriteBounded).
            string ownerProblem = ClipboardText.OwnerUnresponsive();
            if (ownerProblem != null)
            {
                Wire.Log("the clipboard's owner is not responding (" + ownerProblem + "); not pasting");
                deliveryNoSave = "owner-unresponsive";
                return "owner-unresponsive";
            }
            // Round 22 (S2): a zero sequence now is no evidence the clipboard is still what was saved: nothing is written
            // down and nothing touched (checked again under the write's own lock).
            if (ClipboardText.Sequence("begin") == 0 || saved.Sequence == 0)
            {
                Wire.Log("the clipboard sequence is not usable evidence (0) before the transaction; not pasting (no record, nothing touched)");
                deliveryNoSave = "zero-sequence";
                return "zero-sequence";
            }
            // The transaction is written down until its restore ran, so a helper that ends meanwhile
            // loses nothing (see PendingClipboard; content with a privacy marker stays in memory only).
            // Without a record, no paste.
            PendingRecord record = PendingClipboard.Begin(saved, text);
            if (record == null) { deliveryNoSave = "no-record"; return "no-record"; }
            saved.Record = record;
            written = ClipboardText.WriteBounded(text, out ours, saved, WriteBudgetMs, out late);
            return null;
        }

        /// <summary>
        /// Whatever failed after our write, the user's clipboard is put back now if we emptied it; the
        /// record is deleted only if that restore ran (else it is kept for a retry).
        /// </summary>
        static void RestoreAfterFailure(SavedClipboard saved, ClipboardOwnership ours, Exception error, out string clipboard, out string holds)
        {
            Wire.Log("ERROR: the paste failed after our clipboard write (" + error.GetType().Name + "); restoring the clipboard");
            // Round 23 (B1): a rollback the write completed itself is its own result; emptied otherwise: the restore decides.
            clipboard = ours == null ? "untouched" : ours.PutBack ?? (ours.Emptied ? saved.Restore(ours) : "untouched");
            saved.Settle(clipboard);
            holds = saved.Holds;
        }

        static DeliveryResult PasteAfterWrite(string text, AutomationElement element, TargetSnapshot snapshot, ControlState before, DeliveryTimings timings, SavedClipboard saved, ClipboardOwnership ours, bool written, Stopwatch insert, out string clipboardAfterFailedWrite, out string holdsAfterFailedWrite)
        {
            clipboardAfterFailedWrite = "untouched";
            holdsAfterFailedWrite = null;
            if (!written)
            {
                // The write failed part-way. If we emptied the clipboard, the user's content is gone from it unless it
                // is put back now (before any typing fallback). Restore writes only on proof: a partial write of ours is
                // no proof (another app may have added to it), so then the record is kept as an offer instead.
                if (ours.PutBack != null || !ours.Emptied)
                {
                    // The write put the saved content back itself and that rollback COMPLETED (its emptied stage could
                    // not be journaled, or it was abandoned), or it never emptied anything.
                    clipboardAfterFailedWrite = ours.PutBack ?? "untouched";
                    saved.Settle(clipboardAfterFailedWrite);
                }
                else
                {
                    // Emptied, and no completed rollback (round 23, B1: also a rollback that threw part-way): the restore
                    // decides; a transaction that lost its authority keeps its record, as an offer, never "untouched".
                    clipboardAfterFailedWrite = saved.Restore(ours);
                    holdsAfterFailedWrite = saved.Holds;
                }
                return null;
            }
            // Test build only: something fails right after our write.
            if (TestMode.Env("DICTATION_HELPER_TEST_THROW_AFTER_WRITE") == "1") throw new InvalidOperationException("test: thrown after the clipboard write");
            // Before Ctrl+V, the same order the typing path uses: every call that can block first (the
            // wait for held modifiers, the provider's focus and password reads, the classic control's
            // EM_GETPASSWORDCHAR), then the cheap checks LAST, immediately before SendInput, with nothing
            // that can block in between: same foreground process, same focused window, no password or
            // read-only style, and the clipboard still our write. Anything that cannot be read refuses;
            // nothing is pasted on a guess. A change the app makes after the keys are queued cannot be
            // seen by any check (cross-process checks and input injection are never atomic).
            // The wait for held modifiers comes FIRST (it can take 500 ms), so the mask query is the last
            // blocking call before the final checks.
            string unsafeReason = ReleaseModifiers() ? null : "focus-changed";
            if (unsafeReason == null) unsafeReason = PasteProviderGuard(snapshot);
            if (unsafeReason == null) unsafeReason = PasteMaskGuard(snapshot);
            // The clipboard must still be our write, or Ctrl+V would paste someone else's content (another app
            // copied between our write and now). This look can block (it opens the clipboard), so it comes BEFORE
            // the final checks. A moved sequence alone is not someone else's copy: our window owning the clipboard
            // with our complete write on it (every format compared) is still ours. Someone else's content: nothing is
            // pasted, their copy is left alone and the saved clipboard is kept as an offer. A clipboard that could not be
            // looked at: nothing is pasted, nothing settled.
            bool sequenceProof = true;
            uint inspectedSequence = 0;
            if (unsafeReason == null && !ours.LooksOurs())
            {
                SavedClipboard.Inspection look = saved.InspectOurWrite(ours, out inspectedSequence);
                if (look == SavedClipboard.Inspection.Foreign)
                {
                    // Another owner proves someone emptied the clipboard, not that the user made a newer copy (a clipboard
                    // tool rewriting every copy, a remote echo): their content is left alone, and the user's saved
                    // clipboard is kept as an offer, never deleted on that guess.
                    Wire.Log("the clipboard changed hands before Ctrl+V; not pasting (the saved clipboard is kept as an offer)");
                    clipboardAfterFailedWrite = "user-changed";
                    saved.KeepAsOffer("the clipboard changed hands before Ctrl+V");
                    return null;
                }
                if (look == SavedClipboard.Inspection.Uninspectable)
                {
                    Wire.Log("the clipboard could not be looked at before Ctrl+V; not pasting (the record is kept)");
                    clipboardAfterFailedWrite = saved.Restore(ours);
                    holdsAfterFailedWrite = saved.Holds;
                    return null;
                }
                if (look == SavedClipboard.Inspection.OwnedButChanged)
                {
                    Wire.Log("our window still owns the clipboard but our write is not all there; not pasting (kept, as an offer)");
                    saved.KeepAsOffer("owned but not exactly our write, before Ctrl+V");
                    clipboardAfterFailedWrite = "unrestored";
                    holdsAfterFailedWrite = "unknown";
                    return null;
                }
                sequenceProof = false;
            }
            // The cheap checks LAST, immediately before SendInput, with nothing that can block in between: same
            // foreground process, same focused window, no password or read-only style, no modifier held, and the
            // clipboard still as the look above left it (owner and sequence, read without opening it).
            if (unsafeReason == null) unsafeReason = PasteFinalGuard(snapshot);
            if (unsafeReason == null && !(sequenceProof ? ours.LooksOurs() : ours.UnchangedSince(inspectedSequence))) unsafeReason = "clipboard-changed";
            if (unsafeReason != null)
            {
                DeliveryResult moved = new DeliveryResult(DeliveryOutcome.Refused, unsafeReason);
                if (unsafeReason == "clipboard-changed") Wire.Log("the clipboard changed right before Ctrl+V; not pasting");
                moved.Method = "paste";
                moved.Clipboard = saved.Restore(ours);
                moved.ClipboardHolds = saved.Holds;
                return moved;
            }
            uint sent = Native.Send(new[]
            {
                Native.Key(Native.VK_CONTROL, false, false), Native.Key(Native.VK_V, false, false),
                Native.Key(Native.VK_V, true, false), Native.Key(Native.VK_CONTROL, true, false)
            });
            if (sent != 4)
            {
                DeliveryResult failed = new DeliveryResult(DeliveryOutcome.Failed, "keystroke-unavailable");
                failed.Method = "paste";
                failed.Clipboard = saved.Restore(ours);
                failed.ClipboardHolds = saved.Holds;
                return failed;
            }
            timings.InsertMs += Ms(insert);
            // Test build only: the cap is hit right after Ctrl+V (as stuck post-paste reads would do), so
            // the restart must still wait for this delivery's restore and reply.
            if (TestMode.Env("DICTATION_HELPER_TEST_SATURATE_AFTER_PASTE") == "1") Bounded.TestSaturate();

            bool verified = false;
            Stopwatch confirm = Stopwatch.StartNew();
            if (before.Observable) verified = Changed(element, before, 800);
            timings.ConfirmMs += Ms(confirm);
            // The target reads the clipboard asynchronously after the keystroke.
            // Restoring too early would paste the user's old clipboard instead.
            if (!verified)
            {
                Stopwatch settle = Stopwatch.StartNew();
                Thread.Sleep(600);
                timings.SettleMs = Ms(settle);
            }
            else
            {
                // Seen in the field; give a slow reader a moment before the old clipboard returns.
                Thread.Sleep(60);
            }
            int extraDelay = TestMode.Int("DICTATION_HELPER_TEST_RESTORE_DELAY_MS", 0);
            if (extraDelay > 0) Thread.Sleep(extraDelay);
            string clipboard = saved.Restore(ours);
            DeliveryResult result = verified
                ? new DeliveryResult(DeliveryOutcome.Delivered, null)
                : new DeliveryResult(DeliveryOutcome.Uncertain, "insertion-unverifiable");
            result.Method = "paste";
            result.Verified = verified;
            result.Clipboard = clipboard;
            result.ClipboardHolds = saved.Holds;
            return result;
        }

        /// <summary>
        /// The provider part of the check before Ctrl+V (it can block, so it comes first): one bounded
        /// UIA call in which the control is still focused and a fresh IsPassword on the cached element
        /// reads false. Unreadable or slow → target-unverifiable.
        /// </summary>
        static string PasteProviderGuard(TargetSnapshot snapshot)
        {
            if (snapshot.Element == null) return null;
            string reason;
            Bounded.Outcome outcome = Bounded.Call(delegate (CallToken token)
            {
                AutomationElement current;
                if (!Target.StillFocused(snapshot, out current)) return "focus-changed";
                bool? secure = UIA.TryIsPassword(snapshot.Element);
                if (secure == null) return "target-unverifiable";
                return secure.Value ? "secure-field" : null;
            }, GuardBudgetMs, out reason);
            if (outcome == Bounded.Outcome.Busy) return "helper-busy";
            if (outcome != Bounded.Outcome.Ok) return "target-unverifiable";
            return reason;
        }

        /// <summary>
        /// A classic text box (by class, decided with no message sent) can be masked by EM_SETPASSWORDCHAR
        /// alone, which no style or provider shows: ask it (bounded). Not a classic box: nothing to ask.
        /// </summary>
        static string PasteMaskGuard(TargetSnapshot snapshot)
        {
            IntPtr focus = FocusWindow();
            if (focus == IntPtr.Zero || !ClassicTextBox.IsKnownTextBox(focus)) return null;
            bool? masked = ClassicTextBox.PasswordCharOf(focus);
            if (masked == null) return "target-unverifiable";
            return masked.Value ? "secure-field" : null;
        }

        /// <summary>
        /// The last check before Ctrl+V, with no message sent (GetForegroundWindow, GetGUIThreadInfo,
        /// GetWindowLong only): the foreground process is the snapshot's, its focused window is the
        /// snapshot's (whenever the snapshot knew it), and a focused classic text box has neither the
        /// password nor the read-only style.
        /// </summary>
        static string PasteFinalGuard(TargetSnapshot snapshot)
        {
            IntPtr foreground = Native.GetForegroundWindow();
            if (foreground == IntPtr.Zero) return "focus-changed";
            uint pid;
            uint thread = Native.GetWindowThreadProcessId(foreground, out pid);
            if (pid != snapshot.Pid) return "focus-changed";
            Native.GUITHREADINFO gui = Target.GuiInfo(thread);
            if (snapshot.FocusWindow != IntPtr.Zero ? gui.hwndFocus != snapshot.FocusWindow : snapshot.Element == null) return "focus-changed";
            if (Target.IsPasswordEdit(gui.hwndFocus)) return "secure-field";
            if (gui.hwndFocus != IntPtr.Zero && ClassicTextBox.IsKnownTextBox(gui.hwndFocus))
            {
                if (ClassicTextBox.HasStyle(gui.hwndFocus, ClassicTextBox.ES_PASSWORD)) return "secure-field";
                if (ClassicTextBox.HasStyle(gui.hwndFocus, ClassicTextBox.ES_READONLY)) return "not-editable";
            }
            // A modifier pressed again after the release earlier would turn Ctrl+V into another shortcut
            // (Win+Ctrl+V, Ctrl+Shift+V): never sent then.
            if (ModifiersDown()) return "keys-held";
            return null;
        }

        /// <summary>Shift, Ctrl, Alt or Win is down right now (GetAsyncKeyState; no message).</summary>
        static bool ModifiersDown()
        {
            foreach (int vk in new[] { Native.VK_LSHIFT, Native.VK_RSHIFT, Native.VK_LCONTROL, Native.VK_RCONTROL, Native.VK_LMENU, Native.VK_RMENU, Native.VK_LWIN, Native.VK_RWIN })
                if (Native.IsDown(vk)) return true;
            return false;
        }

        /// <summary>The focused window of the foreground thread.</summary>
        static IntPtr FocusWindow()
        {
            IntPtr foreground = Native.GetForegroundWindow();
            if (foreground == IntPtr.Zero) return IntPtr.Zero;
            uint pid;
            uint thread = Native.GetWindowThreadProcessId(foreground, out pid);
            return Target.GuiInfo(thread).hwndFocus;
        }

        /// <summary>
        /// The typing fallback, for classic Win32 text boxes only (ClassicTextBox). Refused up front, with
        /// nothing sent, when the focused window is unknown (WebView2, CEF and Gecko hosts report a
        /// window the helper cannot attribute) or is not the snapshot's, when it is not a classic text box
        /// (every UIA-only app: browsers, Electron, Firefox, Java, Qt, XAML/UWP, Office), when the
        /// pre-flight probe does not answer in time, or when it would type over a RichEdit selection
        /// (RichEdit positions and lengths count a paragraph break differently). For EVERY key, the
        /// blocking queries come first (the field still has the length the previous key left, a readable
        /// selection, no password character), and the cheap checks come LAST, immediately before
        /// SendInput: the foreground process and focused window are still the snapshot's very box, and
        /// ES_PASSWORD / ES_READONLY are clear (fresh GetWindowLong), so a change during a slow query is
        /// caught before the key goes out. Line breaks: an Edit gets a Unicode CR (VK_PACKET, so no dialog
        /// ever sees a Return key), and only when the box takes it (ES_WANTRETURN, or a WinForms EDIT); a
        /// RichEdit ignores that CR and needs a real Return key, which a dialog or form may turn into its
        /// OK / AcceptButton whatever its buttons look like, so a RichEdit gets one only with ES_WANTRETURN.
        /// Otherwise text with a line break is refused up front ("line-break-unsupported"). After each
        /// key the length must move by exactly the units the key adds minus the selection it replaces;
        /// after the last key the whole text must read back as expected. Anything else stops typing at once (uncertain), with the reason, the number of keys
        /// confirmed, and whether one key was sent but not confirmed.
        /// </summary>
        static DeliveryResult TypeText(string text, TargetSnapshot snapshot, DeliveryTimings timings, int deadlineMs, Func<long> elapsed, BoundedStats stats)
        {
            Stopwatch insert = Stopwatch.StartNew();
            string normalized = text.Replace("\r\n", "\n").Replace('\r', '\n');
            string refusal = null;
            IntPtr focusWindow = FocusWindow();
            // Without a focused window there is nothing to read per keystroke: refuse, never guess.
            if (focusWindow == IntPtr.Zero) refusal = "target-unverifiable";
            else if (snapshot.FocusWindow == IntPtr.Zero || focusWindow != snapshot.FocusWindow) refusal = "focus-changed";
            ClassicTextBox box = null;
            if (refusal == null) box = ClassicTextBox.Probe(focusWindow, out refusal);
            // Line breaks: a single-line box has nowhere to put one. A RichEdit only takes a real Return
            // key. A dialog (IsDialogMessage sends IDOK even with no default button) or a WinForms form
            // (AcceptButton is managed code, and the button need not carry BS_DEFPUSHBUTTON) can turn that
            // key into "OK", and no button scan can rule it out; so a RichEdit gets Return only when it asks
            // for it itself (ES_WANTRETURN). An Edit takes a Unicode CR (no Return key exists then); a plain
            // Win32 Edit without ES_WANTRETURN drops it in a dialog, so it is refused there too. WinForms
            // EDIT boxes take the CR (measured, AcceptButton never pressed). Refused up front, nothing sent.
            bool hasBreak = normalized.IndexOf('\n') >= 0;
            if (refusal == null && hasBreak)
            {
                bool takesBreak = box.Multiline && (box.RichEdit ? box.WantReturn : box.WinFormsClass || box.WantReturn);
                if (!takesBreak)
                {
                    refusal = "line-break-unsupported";
                    Wire.Log("typing: this box does not take a line break from dictation (refused before any key)");
                }
            }
            // What the field holds before the first key, and where the text goes: the whole text must read
            // back exactly as this plus what was typed (a same-length autocorrect cannot pass).
            string before = refusal == null ? box.Text() : null;
            int selStart = 0, selEnd = 0;
            if (refusal == null && (before == null || !box.Selection(out selStart, out selEnd))) refusal = "target-unverifiable";
            if (refusal == null && box.RichEdit && selEnd > selStart) refusal = "typing-unsupported";
            if (refusal == null && !ReleaseModifiers()) refusal = "focus-changed";
            long confirmed = refusal == null ? box.Length() : -1;
            if (refusal == null && confirmed < 0) refusal = "target-unverifiable";
            if (refusal == null) refusal = TypingGuard(snapshot, box);
            string expectedText = null;
            if (refusal == null)
            {
                int offset = box.OffsetInText(before, selStart), end = box.OffsetInText(before, selEnd);
                if (offset < 0 || end < offset) refusal = "target-unverifiable";
                else expectedText = before.Substring(0, offset) + normalized.Replace("\n", "\r\n") + before.Substring(end);
            }
            if (refusal != null)
            {
                DeliveryResult refused = new DeliveryResult(DeliveryOutcome.Refused, refusal);
                refused.Method = "type";
                refused.ProviderSlowestMs = stats.SlowestMs;
                return refused;
            }
            GuardStats guardStats = new GuardStats();
            GuardStats settleStats = new GuardStats();
            // The typing rate is measured from the first key sent, never including the checks above.
            Stopwatch rate = null;
            int keysConfirmed = 0;
            int charsTyped = 0;
            bool unconfirmed = false;
            string abortReason = null;
            for (int i = 0; i < normalized.Length; i++)
            {
                long guardStart = Stopwatch.GetTimestamp();
                string unsafeReason = null;
                // The blocking queries first. Nothing may have changed the field since the previous key.
                long now = box.Length();
                if (now < 0) { unsafeReason = "target-unverifiable"; Wire.Log("typing: the field did not answer its length"); }
                else if (now != confirmed) { unsafeReason = "target-changed"; Wire.Log("typing: the field changed between keys (" + confirmed + " -> " + now + ")"); }
                int selection = unsafeReason == null ? box.SelectionLength() : 0;
                if (unsafeReason == null && selection < 0) { unsafeReason = "target-unverifiable"; Wire.Log("typing: the selection could not be read: " + box.LastSelectionError); }
                if (unsafeReason == null && box.RichEdit && selection > 0) { unsafeReason = "target-changed"; Wire.Log("typing: a selection appeared in the RichEdit"); }
                if (unsafeReason == null)
                {
                    bool? password = box.PasswordCharSet();
                    if (password == null) unsafeReason = "target-unverifiable";
                    else if (password.Value) unsafeReason = "secure-field";
                }
                if (unsafeReason == null && deadlineMs > 0 && elapsed() > deadlineMs) unsafeReason = "deadline-exceeded";
                // A target that processes keys slowly (but observably) would run past the deadline
                // part-way through: once the rate is known from at least 10 keys, stop at once if the
                // rest cannot finish in time, rather than typing most of the text and stopping late.
                if (unsafeReason == null && deadlineMs > 0 && rate != null && charsTyped >= 10)
                {
                    double perChar = rate.ElapsedMilliseconds / (double)charsTyped;
                    if (elapsed() + perChar * (normalized.Length - i) > deadlineMs) unsafeReason = "deadline-exceeded";
                }
                char unit = normalized[i];
                Native.INPUT[] pair;
                int start = i;
                int units;
                bool surrogate = false;
                if (unit == '\n')
                {
                    // CR LF in the text (two units, measured for Edit, RICHEDIT50W, RichEdit20W and
                    // RichEditD2DPT). An Edit gets a Unicode CR (no Return key a dialog could act on); a
                    // RichEdit ignores that and needs the Return key, allowed above only with ES_WANTRETURN.
                    pair = box.RichEdit
                        ? new[] { Native.Key(Native.VK_RETURN, false, false), Native.Key(Native.VK_RETURN, true, false) }
                        : new[] { Native.Unicode('\r', false), Native.Unicode('\r', true) };
                    units = 2;
                }
                else if (char.IsHighSurrogate(unit) && i + 1 < normalized.Length)
                {
                    // A surrogate pair goes as one call, so the character is never split.
                    char low = normalized[i + 1];
                    pair = new[] { Native.Unicode(unit, false), Native.Unicode(low, false), Native.Unicode(unit, true), Native.Unicode(low, true) };
                    units = 2;
                    surrogate = true;
                }
                else
                {
                    pair = new[] { Native.Unicode(unit, false), Native.Unicode(unit, true) };
                    units = 1;
                }
                long expected = confirmed + units - selection;
                // A key that would leave the length unchanged (it replaces a selection of its own size)
                // could not be told apart from a key that was never processed.
                if (unsafeReason == null && expected == confirmed) { unsafeReason = "target-unverifiable"; Wire.Log("typing: a key replacing a selection of its own size cannot be confirmed"); }
                // The cheap checks LAST, immediately before the key: same foreground, same focused box,
                // not a password box, not read-only (a change during the queries above is caught here).
                if (unsafeReason == null) unsafeReason = TypingGuard(snapshot, box);
                // A RichEdit's Return key only while the box still asks for it (fresh GetWindowLong).
                if (unsafeReason == null && unit == '\n' && box.RichEdit && !box.WantReturn) unsafeReason = "line-break-unsupported";
                guardStats.Add((Stopwatch.GetTimestamp() - guardStart) * 1000.0 / Stopwatch.Frequency);
                if (unsafeReason != null) { abortReason = unsafeReason; break; }
                if (rate == null) rate = Stopwatch.StartNew();
                uint count = Native.Send(pair);
                if (count != pair.Length)
                {
                    // Part of the key may have gone in: say so, never count it as delivered.
                    unconfirmed = count > 0;
                    abortReason = "keystroke-unavailable";
                    break;
                }
                long settleStart = Stopwatch.GetTimestamp();
                long seen;
                bool processed = box.WaitLength(confirmed, expected, KeySettleMs, surrogate, out seen);
                settleStats.Add((Stopwatch.GetTimestamp() - settleStart) * 1000.0 / Stopwatch.Frequency);
                if (!processed)
                {
                    unconfirmed = true;
                    abortReason = seen >= 0 && seen != confirmed ? "target-changed" : "target-unconfirmed";
                    break;
                }
                if (surrogate) i++;
                confirmed = expected;
                keysConfirmed++;
                charsTyped = i + 1;
                // Word boundaries are where editors run spelling and suggestions; keystrokes
                // that arrive meanwhile were seen to be dropped (Windows 11 Notepad).
                Thread.Sleep(char.IsWhiteSpace(normalized[start]) || char.IsPunctuation(normalized[start]) ? 70 : 8);
            }
            timings.InsertMs += Ms(insert);
            if (abortReason != null)
                Wire.Log("typing stopped: " + abortReason + " after " + keysConfirmed + " confirmed key(s)" + (unconfirmed ? " and one unconfirmed" : "")
                    + " (field length " + confirmed + ", class " + box.ClassName + ")");
            Func<DeliveryResult, DeliveryResult> stamp = delegate (DeliveryResult r)
            {
                r.Method = "type";
                r.CharsDelivered = charsTyped;
                r.CharsUnconfirmed = unconfirmed ? 1 : 0;
                r.Guard = guardStats;
                r.Settle = settleStats;
                r.ProviderSlowestMs = stats.SlowestMs;
                return r;
            };
            if (abortReason != null)
            {
                // Nothing sent: a plain refusal with its reason. Something sent: the text is kept and
                // must not be resent (uncertain), and the specific reason travels with the counts.
                bool anySent = keysConfirmed > 0 || unconfirmed;
                return stamp(new DeliveryResult(anySent ? DeliveryOutcome.Uncertain : DeliveryOutcome.Refused, abortReason));
            }
            Stopwatch confirm = Stopwatch.StartNew();
            // Every key was confirmed one by one; after a last quiet moment the whole text must read back
            // exactly as expected (lengths alone cannot show a same-length autocorrect). Compared in memory
            // only; the text is never logged.
            Thread.Sleep(60);
            long final = box.Length();
            string after = final >= 0 ? box.Text() : null;
            timings.ConfirmMs += Ms(confirm);
            string mismatch = null;
            if (final < 0 || after == null) mismatch = "target-unconfirmed";
            else if (final != confirmed) mismatch = "target-changed";
            else if (!string.Equals(after, expectedText, StringComparison.Ordinal)) mismatch = "insertion-mismatch";
            else if (box.StyleSecure) mismatch = "secure-field";
            if (mismatch != null) Wire.Log("typing: the field does not read back as typed (" + mismatch + ")");
            DeliveryResult result = stamp(mismatch == null
                ? new DeliveryResult(DeliveryOutcome.Delivered, null)
                : new DeliveryResult(DeliveryOutcome.Uncertain, mismatch));
            result.Verified = mismatch == null;
            return result;
        }

        /// <summary>
        /// The last check before each typed key, with no message sent (GetForegroundWindow,
        /// GetGUIThreadInfo, GetWindowLong only): the foreground process is the snapshot's, its focused
        /// window is the very text box being typed into, and that box is neither a password box nor
        /// read-only right now.
        /// </summary>
        static string TypingGuard(TargetSnapshot snapshot, ClassicTextBox box)
        {
            IntPtr foreground = Native.GetForegroundWindow();
            if (foreground == IntPtr.Zero) return "focus-changed";
            uint pid;
            uint thread = Native.GetWindowThreadProcessId(foreground, out pid);
            if (pid != snapshot.Pid) return "focus-changed";
            Native.GUITHREADINFO gui = Target.GuiInfo(thread);
            if (gui.hwndFocus != box.Window) return "focus-changed";
            if (box.StyleSecure || Target.IsPasswordEdit(gui.hwndFocus)) return "secure-field";
            if (box.StyleReadOnly) return "not-editable";
            if (ModifiersDown()) return "keys-held";
            return null;
        }

        /// <summary>
        /// Keys the user still holds (the end of a Ctrl+Alt+D shortcut) would turn Ctrl+V
        /// into another shortcut. Wait for them to come up; if they do not, lift them.
        /// </summary>
        static bool ReleaseModifiers()
        {
            int[] keys = { Native.VK_LSHIFT, Native.VK_RSHIFT, Native.VK_LCONTROL, Native.VK_RCONTROL, Native.VK_LMENU, Native.VK_RMENU, Native.VK_LWIN, Native.VK_RWIN };
            Stopwatch wait = Stopwatch.StartNew();
            while (wait.ElapsedMilliseconds < 500)
            {
                bool any = false;
                foreach (int vk in keys) if (Native.IsDown(vk)) any = true;
                if (!any) return true;
                Thread.Sleep(15);
            }
            List<Native.INPUT> lift = new List<Native.INPUT>();
            bool altOrWin = false;
            foreach (int vk in keys)
            {
                if (!Native.IsDown(vk)) continue;
                if (vk == Native.VK_LMENU || vk == Native.VK_RMENU || vk == Native.VK_LWIN || vk == Native.VK_RWIN) altOrWin = true;
                bool extended = vk == Native.VK_RCONTROL || vk == Native.VK_RMENU || vk == Native.VK_LWIN || vk == Native.VK_RWIN;
                lift.Add(Native.Key(vk, true, extended));
            }
            if (altOrWin)
            {
                lift.Insert(0, Native.Key(Native.VK_MASK, true, false));
                lift.Insert(0, Native.Key(Native.VK_MASK, false, false));
            }
            return Native.Send(lift.ToArray()) == lift.Count;
        }

        /// <summary>The control reads differently from `before` within withinMs (a read that times out never counts as a change).</summary>
        static bool Changed(AutomationElement element, ControlState before, int withinMs)
        {
            Stopwatch watch = Stopwatch.StartNew();
            do
            {
                ControlState now = ControlState.TryRead(element, ReadBudgetMs);
                if (now != null && !now.SameAs(before)) return true;
                Thread.Sleep(15);
            } while (watch.ElapsedMilliseconds < withinMs);
            return false;
        }
    }

    internal static class ClipboardText
    {
        const uint CF_UNICODETEXT = 13;

        /// <summary>
        /// Null when the clipboard's current owner (if another app's window) answers a WM_NULL within
        /// 200 ms and is not hung; otherwise why not. Checked before EmptyClipboard, which waits for the
        /// owner's WM_DESTROYCLIPBOARD. IsHungAppWindow only says the owner has not pumped messages for a
        /// while (about 5 s); an owner can pass both and still stall later, which WriteBounded covers.
        /// </summary>
        /// <summary>
        /// Round 22 (S2/F8): the clipboard sequence as every check of ours reads it. A zero is NO EVIDENCE (Windows answers
        /// 0 when it cannot tell, e.g. without access to the window station): every caller treats it as "cannot prove",
        /// never as a match. Test build: DICTATION_HELPER_TEST_ZERO_SEQUENCE=&lt;site&gt;[,&lt;site&gt;...] answers 0 there.
        /// </summary>
        internal static uint Sequence(string site)
        {
#if DICTATION_TEST
            string zero = TestMode.Env("DICTATION_HELPER_TEST_ZERO_SEQUENCE");
            if (zero != null && ("," + zero + ",").Contains("," + site + ",")) return 0; // one site, or several (comma-separated)
#endif
            return Native.GetClipboardSequenceNumber();
        }

        public static string OwnerUnresponsive()
        {
            IntPtr owner = Native.GetClipboardOwner();
            if (owner == IntPtr.Zero || owner == Ui.ClipboardWindow) return null;
            if (Native.IsHungAppWindow(owner)) return "hung";
            IntPtr result;
            int timeout = TestMode.Int("DICTATION_HELPER_TEST_OWNER_PING_MS", 200);
            IntPtr ok = Native.SendMessageTimeout(owner, Native.WM_NULL, IntPtr.Zero, IntPtr.Zero, Native.SMTO_ABORTIFHUNG | Native.SMTO_BLOCK, (uint)timeout, out result);
            return ok == IntPtr.Zero ? "no answer in " + timeout + " ms" : null;
        }

        /// <summary>
        /// Every product clipboard open of the helper (the write, the confirmation, the paste gate, the restore, the
        /// user's Restore and its view). Round 22: it REFUSES when the helper's window is zero; a NULL-window open can
        /// be taken over by another opener (round 21, CI 34) and leaves no owner, so it is never made.
        /// </summary>
        public static bool Open()
        {
            IntPtr window = Ui.ClipboardWindow;
            if (window == IntPtr.Zero) return false;
            // Another program may hold the clipboard for a moment.
            for (int attempt = 0; attempt < 12; attempt++)
            {
                if (Native.OpenClipboard(window)) return true;
                Thread.Sleep(15);
            }
            return false;
        }

        /// <summary>A write running on its own thread; Abandoned once the caller stopped waiting for it.</summary>
        /// <summary>
        /// A write on its own thread. Abandoned once the caller stopped waiting: then this is an in-flight
        /// clipboard transaction until its rollback is done, and Outcome is what happened to the clipboard.
        /// </summary>
        public sealed class LateWrite
        {
            /// <summary>0 running, 1 finished (the caller takes the result), 2 abandoned (the thread cleans up).</summary>
            public int State;
            public bool Abandoned { get { return Volatile.Read(ref State) == 2; } }
            public bool Result;
            public ClipboardOwnership Ours;
            /// <summary>The abandoned write put the saved content back itself (inside Write): its result.</summary>
            public string PutBack;
            /// <summary>The rollback's result once done (null while it still runs), and what the clipboard then holds.</summary>
            public volatile string Outcome;
            public string Holds;
        }

        /// <summary>
        /// Write (below: open, empty, set, close) on a dedicated STA thread, waited for at most budgetMs;
        /// the ownership confirmation follows on the caller's thread. EmptyClipboard waits for
        /// the owner's WM_DESTROYCLIPBOARD, and an owner that answered a WM_NULL can still stall there.
        /// On a timeout the thread is left to finish (a blocked EmptyClipboard cannot be interrupted)
        /// and is marked abandoned (late): exits wait for it (DeliveriesInFlight), and once emptying returns
        /// it puts the user's saved content back instead of our text and reports what happened.
        /// </summary>
        public static bool WriteBounded(string text, out ClipboardOwnership ownership, SavedClipboard saved, int budgetMs, out LateWrite late)
        {
            LateWrite job = new LateWrite();
            late = null;
            string deliveryId = Delivery.CurrentRequestId;
            Thread thread = new Thread(delegate ()
            {
                // Round 22 (Opus S2): the ownership object exists BEFORE the write and is the one Write fills in, so a
                // throw never replaces it: what the write did (Emptied above all) survives the exception.
                ClipboardOwnership ours = new ClipboardOwnership();
                bool ok = false;
                try { ok = Write(text, ours, saved.Sequence, job, saved, false); }
                catch (Exception error)
                {
                    ok = false;
                    Wire.Log("ERROR: the clipboard write threw (" + error.GetType().Name + ")" + (ours.Emptied ? " after emptying the clipboard: the transaction may not write on its own any more; its record is kept, as an offer" : "; nothing was emptied"));
                    // Emptied, then thrown: what is on the clipboard now is no proof of anything (ours, part of ours, or
                    // nothing). No automatic put-back: the record is kept and offered (the user decides).
                    if (ours.Emptied) { try { saved.LoseAuthority("the clipboard write threw after emptying the clipboard"); } catch (Exception) { } }
                }
                job.Ours = ours;
                job.Result = ok;
                if (Interlocked.CompareExchange(ref job.State, 1, 0) == 2)
                {
                    // Abandoned: this thread owns the rollback. If our text was already set, put the
                    // user's content back now; if it put it back while still open (Write), settle.
                    string outcome = "unrestored";
                    try
                    {
                        // Round 23 (B1): a rollback the write COMPLETED is its own result; emptied without one (our text
                        // set, or a rollback that threw part-way): the restore decides (no authority: kept, offered).
                        string completed = ours.PutBack ?? job.PutBack;
                        if (completed == null && ours.Emptied)
                        {
                            ConfirmWritten(ours, saved);
                            outcome = saved.Restore(ours);
                            Wire.Log("the late clipboard write was undone: " + outcome);
                        }
                        else outcome = completed ?? "untouched";
                        // A failed put-back stays "unrestored": its record is kept for a retry, and no warning is cleared.
                        saved.Settle(outcome);
                    }
                    catch (Exception error)
                    {
                        // Nothing more is written on its own: the transaction loses its authority (its record stays offered).
                        Wire.Log("ERROR: the late rollback failed (" + error.GetType().Name + "); kept as an offer");
                        outcome = "unrestored";
                        try { saved.KeepAsOffer("the late rollback failed"); } catch (Exception) { }
                    }
                    finally
                    {
                        job.Holds = outcome == "unrestored" ? "unknown" : null;
                        job.Outcome = outcome;
                        // Whenever it lands (before or after the reply), the app learns what happened; LateEnd runs whatever.
                        try { Wire.Send(Wire.Fields("event", "clipboard", "phase", "late-restore", "id", deliveryId ?? "", "clipboard", outcome)); }
                        finally { DeliveriesInFlight.LateEnd(); }
                    }
                }
            });
            thread.IsBackground = true;
            thread.Name = "clipboard-write";
            thread.SetApartmentState(ApartmentState.STA);
            thread.Start();
            // Exactly one side decides: the thread marks itself finished, or the caller marks it abandoned.
            DeliveriesInFlight.LateBegin();
            if (!thread.Join(Math.Max(1, budgetMs)) && Interlocked.CompareExchange(ref job.State, 2, 0) == 0)
            {
                late = job;
                ownership = new ClipboardOwnership();
                return false;
            }
            DeliveriesInFlight.LateEnd();
            thread.Join();
            ownership = job.Ours ?? new ClipboardOwnership();
            // The confirmation re-opens the clipboard while we own it (nothing waits on another app),
            // so it runs here, outside the write's bound ("written" is already journaled inside Write).
            if (ownership.Emptied && ownership.PutBack == null) ConfirmWritten(ownership, saved);
            return job.Result;
        }

        /// <summary>
        /// Put text on the clipboard, marked so clipboard history and sync skip it, and record what
        /// makes the clipboard provably ours afterwards (see ClipboardOwnership). `ownership.Emptied`
        /// is set as soon as EmptyClipboard succeeds, even if the text could not be set, so the caller
        /// can still put the user's content back. Only through WriteBounded (a transaction's record).
        /// </summary>
        static bool Write(string text, ClipboardOwnership ownership, uint expectSequence, LateWrite job, SavedClipboard saved, bool confirm)
        {
            PendingRecord record = saved != null ? saved.Record : null;
            // Test build only: this write thread uses another input language (KLID, e.g. 00000419), as a user with several has.
            // CI-only: on a real desktop with one input method for all apps this could switch the user's input language, so
            // the previous layout is activated again when the write ends (below).
            string layout = TestMode.Env("DICTATION_HELPER_TEST_KEYBOARD_LAYOUT");
            IntPtr previousLayout = IntPtr.Zero;
            if (!string.IsNullOrEmpty(layout)) { previousLayout = Native.GetKeyboardLayout(0); Native.LoadKeyboardLayoutW(layout, 1); } // KLF_ACTIVATE
            uint sequenceBeforeOpen = Native.GetClipboardSequenceNumber(); // the put-back trace (log only)
            PutBackTrace trace = null;
            if (!Open()) { if (previousLayout != IntPtr.Zero) Native.ActivateKeyboardLayout(previousLayout, 0); return false; }
            bool ok = false;
            try
            {
                // Under the lock: the clipboard must still be exactly what was saved, or emptying it
                // would discard a copy the user made after the save (it would never come back).
                // A zero is no evidence (round 21): it refuses, it never skips the comparison.
                uint sequenceNow = Native.GetClipboardSequenceNumber();
                if (TestMode.Env("DICTATION_HELPER_TEST_EXPECT_ZERO_SEQUENCE") == "1") expectSequence = 0; // test build only
                if (expectSequence == 0 || sequenceNow == 0 || sequenceNow != expectSequence)
                {
                    Wire.Log(expectSequence == 0 || sequenceNow == 0 ? "the saved sequence is not usable evidence (0); not pasting" : "the clipboard changed after it was saved; not pasting");
                    return false;
                }
                // Journaled BEFORE emptying (with the sequence before it). A transaction that cannot be
                // journaled is not started: nothing is emptied, no paste.
                if (!PendingClipboard.Stage(record, "emptying", Native.GetClipboardSequenceNumber()))
                {
                    Wire.Log("the clipboard transaction could not be journaled; not pasting (nothing emptied)");
                    ownership.JournalFailed = true;
                    return false;
                }
                // Test build only: an owner that stalls in WM_DESTROYCLIPBOARD (or a helper that dies before
                // its EmptyClipboard), without needing one.
                int stall = TestMode.Int("DICTATION_HELPER_TEST_EMPTY_STALL_MS", 0);
                if (stall > 0) Thread.Sleep(stall);
                if (Native.EmptyClipboard())
                {
                    // Round 23 (B1): the irreversible fact FIRST, on the very next statement: whatever throws from here
                    // on (a journal, a rollback, a trace), the user's content is off the clipboard and every caller knows.
                    ownership.Emptied = true;
                    // The sequence right after OUR EmptyClipboard, read under the same lock (journaled for diagnostics;
                    // since round 18 no sequence on disk is proof of anything).
                    uint emptiedAt = Native.GetClipboardSequenceNumber();
                    bool journaled = PendingClipboard.Stage(record, "emptied", emptiedAt);
                    int afterEmpty = TestMode.Int("DICTATION_HELPER_TEST_STALL_AFTER_EMPTY_MS", 0);
                    if (afterEmpty > 0) Thread.Sleep(afterEmpty); // test build only: die with the clipboard emptied
                    bool abandoned = job != null && job.Abandoned;
                    if (saved != null && (abandoned || !journaled))
                    {
                        // The caller gave up while emptying waited on the owner, or the emptied stage could not be
                        // journaled (an interruption from here on could not be proven ours): give the user's
                        // content back now, in this same open, never leave ours.
                        PendingClipboard.Stage(record, "restore-emptied", emptiedAt);
                        trace = new PutBackTrace(abandoned ? "write-rollback (late)" : "write-rollback (unjournaled)", sequenceBeforeOpen);
                        trace.Emptied(true, 0); // the write's own EmptyClipboard, just above
                        // Test build only (round 23, B1): the rollback throws before its put-back, or after it but before
                        // its result is assigned.
                        string rollbackThrow = TestMode.Env("DICTATION_HELPER_TEST_THROW_IN_ROLLBACK");
                        if (rollbackThrow == "before-set") throw new InvalidOperationException("test: thrown in the write's rollback, before its put-back");
                        bool rolledBack = saved.PutBackOpen(trace);
                        if (rollbackThrow == "after-set") throw new InvalidOperationException("test: thrown in the write's rollback, after its put-back");
                        // PutBack is assigned only for a COMPLETED rollback: it is what distinguishes it from an emptied
                        // clipboard whose rollback did not finish (Emptied is already set).
                        ownership.PutBack = saved.PutBackResult(rolledBack);
                        if (job != null) job.PutBack = ownership.PutBack;
                        saved.LoseAuthority("the write put the saved content back itself (" + ownership.PutBack + ")");
                        Wire.Log((abandoned ? "the late clipboard write" : "the unjournaled clipboard write") + " put the user's saved content back: " + ownership.PutBack);
                        return false;
                    }
                    // Test build only: the write throws right after emptying the clipboard (round 22, Opus S2).
                    if (TestMode.Env("DICTATION_HELPER_TEST_THROW_AFTER_EMPTY") == "1") throw new InvalidOperationException("test: thrown after EmptyClipboard");
                    // Test build only: simulate SetClipboardData failing after the clipboard was emptied.
                    ok = TestMode.Env("DICTATION_HELPER_TEST_FAIL_SET") != "1"
                        && SetBytes(CF_UNICODETEXT, System.Text.Encoding.Unicode.GetBytes(text + "\0"));
                    // Round 17: only CF_UNICODETEXT, as in round 15. Windows sets CF_LOCALE at our close (this thread's
                    // input language) and synthesizes CF_TEXT and CF_OEMTEXT from our text on that locale's code pages,
                    // exactly as it always did: nothing changes in what a target pastes.
                    // Windows' own clipboard history and cloud clipboard, and clipboard
                    // managers that honor it, leave entries with these formats alone.
                    SetConservativeMarkers();
                    // Our transaction's sentinel, LAST (it is never the first format a reader sees): with our
                    // exact markers and our text (by hash) it identifies our complete write to THIS live transaction
                    // (its confirmation and its later looks); nothing read from disk acts on it.
                    // The locale Windows will state at our close: this thread's input language (the sentinel carries it,
                    // so every later look knows which code pages Windows converted our text with).
                    ownership.TextLocale = InputLocale();
#if DICTATION_TEST
                    LastWriteLocale = ownership.TextLocale;
#endif
                    if (record != null) SetSentinel(record, ownership.TextLocale);
                    // Sampled INSIDE the same open/close as our SetClipboardData: nobody else can
                    // write while we hold the clipboard.
                    ownership.SequenceInside = Sequence("inside");
                }
            }
            finally
            {
                Native.ClearLastError(0); // round 22 (S6): the error read is this close's own
                bool closed = Native.CloseClipboard();
                int closeError = closed ? 0 : Marshal.GetLastWin32Error();
                if (trace != null) trace.Closed(closed, closeError);
                if (previousLayout != IntPtr.Zero) Native.ActivateKeyboardLayout(previousLayout, 0); // test build only (see above)
            }
            if (ownership.Emptied)
            {
                // Journaled right after the close (before any confirmation), on the normal and the late path.
                int beforeWritten = TestMode.Int("DICTATION_HELPER_TEST_STALL_BEFORE_WRITTEN_MS", 0);
                if (beforeWritten > 0) Thread.Sleep(beforeWritten); // test build only: die before "written" is journaled
                if (!PendingClipboard.Stage(record, "written", ownership.SequenceInside, ownership.SequenceInside) && saved != null)
                    saved.LoseAuthority("the written stage could not be journaled");
            }
            if (confirm && ownership.Emptied) ConfirmWritten(ownership, saved);
            return ok;
        }

        /// <summary>Confirm our write, and journal the sequence confirmed after the close (Windows moves it at the close).</summary>
        public static void ConfirmWritten(ClipboardOwnership ownership, SavedClipboard saved)
        {
            ownership.Confirm(saved != null ? saved.Record : null);
            // A rejection ends this transaction's authority (the one guard, SavedClipboard.LoseAuthority).
            if (ownership.Rejected && saved != null) saved.LoseAuthority("our write's confirmation rejected it (" + ownership.RejectedWhy + ")");
        }

        public static readonly string[] MarkerNames =
        {
            "ExcludeClipboardContentFromMonitorProcessing",
            "CanIncludeInClipboardHistory",
            "CanUploadToCloudClipboard"
        };

        /// <summary>Set the three privacy markers to "do not record" on the current clipboard (must be open).</summary>
        public static bool SetConservativeMarkers()
        {
            bool a = SetBytes(Native.RegisterClipboardFormat(MarkerNames[0]), new byte[] { 0 });
            bool b = SetBytes(Native.RegisterClipboardFormat(MarkerNames[1]), BitConverter.GetBytes(0));
            bool c = SetBytes(Native.RegisterClipboardFormat(MarkerNames[2]), BitConverter.GetBytes(0));
            return a && b && c;
        }

        /// <summary>Our transaction's sentinel format on the open clipboard ("record id:nonce:locale"; no user content).</summary>
        public static void SetSentinel(PendingRecord record, int locale)
        {
            SetBytes(Native.RegisterClipboardFormat(PendingClipboard.SentinelFormat), System.Text.Encoding.UTF8.GetBytes(record.Id + ":" + record.Nonce + ":" + locale));
        }

        /// <summary>This thread's input language: the CF_LOCALE Windows sets when it closes a clipboard with text and no locale.</summary>
        internal static int InputLocale() { return (int)((long)Native.GetKeyboardLayout(0) & 0xFFFF); }

#if DICTATION_TEST
        /// <summary>Test build only: the locale the last write pinned (this write thread's input language).</summary>
        internal static int LastWriteLocale;
#endif

        /// <summary>
        /// The bytes Windows synthesizes for a text form of `text` under `locale` (unit- and CI-tested against Windows' own
        /// synthesis): CF_LOCALE, the locale; CF_TEXT and CF_OEMTEXT, the text converted on that locale's default ANSI and
        /// OEM code pages (no terminator). Null when it cannot be converted.
        /// </summary>
        internal static byte[] ExpectedTextForm(uint format, string text, int locale)
        {
            if (format == CF_LOCALE_) return BitConverter.GetBytes(locale);
            if (text.Length == 0) return new byte[0];
            uint codePage = LocaleCodePage(locale, format == CF_OEMTEXT_);
            int size = Native.WideCharToMultiByte(codePage, 0, text, text.Length, null, 0, IntPtr.Zero, IntPtr.Zero);
            if (size <= 0) return null;
            byte[] bytes = new byte[size];
            return Native.WideCharToMultiByte(codePage, 0, text, text.Length, bytes, size, IntPtr.Zero, IntPtr.Zero) == size ? bytes : null;
        }

        /// <summary>A locale's default ANSI (or OEM) code page; the system's when the locale has none (Unicode-only locales).</summary>
        internal static uint LocaleCodePage(int locale, bool oem)
        {
            uint value;
            if (Native.GetLocaleInfoW((uint)locale, (oem ? 0x000Bu : 0x1004u) | 0x20000000u, out value, 2) == 0 || value == 0) return oem ? 1u : 0u;
            return value;
        }

        /// <summary>A NUL-terminated text form read back from the clipboard, without its terminator (null when it has none).</summary>
        internal static byte[] CString(byte[] bytes)
        {
            if (bytes == null) return null;
            int end = Array.IndexOf(bytes, (byte)0);
            if (end < 0) return null;
            byte[] text = new byte[end];
            Array.Copy(bytes, text, end);
            return text;
        }

        const uint CF_TEXT_ = 1, CF_OEMTEXT_ = 7, CF_LOCALE_ = 16;
        static readonly byte[][] MarkerValues = { new byte[] { 0 }, BitConverter.GetBytes(0), BitConverter.GetBytes(0) };

        /// <summary>
        /// The rule (unit-tested): what the open clipboard holds against our write of THIS transaction, comparing the
        /// BYTES of every format present. Complete: our sentinel ("id:nonce:locale", this transaction's nonce), our text
        /// (its SHA-256 matches the record's), our three markers with exactly our values, and nothing else but the text
        /// forms Windows synthesizes from our text, each compared too: CF_LOCALE equal to the locale the sentinel states,
        /// CF_TEXT and CF_OEMTEXT equal (up to their terminator) to `expectedForm` (by default Windows' conversion on
        /// that locale's code pages, ExpectedTextForm). Partial: some of that and nothing else (a write cut short).
        /// None: anything else, or a format that cannot be read now.
        /// </summary>
        internal static OurWrite ClassifyOurWrite(IList<uint> present, Func<uint, int, byte[]> read, string recordId, string nonce, byte[] dictatedHash, Func<uint, string, int, byte[]> expectedForm = null)
        {
            if (present.Count == 0 || string.IsNullOrEmpty(nonce) || dictatedHash == null) return OurWrite.None;
            if (expectedForm == null) expectedForm = ExpectedTextForm;
            uint sentinelFormat = Native.RegisterClipboardFormat(PendingClipboard.SentinelFormat);
            uint[] markerFormats = new uint[MarkerNames.Length];
            for (int i = 0; i < MarkerNames.Length; i++) markerFormats[i] = Native.RegisterClipboardFormat(MarkerNames[i]);
            string text = null;
            int locale = 0;
            bool sentinel = false;
            int markers = 0;
            // First our text (by hash) and the sentinel (by nonce): the other formats are compared against them.
            if (present.Contains(CF_UNICODETEXT))
            {
                byte[] value = read(CF_UNICODETEXT, int.MaxValue);
                if (value == null) return OurWrite.None;
                int length = value.Length - value.Length % 2;
                while (length >= 2 && value[length - 1] == 0 && value[length - 2] == 0) length -= 2;
                byte[] digest;
                using (System.Security.Cryptography.SHA256 sha = System.Security.Cryptography.SHA256.Create()) digest = sha.ComputeHash(value, 0, length);
                if (!Same(digest, dictatedHash)) return OurWrite.None;
                text = System.Text.Encoding.Unicode.GetString(value, 0, length);
            }
            if (present.Contains(sentinelFormat))
            {
                byte[] value = read(sentinelFormat, 300);
                if (value == null) return OurWrite.None;
                string[] parts = System.Text.Encoding.UTF8.GetString(value).TrimEnd('\0').Split(':');
                if (parts.Length != 3 || parts[0] != recordId || parts[1] != nonce || !int.TryParse(parts[2], out locale)) return OurWrite.None;
                sentinel = true;
            }
            foreach (uint f in present)
            {
                if (f == CF_UNICODETEXT || f == sentinelFormat) continue;
                if (f == CF_TEXT_ || f == CF_OEMTEXT_ || f == CF_LOCALE_)
                {
                    if (text == null) return OurWrite.None; // a text form without our text
                    if (!sentinel) continue; // the locale is known only from our sentinel: at most Partial
                    byte[] expected = expectedForm(f, text, locale);
                    if (expected == null) return OurWrite.None;
                    if (f == CF_LOCALE_)
                    {
                        byte[] value = read(f, 4);
                        if (value == null || !Same(value, expected)) return OurWrite.None;
                        continue;
                    }
                    // One byte more than the form is read: it must be the terminator (longer text is not ours).
                    byte[] form = read(f, expected.Length + 1);
                    if (form == null || form.Length != expected.Length + 1 || form[expected.Length] != 0 || !Same(CString(form), expected)) return OurWrite.None;
                    continue;
                }
                int marker = Array.IndexOf(markerFormats, f);
                if (marker >= 0)
                {
                    byte[] value = read(f, MarkerValues[marker].Length + 1);
                    if (value == null || !Same(value, MarkerValues[marker])) return OurWrite.None;
                    markers++;
                    continue;
                }
                return OurWrite.None; // a format our write never sets
            }
            return sentinel && text != null && markers == MarkerNames.Length ? OurWrite.Complete : OurWrite.Partial;
        }

        /// <summary>The formats our write SETS (CF_UNICODETEXT; the text forms are Windows' and count as synthesized).</summary>
        internal static bool OurWriteFormat(uint format)
        {
            return format == CF_UNICODETEXT;
        }

        /// <summary>
        /// Under the lock: the bytes on the clipboard, formats and size only (an offer that changed shows what a
        /// restore would overwrite). Never for a live foreign owner (it may render: -1), and synthesized formats
        /// are not read (a read would render them). GDI-handle formats count as 0. Round 22: any other format that
        /// cannot be read or sized makes the total UNKNOWN (-1), never smaller.
        /// </summary>
        /// <summary>
        /// THE complete enumeration of the open clipboard (round 21), shared by every proof: the last error cleared before
        /// each step and ERROR_SUCCESS at the end, no repeated id, and as many formats as CountClipboardFormats counts in
        /// the same open. False ("incomplete") means no proof of anything: no automatic restore, no "untouched" deletion.
        /// </summary>
        public static bool EnumerateComplete(out List<uint> formats, string site = null)
        {
            bool complete = EnumerateComplete(delegate (uint f) { Native.ClearLastError(0); return Native.EnumClipboardFormats(f); },
                delegate { return Marshal.GetLastWin32Error(); }, delegate { return Native.CountClipboardFormats(); }, out formats);
#if DICTATION_TEST
            // Test build only (round 22): the enumeration at a named call site reports INCOMPLETE (with what it did list),
            // so each destructive caller is shown to refuse. Sites: confirm, still-there, matches, view, bytes.
            string forced = IncompleteAt ?? TestMode.Env("DICTATION_HELPER_TEST_ENUM_INCOMPLETE");
            if (site != null && forced != null && ("," + forced + ",").Contains("," + site + ",")) return false;
#endif
            return complete;
        }

#if DICTATION_TEST
        /// <summary>Unit tests: the call sites whose enumeration reports incomplete (comma-separated), or null.</summary>
        internal static string IncompleteAt = null;
#endif

        /// <summary>The rule, with the native calls injected (unit-tested).</summary>
        internal static bool EnumerateComplete(Func<uint, uint> next, Func<int> lastError, Func<int> count, out List<uint> formats)
        {
            formats = new List<uint>();
            HashSet<uint> seen = new HashSet<uint>();
            for (uint f = 0; ;)
            {
                f = next(f);
                if (f == 0) { if (lastError() != 0) return false; break; }
                if (!seen.Add(f) || formats.Count > 4096) return false;
                formats.Add(f);
            }
            return formats.Count == count();
        }

        public static long OpenClipboardBytes(bool foreignOwner)
        {
            if (foreignOwner) return -1;
            long total = 0;
            List<uint> present;
            if (!EnumerateComplete(out present, "bytes")) return -1; // display only: unknown
            foreach (uint f in present)
            {
                if (SavedClipboard.MaybeSynthesized(f) || f == 2 || f == 3 || f == 9 || f == 14) continue;
                IntPtr data = Native.GetClipboardData(f);
                // Round 22 (S6): a format that cannot be read or sized makes the total UNKNOWN (display only), never smaller.
                if (data == IntPtr.Zero) return -1;
                long size = (long)Native.GlobalSize(data).ToUInt64();
                if (size <= 0) return -1;
                total += size;
            }
            return total;
        }

        internal static bool Same(byte[] a, byte[] b)
        {
            if (a == null || b == null || a.Length != b.Length) return false;
            for (int i = 0; i < a.Length; i++) if (a[i] != b[i]) return false;
            return true;
        }

        /// <summary>A format's bytes (at most cap) from the open clipboard; null when absent. Never for a live foreign owner (it may render).</summary>
        public static byte[] ReadBytes(uint format, int cap)
        {
            if (format == 0) return null;
            IntPtr data = Native.GetClipboardData(format);
            if (data == IntPtr.Zero) return null;
            long size = (long)Native.GlobalSize(data).ToUInt64();
            if (size <= 0) return null;
            IntPtr source = Native.GlobalLock(data);
            if (source == IntPtr.Zero) return null;
            try
            {
                byte[] bytes = new byte[(int)Math.Min(size, cap)];
                Marshal.Copy(source, bytes, 0, bytes.Length);
                return bytes;
            }
            finally { Native.GlobalUnlock(data); }
        }

        public static bool SetBytes(uint format, byte[] bytes)
        {
            int error;
            return SetBytes(format, bytes, out error);
        }

        /// <summary>SetBytes, with the error of the step that failed (0 on success; -1 when nothing native failed).</summary>
        public static bool SetBytes(uint format, byte[] bytes, out int error)
        {
            error = -1;
            if (format == 0) return false;
            IntPtr memory = Native.GlobalAlloc(Native.GMEM_MOVEABLE, (UIntPtr)Math.Max(1, bytes.Length));
            if (memory == IntPtr.Zero) return false;
            IntPtr target = Native.GlobalLock(memory);
            if (target == IntPtr.Zero)
            {
                Native.GlobalFree(memory);
                return false;
            }
            Marshal.Copy(bytes, 0, target, bytes.Length);
            Native.GlobalUnlock(memory);
            if (Native.SetClipboardData(format, memory) == IntPtr.Zero)
            {
                error = Marshal.GetLastWin32Error();
                Native.GlobalFree(memory);
                return false;
            }
            error = 0;
            return true; // the clipboard owns the memory now
        }
    }

    /// <summary>
    /// Round 19, LOG ONLY (no behaviour, no clipboard content, no extra open): one line per put-back (the live
    /// restore, the write's own rollback, the user's Restore) with the native result and last error of EmptyClipboard,
    /// of every SetClipboardData (format id and byte length only) and of CloseClipboard, the sequence before the open
    /// and after the close, and CountClipboardFormats after the close (neither needs an open, so neither waits on an
    /// owner), with pid, thread id and a monotonic tick. To diagnose round 18's one-off (CI 25(a)).
    /// </summary>
    internal sealed class PutBackTrace
    {
        readonly string kind;
        readonly uint sequenceBefore;
        readonly long started = (long)Native.GetTickCount64();
        readonly System.Text.StringBuilder sets = new System.Text.StringBuilder();
        string empty = "not emptied";
        bool attempted;

        /// <summary>Taken BEFORE the open (`sequenceBeforeOpen` when the open happened earlier, as in our write).</summary>
        public PutBackTrace(string kind, uint sequenceBeforeOpen = 0)
        {
            this.kind = kind;
            sequenceBefore = sequenceBeforeOpen != 0 ? sequenceBeforeOpen : Native.GetClipboardSequenceNumber();
        }

        public void Emptied(bool ok, int error) { empty = (ok ? "ok" : "FAILED") + " (error " + error + ")"; attempted = true; }

        public void Set(uint format, int length, bool ok, int error)
        {
            attempted = true;
            if (sets.Length > 0) sets.Append(", ");
            sets.Append(format == 0 ? "markers" : format.ToString()).Append(length >= 0 ? ":" + length : "").Append(ok ? " ok" : " FAILED (error " + error + ")");
        }

        /// <summary>After CloseClipboard (its result and error): writes the line, if a put-back was attempted.</summary>
        public void Closed(bool ok, int error)
        {
            if (!attempted) return;
            uint after = Native.GetClipboardSequenceNumber();
            Native.ClearLastError(0); // round 22 (S6): the error read is this count's own
            int count = Native.CountClipboardFormats();
            int countError = count == 0 ? Marshal.GetLastWin32Error() : 0;
            Wire.Log("put-back trace: " + kind + " pid " + Process.GetCurrentProcess().Id + " tid " + Native.GetCurrentThreadId() + " tick " + started
                + "+" + ((long)Native.GetTickCount64() - started) + " ms; sequence " + sequenceBefore + " -> " + after + "; EmptyClipboard " + empty
                + "; SetClipboardData [" + sets + "]; CloseClipboard " + (ok ? "ok" : "FAILED") + " (error " + error + "); formats after close "
                + count + (count == 0 ? " (error " + countError + ")" : ""));
        }
    }

    /// <summary>
    /// Proof that the clipboard still holds our write. Windows adds to the sequence number at
    /// CloseClipboard for the formats it synthesizes (CF_TEXT, CF_OEMTEXT, CF_LOCALE from our
    /// Unicode text), so the number sampled inside our write lock (SequenceInside) is never the final
    /// one. Confirm() therefore re-opens the clipboard and, under that lock, requires the clipboard
    /// owner to be the helper's own window (EmptyClipboard made it the owner; any other writer's
    /// EmptyClipboard replaces it) before taking the final number. The restore then requires the same
    /// owner AND the same number under its own lock, so a newer copy by another app, even one with
    /// identical text, is never overwritten.
    /// </summary>
    internal sealed class ClipboardOwnership
    {
        /// <summary>Our write emptied the clipboard: the user's content is gone from it until restored. Round 23: set on the
        /// statement right after EmptyClipboard succeeds, before anything that can throw.</summary>
        public bool Emptied;
        /// <summary>The write emptied the clipboard and put the saved content back itself, in the same open, and that rollback
        /// COMPLETED: its result. Null for a rollback that did not finish (then Emptied alone decides: kept, offered).</summary>
        public string PutBack;
        /// <summary>The transaction could not be journaled before emptying: nothing was emptied.</summary>
        public bool JournalFailed;
        public uint SequenceInside;
        public uint SequenceFinal;
        public IntPtr Owner;
        /// <summary>The confirmation rejected our write (not exactly ours, the sequence beyond our close, or a read that failed).</summary>
        public bool Rejected;
        public string RejectedWhy = "";
        /// <summary>The CF_LOCALE Windows states for our write (this write thread's input language; also in the sentinel).</summary>
        public int TextLocale;
        /// <summary>
        /// The text forms a look compares against: Windows' conversion of our text on the pinned locale's code pages
        /// (round 17 found that Windows renders none of them inside our own open, so there is nothing to read back; the
        /// read-back attempt was removed in round 18).
        /// </summary>
        public Func<uint, string, int, byte[]> ExpectedForms()
        {
            int textLocale = TextLocale;
            return delegate (uint f, string text, int locale)
            {
                // The locale is PINNED to what this transaction wrote in its sentinel (round 18): a sentinel on the
                // clipboard that states another locale is not ours, whatever forms come with it.
                return locale == textLocale ? ClipboardText.ExpectedTextForm(f, text, locale) : null;
            };
        }
        /// <summary>Confirm() proved the clipboard was ours after our write was finalized.</summary>
        public bool Confirmed;
        /// <summary>
        /// Right after our write, another window already owned the clipboard: someone else emptied it
        /// after us, so what it holds is provably not ours (a newer copy by another app).
        /// </summary>
        public bool ForeignAtConfirm;

        /// <summary>
        /// Our write's confirmation, under the clipboard lock: our window still owns it AND (for a transaction) it holds
        /// exactly our write, nothing added (another process can add a format without emptying, which keeps our window
        /// the owner and moves the sequence). Only then is the sequence taken as ours. Content that is not exactly ours
        /// is CHANGED: not confirmed, no sequence trusted (proof only by content from then on).
        /// </summary>
        public void Confirm(PendingRecord record)
        {
            IntPtr window = Ui.ClipboardWindow;
            Owner = window;
            if (window == IntPtr.Zero) return;
            // Test build only: widen the moment between our write and its confirmation.
            int confirmDelay = TestMode.Int("DICTATION_HELPER_TEST_CONFIRM_DELAY_MS", 0);
            if (confirmDelay > 0) Thread.Sleep(confirmDelay);
            if (Native.GetClipboardOwner() != window) { ForeignAtConfirm = true; return; }
            // Test build only: simulate another reader holding the clipboard through the confirmation.
            if (TestMode.Env("DICTATION_HELPER_TEST_SKIP_CONFIRM") == "1") return;
            if (!ClipboardText.Open()) return;
            try
            {
                if (Native.GetClipboardOwner() != window) { ForeignAtConfirm = true; return; }
                if (record == null || record.DictatedHash == null) { Rejected = true; RejectedWhy = "nothing to compare against"; return; }
                List<uint> present;
                // An enumeration that is not complete is no proof: a rejection, as a failed read is.
                if (!ClipboardText.EnumerateComplete(out present, "confirm")) { Rejected = true; RejectedWhy = "the enumeration was not complete"; return; }
                int synthesized = 0;
                foreach (uint f in present) if (SavedClipboard.MaybeSynthesized(f) && !ClipboardText.OurWriteFormat(f)) synthesized++;
                // Exactly our write: every present format's BYTES ours (our text, our markers, the sentinel) or Windows' from
                // it (the ANSI, OEM and locale forms it synthesized, each compared). The sequence is read AFTER those reads (a
                // read that rendered anything would show) and must be one our close and those synthesized forms explain.
                // Anything else was changed after our write; a read that fails is a rejection too (durable: offer-only).
                // Test build only: one read of CF_TEXT fails once (a transient read): the rejection must be durable.
                bool dropOnce = TestMode.Env("DICTATION_HELPER_TEST_CONFIRM_READ_NULL") == "1";
                Func<uint, int, byte[]> read = delegate (uint f, int cap)
                {
                    if (dropOnce && f == 1) { dropOnce = false; return null; }
                    return ClipboardText.ReadBytes(f, cap);
                };
                // Reading every text form here also materializes it, so a later passive reader does not move the sequence.
                bool content = ClipboardText.ClassifyOurWrite(present, read, record.Id, record.Nonce, record.DictatedHash, ExpectedForms()) == OurWrite.Complete;
                uint now = ClipboardText.Sequence("confirm");
                // Round 22 (S2): a zero, inside our write or now, is no evidence: a rejection (durable: offer-only).
                if (SequenceInside == 0 || now == 0)
                {
                    Wire.Log("our write's confirmation: the clipboard sequence is not usable evidence (0); not confirmed, kept as an offer");
                    Rejected = true;
                    RejectedWhy = "the sequence is no evidence (0)";
                    return;
                }
                bool bound = unchecked(now - SequenceInside) <= (uint)(PendingClipboard.CloseMoves + synthesized);
                if (!content || !bound)
                {
                    // Final for this transaction: no later look may treat it as ours (see OurWriteStillThere); only an offer remains.
                    Wire.Log("our write's confirmation: our window owns the clipboard but it is not exactly our write (" + (content ? "the sequence moved further" : "something was changed") + "); not confirmed, kept as an offer");
                    Rejected = true;
                    RejectedWhy = content ? "the sequence moved further" : "not exactly our write, or a read failed";
                    return;
                }
                SequenceFinal = now;
                Confirmed = true;
            }
            finally { Native.CloseClipboard(); }
        }

        /// <summary>Under the clipboard lock: the clipboard is still exactly as our write left it.</summary>
        public bool StillOurs()
        {
            uint now = ClipboardText.Sequence("still-ours");
            return Confirmed && SequenceFinal != 0 && now != 0 && Native.GetClipboardOwner() == Owner && now == SequenceFinal;
        }


        /// <summary>Without the lock (right before Ctrl+V): our window still owns the clipboard and its sequence is the one a content look saw.</summary>
        public bool UnchangedSince(uint sequence)
        {
            uint now = ClipboardText.Sequence("unchanged-since");
            return Owner != IntPtr.Zero && Native.GetClipboardOwner() == Owner && sequence != 0 && now != 0 && now == sequence;
        }

        /// <summary>Without the lock (right before Ctrl+V): the clipboard still holds our write, as far as can be seen.</summary>
        public bool LooksOurs()
        {
            // Only a confirmed write (content checked under the lock) is trusted by owner and sequence; an unconfirmed
            // one needs the content look (SavedClipboard.InspectOurWrite).
            if (!Confirmed || ForeignAtConfirm || Owner == IntPtr.Zero || Native.GetClipboardOwner() != Owner) return false;
            uint now = ClipboardText.Sequence("looks-ours");
            return SequenceFinal != 0 && now != 0 && now == SequenceFinal;
        }

        /// <summary>What the clipboard holds when it could not be put back: dictated, foreign or unknown.</summary>
        public string Holds()
        {
            if (Owner != IntPtr.Zero && Native.GetClipboardOwner() != Owner) return "foreign";
            uint now = ClipboardText.Sequence("holds");
            if (Confirmed && now != 0 && now == SequenceFinal) return "dictated";
            return "unknown";
        }
    }

    /// <summary>
    /// The user's clipboard, saved before a paste and put back afterwards. Every registered format
    /// and the known-safe standard formats (text, a DIB, a file list, ...) are preserved by their bytes, and
    /// an EMF by its bits, so an app's own content (Excel cells, editor formats) round-trips. Special handling:
    /// the bitmap, palette and metafile picture Windows rebuilds from a retained DIB or EMF; OLE bookkeeping
    /// (dropped); our own sentinel; the privacy markers (forced to the conservative values when not read
    /// cleanly); the known presence-only formats (saved and put back as presence only, round 22); standard
    /// formats outside SafeStandard (not saved: reported). Total bytes and copy time are capped so a huge
    /// clipboard cannot stall a delivery. Anything not kept (a cap, a policy, or, on the retry, a format its
    /// owner did not render) is reported by name: the restore reports "skipped" and the app says what is missing.
    /// </summary>
    internal sealed class SavedClipboard
    {
        const uint CF_TEXT = 1, CF_BITMAP = 2, CF_OEMTEXT = 7, CF_DIB = 8, CF_PALETTE = 9,
            CF_ENHMETAFILE = 14, CF_HDROP = 15, CF_LOCALE = 16, CF_UNICODETEXT = 13, CF_DIBV5 = 17;
        /// <summary>
        /// At most this many bytes are copied across all formats (16 MiB). A test build may lower it
        /// (DICTATION_HELPER_CLIP_MAXBYTES, TestMode) to force the skip path; the shipped helper cannot.
        /// </summary>
        static readonly int MaxBytes = TestMode.Int("DICTATION_HELPER_CLIP_MAXBYTES", 16 * 1024 * 1024);
        /// <summary>A single user-visible format may use the whole budget; the aggregate still bounds it.</summary>
        static int MaxFormatBytes { get { return MaxBytes; } }

        /// <summary>Privacy-marker reads are tiny flags; never copy more than this many bytes of one.</summary>
        const int MaxMarkerBytes = 64;
        readonly List<KeyValuePair<uint, byte[]>> items = new List<KeyValuePair<uint, byte[]>>();
        IntPtr metafile = IntPtr.Zero;
        /// <summary>The saved EMF's bytes as validated by the capture (or read from a record): what WriteTo writes down.</summary>
        byte[] metafileBits;
        /// <summary>A save that had an EMF whose bytes are not available (a record read back with it lost; tests set it
        /// directly): WriteTo writes it as lost again, never as absent.</summary>
        internal bool metafileExpected;
        /// <summary>Saved content that cannot go back (ReadFrom): a metafile that could not be rebuilt, a registered format with no usable name.</summary>
        bool contentLost;
        bool complete = true;
        /// <summary>True only when a user-visible format was dropped by the byte or time cap; drops of private formats are silent.</summary>
        bool reportedSkip;
        /// <summary>A privacy marker was on the clipboard but could not be read, so set it conservatively on restore.</summary>
        bool forceMarkers;
        internal bool ForceMarkers { get { return forceMarkers; } }
        static readonly HashSet<string> Markers = new HashSet<string>(ClipboardText.MarkerNames, StringComparer.OrdinalIgnoreCase);

        const uint CF_SYLK = 4, CF_DIF = 5, CF_TIFF = 6, CF_PENDATA = 10, CF_RIFF = 11, CF_WAVE = 12, CF_METAFILEPICT = 3;
        /// <summary>Standard formats held in global memory, saved by number.</summary>
        static readonly HashSet<uint> SafeStandard = new HashSet<uint>
        {
            CF_UNICODETEXT, CF_TEXT, CF_OEMTEXT, CF_DIB, CF_DIBV5, CF_HDROP, CF_LOCALE,
            CF_SYLK, CF_DIF, CF_TIFF, CF_PENDATA, CF_RIFF, CF_WAVE
        };
        /// <summary>
        /// The only formats dropped silently: OLE's live-object bookkeeping, which points into the
        /// copying process and is meaningless (or harmful) once replayed as bytes. Everything else
        /// that is registered, including OLE embedding and link formats (Embed Source, Embedded
        /// Object, Object Descriptor, Native, Link Source, OwnerLink, ObjectLink), is the user's
        /// content and is preserved under the caps; anything that cannot be kept counts as skipped.
        /// </summary>
        static readonly HashSet<string> SilentDrop = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "dataobject", "ole private data"
        };

        /// <summary>
        /// Round 22: registered formats that are PRESENCE-ONLY by design: their owner sets them with a NULL handle and
        /// readers test IsClipboardFormatAvailable, never their data. Scintilla (Notepad++, SciTE, and the editors built
        /// on it) does exactly that in ScintillaWin::CopyToClipboard: ::SetClipboardData(cfColumnSelect, 0) for a
        /// rectangular copy and ::SetClipboardData(cfLineSelect, 0) plus ::SetClipboardData(cfVSLineTag, 0) for a
        /// whole-line copy, where cfColumnSelect = RegisterClipboardFormat("MSDEVColumnSelect"), cfLineSelect =
        /// "MSDEVLineSelect" and cfVSLineTag = "VisualStudioEditorOperationsLineCutCopyClipboardTag" (the names Visual
        /// Studio uses for the same two semantics), and its paste tests them with IsClipboardFormatAvailable. Saved as
        /// presence only and put back as presence only (SetClipboardData(format, NULL) from our window: delayed
        /// rendering that our window never renders, so the format is available with no data, as the editors expect).
        /// Exactly these names. Any other format that answers NULL fails the first whole-save attempt and, on the second,
        /// is a named, reported skip (round 22, class 3), or a forced exclusion when it is a privacy marker (class 2).
        /// </summary>
        internal static readonly HashSet<string> PresenceOnly = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "MSDEVColumnSelect", "MSDEVLineSelect", "VisualStudioEditorOperationsLineCutCopyClipboardTag",
            // The clipboard-viewer convention (round 22): a format whose PRESENCE tells clipboard viewers and history tools
            // to ignore the entry; readers such as Ditto test its presence only and skip an entry that carries it. KeePass
            // sets it on the passwords it copies WITH data (ClipboardUtil, CfnViewerIgnore); that data is not used by its
            // readers, so it is put back as presence only. Round 23: it also keeps such a copy off the disk (PrivacyMarked).
            ViewerIgnore
        };
        const string ViewerIgnore = "Clipboard Viewer Ignore";
        /// <summary>The saved presence-only formats (see PresenceOnly).</summary>
        readonly List<uint> presenceOnly = new List<uint>();

        public static string FormatName(uint format)
        {
            System.Text.StringBuilder name = new System.Text.StringBuilder(256);
            int length = Native.GetClipboardFormatName(format, name, name.Capacity);
            return length > 0 ? name.ToString(0, length) : "";
        }

        /// <summary>
        /// Formats an OLE source renders on demand (it may start or wake the source app): read after
        /// every other format, so a slow render costs only itself and comes last.
        /// </summary>
        static readonly string[] RenderedLast =
        {
            "embed source", "embedded object", "link source", "link source descriptor", "object descriptor",
            "native", "ownerlink", "objectlink"
        };

        /// <summary>
        /// Wall-clock bound for reading one format (a render that takes longer abandons the reader and
        /// gives up the save; see ClipboardReader for what happens to that reader). Each read is also bounded by
        /// what is left of the whole save's budget (1.5 s). Stated plainly: an abandoned reader still waiting in an
        /// owner's render keeps its open until the render returns (since round 21 with its own window, so another
        /// app's OpenClipboard fails meanwhile, as it would with any app reading a format rendered on demand).
        /// </summary>
        const int PerFormatMs = 1500;

        /// <summary>
        /// Save the clipboard through the reader process (ClipboardReader), one bounded request per format, under ONE
        /// absolute deadline (timeoutMs). The helper writes to the clipboard only when the save is POSITIVELY
        /// established (Judge). A capture that is not established is discarded whole (nothing partial is kept), its
        /// reader generation retired, and the WHOLE capture retried while the deadline allows; then null, and the
        /// delivery takes the no-save path (it never empties or writes the clipboard). Null without a retry when a read
        /// overran (that reader is abandoned while an owner renders, never killed) or the clipboard changed.
        /// </summary>
#if DICTATION_TEST
        /// <summary>Test build only: the last save's log line (the __save-only op reports it).</summary>
        internal static string LastSaveLine = "";

        /// <summary>Test build only: the saved formats as "id:length,…" (never content).</summary>
        internal string Shape()
        {
            List<string> parts = new List<string>();
            foreach (KeyValuePair<uint, byte[]> item in items) parts.Add(item.Key + ":" + item.Value.Length);
            if (metafile != IntPtr.Zero) parts.Add("14:emf");
            return string.Join(",", parts.ToArray());
        }
#endif

        public static SavedClipboard CaptureBounded(int timeoutMs)
        {
            LastNoSaveReason = "unreadable";
            Stopwatch watch = Stopwatch.StartNew();
            for (int attempt = 1; ; attempt++)
            {
                ClipboardReaderClient reader = ClipboardReaderClient.Get();
                if (reader == null) return null;
                int left = timeoutMs - (int)watch.ElapsedMilliseconds;
                bool retry;
                string line;
                // The second attempt onwards accepts a format its owner does not render under a PROVEN hold as a named,
                // reported skip (round 22, owner decision: class 3); the first one does not.
                SavedClipboard saved = Judge(delegate (string request, int ms) { return reader.Request(request, ms); }, left,
                    delegate { return Native.GetClipboardSequenceNumber(); }, out retry, out line, attempt >= 2);
                Wire.Log("saving the clipboard (attempt " + attempt + "): " + line);
#if DICTATION_TEST
                LastSaveLine = "attempt " + attempt + ": " + line;
#endif
                if (saved != null || !retry) return saved;
                reader.Retire(); // a failed generation is never asked again
                if (attempt >= 3 || timeoutMs - (int)watch.ElapsedMilliseconds < 200) return null;
            }
        }

        /// <summary>
        /// The rule (unit-tested with hooked replies). ESTABLISHED only when the reader, inside its own proven open,
        /// listed formats with no enumeration error, exactly as many as CountClipboardFormats counted in that open,
        /// unique and valid ids, every registered format with a name, the sequence non-zero and unchanged across the
        /// listing; and then EVERY listed format ended in a definite outcome, with the sequence unchanged: saved (a
        /// complete framed reply, its declared length met), or a NAMED skip, which is only a positively measured excess
        /// over the cap or an explicit format policy (the bitmap and palette Windows rebuilds from a DIB we retained,
        /// a metafile picture rebuilt from an EMF we retained, our own sentinel, OLE bookkeeping, a standard format this
        /// helper does not save: policy, reported). Round 22 (owner decision), three classes for what cannot be read:
        /// (1) a known presence-only format (PresenceOnly) is saved and put back as presence only; (2) a privacy marker
        /// not cleanly read forces the conservative exclusion markers; (3) on the second attempt (`allowUnrendered`), a
        /// format its owner did not render ("none", "unlocked", "nosize") under the proven hold with the sequence
        /// unchanged is a NAMED, REPORTED skip, only beside content that does go back. Listed 0 + counted 0 + no error is
        /// a POSITIVE EMPTY, the only source of a zero-item save that reports "restored". Anything else is NOT
        /// ESTABLISHED: null, `retry` set: a lost hold, an enumeration error, listed != counted, a zero sequence, busy, a
        /// malformed, fragmentary or out-of-order reply, an unrendered format on the first attempt, a missing registered
        /// name, a failed EMF rebuild, the deadline running out. Null without `retry`: an overrun, an unresponsive
        /// owner, no format with data provided, or the clipboard changed.
        /// </summary>
        /// <summary>Round 23: why the last save (on this thread) was not established, for the user's notice: too-large,
        /// unrendered, nothing-savable, owner-unresponsive, or unreadable (anything else).</summary>
        [ThreadStatic] internal static string LastNoSaveReason;

        /// <summary>
        /// Round 23 (the one rule): a retained format that is the user's content. Not CF_LOCALE (a fact about text, never
        /// content of its own), not a privacy marker, presence-only flag, our sentinel, OLE bookkeeping or Explorer's
        /// "Preferred DropEffect" (a copy-or-move flag that means nothing without the files).
        /// </summary>
        internal static bool IsUserContent(uint format, string name)
        {
            if (format == CF_LOCALE) return false;
            if (format < 0xC000) return true;
            if (string.IsNullOrEmpty(name)) return true;
            return !Markers.Contains(name) && !PresenceOnly.Contains(name) && !SilentDrop.Contains(name) && !NotContent.Contains(name)
                && name != PendingClipboard.SentinelFormat;
        }
        static readonly HashSet<string> NotContent = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "Preferred DropEffect" };

        internal static SavedClipboard Judge(Func<string, int, string> request, int timeoutMs, Func<uint> sequenceNow, out bool retry, out string line, bool allowUnrendered = false)
        {
            LastNoSaveReason = "unreadable";
            retry = true;
            line = null;
            if (timeoutMs <= 0) { line = "NOT ESTABLISHED: no time left for a listing (nothing requested); not pasting"; return null; } // S4: no 1 ms request
            Stopwatch watch = Stopwatch.StartNew();
            Func<int> left = () => timeoutMs - (int)watch.ElapsedMilliseconds;
            string list = request("list", Math.Max(1, Math.Min(PerFormatMs, left())));
            if (list == null) { retry = false; line = "NOT ESTABLISHED: listing the formats overran or the reader ended; not pasting"; return null; }
            string[] head = list.Split(' ');
            uint sequence, sequenceAfter;
            int counted, enumError, declared;
            if (head.Length < 6 || head[0] != "list" || !uint.TryParse(head[1], out sequence) || !int.TryParse(head[2], out counted)
                || !int.TryParse(head[3], out enumError) || !uint.TryParse(head[4], out sequenceAfter) || !int.TryParse(head[5], out declared))
            {
                line = "NOT ESTABLISHED: the reader's listing was " + (head[0] == "lost" ? "taken with a lost hold (another opener)" : head[0] == "busy" ? "busy (the clipboard could not be opened)" : "malformed, fragmentary or out of order") + "; not pasting";
                return null;
            }
            List<KeyValuePair<uint, string>> formats = new List<KeyValuePair<uint, string>>();
            List<KeyValuePair<uint, string>> renderedLast = new List<KeyValuePair<uint, string>>();
            HashSet<uint> listedIds = new HashSet<uint>();
            for (int i = 6; i < head.Length; i++)
            {
                int colon = head[i].IndexOf(':');
                uint format;
                string name;
                try
                {
                    if (colon <= 0 || !uint.TryParse(head[i].Substring(0, colon), out format) || format == 0 || format > 0xFFFF || !listedIds.Add(format)) throw new FormatException();
                    name = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(head[i].Substring(colon + 1)));
                    if (format >= 0xC000 && name.Length == 0) { line = "NOT ESTABLISHED: registered format " + format + " has no name (a privacy marker could not be recognized); not pasting"; return null; }
                }
                catch (FormatException) { line = "NOT ESTABLISHED: a malformed, repeated or invalid format entry in the listing; not pasting"; return null; }
                KeyValuePair<uint, string> entry = new KeyValuePair<uint, string>(format, name);
                if (format >= 0xC000 && Array.IndexOf(RenderedLast, name.ToLowerInvariant()) >= 0) renderedLast.Add(entry);
                else formats.Add(entry);
            }
            int listed = listedIds.Count;
            string listing = "listed " + listed + ", counted " + counted + ", enumeration error " + enumError + ", sequence " + sequence + " -> " + sequenceAfter;
            if (enumError != 0 || listed != counted || listed != declared || sequence == 0 || sequence != sequenceAfter)
            {
                line = "NOT ESTABLISHED (" + listing + "): the listing is not proof of what the clipboard holds; not pasting";
                return null;
            }
            formats.AddRange(renderedLast);
            SavedClipboard saved = new SavedClipboard();
            saved.Sequence = sequence;
            System.Text.StringBuilder outcomes = new System.Text.StringBuilder();
            List<uint> deferred = new List<uint>(); // bitmap, palette, metafile picture: decided by what was retained
            int unrenderedSkips = 0; // class 3 skips (round 22)
            int userContent = 0;     // retained formats that are the user's content (round 23, the one rule)
            bool tooLarge = false;   // a user-content format was over its cap (the no-save reason)
            bool pingRetried = false; // one more chance for an owner that was busy at the first ping (round 23)
            long total = 0;
            foreach (KeyValuePair<uint, string> entry in formats)
            {
                uint format = entry.Key;
                string name = entry.Value;
                long cap;
                bool marker = false;
                if (format == CF_BITMAP || format == CF_PALETTE || format == CF_METAFILEPICT) { deferred.Add(format); continue; }
                if (outcomes.Length > 0) outcomes.Append(", ");
                outcomes.Append(format);
                if (format < 0xC000)
                {
                    if (format != CF_ENHMETAFILE && !SafeStandard.Contains(format))
                    {
                        // Policy: a standard format outside SafeStandard (GDI-handle formats such as CF_BITMAP's relatives,
                        // CF_DSP*, CF_OWNERDISPLAY, the private and GDI-object ranges) is not saved by this helper. Some
                        // could be replayed with format-specific code; this helper does not, so it is a real loss,
                        // reported by name, never dropped silently.
                        saved.reportedSkip = true;
                        saved.skippedNames.Add(DisplayName(format, name) + " (not saved by DoodleNote)");
                        outcomes.Append(" not saved (policy: a standard format this helper does not save; reported)");
                        continue;
                    }
                    cap = Math.Min(MaxFormatBytes, MaxBytes - total);
                }
                else if (name == PendingClipboard.SentinelFormat) { outcomes.Append(" ours, not saved (policy)"); continue; }
                else if (Markers.Contains(name)) { saved.PrivacyMarked = true; marker = true; cap = MaxMarkerBytes; }
                else if (SilentDrop.Contains(name)) { outcomes.Append(" not saved (OLE bookkeeping: policy)"); continue; }
                else if (PresenceOnly.Contains(name))
                {
                    saved.presenceOnly.Add(format);
                    // Round 23 (Opus S-D): "Clipboard Viewer Ignore" means "do not record": such a copy is never written to
                    // disk (in memory only, as a privacy-marked one); it is still put back as presence only.
                    if (string.Equals(name, ViewerIgnore, StringComparison.OrdinalIgnoreCase)) saved.PrivacyMarked = true;
                    outcomes.Append(" presence only (policy)");
                    continue;
                }
                else cap = Math.Min(MaxFormatBytes, MaxBytes - total);
                // Round 22: a recognised privacy marker that is skipped for ANY reason forces the conservative exclusion
                // markers on the put-back (the content must never come back without its exclusion).
                // Round 23 (class 2 reports nothing): a marker over its budget forces the markers and is no reported skip.
                if (cap <= 0)
                {
                    if (marker) saved.forceMarkers = true;
                    else { saved.reportedSkip = true; tooLarge = true; saved.skippedNames.Add(DisplayName(format, name) + " (too large)"); }
                    outcomes.Append(" over the cap (the budget is used up)" + (marker ? "; exclusion markers forced" : ""));
                    continue;
                }
                if (left() <= 0) { saved.Discard(); line = "NOT ESTABLISHED (" + listing + "; [" + outcomes + " not read: out of time]); not pasting"; return null; }
                string answer = request("get " + format + " " + cap, Math.Max(1, Math.Min(PerFormatMs, left())));
                // Round 23 (Opus): an owner busy for just over one ping gets ONE more within the remaining budget (once per
                // save), then the answer stands.
                if (answer == "unresponsive" && !pingRetried && left() > 300)
                {
                    pingRetried = true;
                    outcomes.Append(" (its owner did not answer; asked once more)");
                    answer = request("get " + format + " " + cap, Math.Max(1, Math.Min(PerFormatMs, left())));
                }
                if (answer == null) { saved.Discard(); retry = false; line = "NOT ESTABLISHED (" + listing + "; [" + outcomes + " overran]): its owner is slow to render; not pasting"; return null; }
                string[] parts = answer.Split(' ');
                uint at;
                if (parts.Length < 3 || parts[1] != format.ToString() || !uint.TryParse(parts[2], out at) || at == 0)
                {
                    saved.Discard();
                    if (parts[0] == "unresponsive") { retry = false; LastNoSaveReason = "owner-unresponsive"; } // never asked to render, not retried
                    line = "NOT ESTABLISHED (" + listing + "; [" + outcomes + " " + (parts[0] == "lost" ? "lost hold" : parts[0] == "busy" ? "busy" : parts[0] == "unresponsive" ? "its owner did not answer, so it was never asked to render" : "malformed, fragmentary or out-of-order reply") + "]); not pasting";
                    return null;
                }
                if (at != sequence) { saved.Discard(); retry = false; line = "the clipboard changed while it was saved (" + listing + ", now " + at + "); not pasting"; return null; }
                long length;
                if ((parts[0] == "data" || parts[0] == "emf") && parts.Length == 5 && long.TryParse(parts[3], out length))
                {
                    // An EMF is answered only as "emf", everything else only as "data", never above the requested cap.
                    if ((parts[0] == "emf") != (format == CF_ENHMETAFILE) || length > cap)
                    {
                        saved.Discard();
                        line = "NOT ESTABLISHED (" + listing + "; [" + outcomes + " a reply of the wrong kind or above the cap (" + length + " bytes)]); not pasting";
                        return null;
                    }
                    byte[] bytes;
                    try { bytes = Convert.FromBase64String(parts[4]); }
                    catch (FormatException) { bytes = null; }
                    if (bytes == null || bytes.Length != length || length <= 0) { saved.Discard(); line = "NOT ESTABLISHED (" + listing + "; [" + outcomes + " a reply shorter than declared]); not pasting"; return null; }
                    if (parts[0] == "emf")
                    {
                        IntPtr copy = Native.SetEnhMetaFileBits((uint)bytes.Length, bytes);
                        if (copy == IntPtr.Zero) { saved.Discard(); line = "NOT ESTABLISHED (" + listing + "; [" + outcomes + " EMF not rebuilt]); not pasting"; return null; }
                        saved.metafile = copy;
                        saved.metafileBits = bytes; // the validated bytes are what is written down (round 22: never re-extracted)
                    }
                    else saved.items.Add(new KeyValuePair<uint, byte[]>(format, bytes));
                    if (IsUserContent(format, name)) userContent++;
                    total += bytes.Length;
                    outcomes.Append(":").Append(bytes.Length).Append(" saved");
                    continue;
                }
                long size;
                if (parts[0] == "oversize" && parts.Length == 4 && long.TryParse(parts[3], out size) && size > cap)
                {
                    // A positively measured excess: the one named skip a read can give. Round 23: a marker over its cap is
                    // class 2 (the markers forced; nothing to report).
                    if (marker) saved.forceMarkers = true;
                    else { saved.reportedSkip = true; tooLarge = true; saved.skippedNames.Add(DisplayName(format, name) + " (too large)"); }
                    outcomes.Append(" over the cap (" + size + " bytes)" + (marker ? "; exclusion markers forced" : ""));
                    continue;
                }
                int replyError;
                // Round 23 (nit): a negative reply's error field must be a number, or the reply is malformed.
                bool unrendered = (parts[0] == "none" || parts[0] == "nosize" || parts[0] == "unlocked") && parts.Length == 4 && int.TryParse(parts[3], out replyError);
                // Only these replies carry an error code in field 3 (never data: nothing but lengths is logged).
                string why = parts[0] + (unrendered ? " error " + parts[3] : "");
                if (unrendered && marker)
                {
                    // Class 2: a privacy marker present but not cleanly read: the conservative exclusion markers go back.
                    saved.forceMarkers = true;
                    outcomes.Append(" marker " + why + ": exclusion markers forced");
                    continue;
                }
                if (unrendered && allowUnrendered)
                {
                    // Class 3 (owner decision): under a PROVEN hold with the sequence unchanged, the owner did not render it
                    // (for example Explorer's or Outlook's FileContents). A NAMED, REPORTED skip: the paste goes ahead and
                    // the restore result names it to the app.
                    saved.reportedSkip = true;
                    saved.skippedNames.Add(DisplayName(format, name) + " (not provided by the app that copied it)");
                    outcomes.Append(" " + why + ": not rendered by its owner, skipped (reported)");
                    unrenderedSkips++;
                    continue;
                }
                saved.Discard();
                line = "NOT ESTABLISHED (" + listing + "; [" + outcomes + " " + why + "]): a listed format could not be read" + (unrendered ? " (retried once; then a reported skip)" : "") + "; not pasting";
                return null;
            }
            // The formats Windows rebuilds, decided by the representation actually RETAINED (never by availability hints).
            bool dibRetained = saved.Has(CF_DIB) || saved.Has(CF_DIBV5);
            foreach (uint format in deferred)
            {
                if (outcomes.Length > 0) outcomes.Append(", ");
                outcomes.Append(format);
                if (format == CF_METAFILEPICT)
                {
                    if (saved.metafile != IntPtr.Zero) outcomes.Append(" rebuilt from the retained EMF (policy)");
                    else { saved.reportedSkip = true; saved.skippedNames.Add("CF_METAFILEPICT (no picture to rebuild it from)"); outcomes.Append(" not saved (no EMF retained: reported)"); }
                }
                else if (dibRetained) outcomes.Append(" rebuilt from the retained DIB (policy)");
                else
                {
                    // Round 23 (S2): named too, so no loss hides behind another one's name.
                    saved.complete = false;
                    saved.skippedNames.Add(DisplayName(format, null) + " (no picture to rebuild it from)");
                    outcomes.Append(" not saved (no DIB retained: partial)");
                }
            }
            // Round 23, THE ONE RULE (owner decision, Opus S-C with Astra S3): if nothing with USER CONTENT goes back, the
            // save is not established and nothing is pasted. User content excludes CF_LOCALE, the privacy markers, the
            // presence-only flags, our sentinel and bookkeeping (IsUserContent). It covers class 3's limit (every content
            // format unrendered), a clipboard holding only something over the cap (a 4K screenshot's DIB over 16 MiB),
            // and a delayed-render text owner answering none for the text while its CF_LOCALE reads. A positively empty
            // clipboard (listed 0) is not this case: nothing is lost by emptying it.
            if (listed > 0 && userContent == 0 && saved.metafile == IntPtr.Zero)
            {
                saved.Discard();
                retry = false;
                LastNoSaveReason = tooLarge ? "too-large" : unrenderedSkips > 0 ? "unrendered" : "nothing-savable";
                line = "NOT ESTABLISHED (" + listing + "; [" + outcomes + "]): nothing with the user's content could be kept" + (tooLarge ? " (too large)" : unrenderedSkips > 0 ? " (not provided by its owner)" : "") + ", so nothing could be put back; not pasting";
                return null;
            }
            // Someone copied while the save ran: their copy is the user's clipboard now; never paste over it.
            uint now = sequenceNow();
            if (now != sequence) { saved.Discard(); retry = false; line = "the clipboard changed while it was saved (" + listing + ", now " + now + "); not pasting"; return null; }
            saved.ListedCount = listed;
            // Provenance (round 22): something was listed but nothing retained can never report "restored".
            if (listed > 0 && saved.items.Count == 0 && saved.metafile == IntPtr.Zero && saved.presenceOnly.Count == 0) saved.reportedSkip = true;
            line = "ESTABLISHED (" + listing + "; " + (listed == 0 ? "a positively empty clipboard" : "[" + outcomes + "]") + ")";
            return saved;
        }

        /// <summary>How many formats the save's listing held (provenance, written down: an all-skipped save is never an empty clipboard).</summary>
        public int ListedCount;
        /// <summary>The formats the save could not keep, by name and reason (written down; the restore result names them to the app).</summary>
        internal readonly List<string> skippedNames = new List<string>();
        public IList<string> SkippedNames { get { return skippedNames; } }
        /// <summary>What a record read back could not bring back (ReadFrom), by name and reason (never written down).</summary>
        readonly List<string> lostNames = new List<string>();

        /// <summary>
        /// Round 22 (S3): part of this clipboard could not be saved, kept or read back. Its put-back can only be partial:
        /// the user's Restore of such an offer runs only when the card said so (acceptIncomplete).
        /// </summary>
        public bool Incomplete { get { return contentLost || reportedSkip || !complete; } }

        /// <summary>What a put-back of this save cannot include, by name and reason (a generic line when no name is known).</summary>
        public List<string> Missing()
        {
            List<string> missing = new List<string>(skippedNames);
            missing.AddRange(lostNames);
            if (missing.Count == 0 && Incomplete) missing.Add("part of the copied content (it could not be kept)");
            return missing;
        }

        /// <summary>A format's name for a notice: its registered name, or the standard name.</summary>
        internal static string DisplayName(uint format, string name)
        {
            if (!string.IsNullOrEmpty(name)) return name;
            switch (format)
            {
                case 1: return "CF_TEXT"; case 2: return "CF_BITMAP"; case 3: return "CF_METAFILEPICT"; case 7: return "CF_OEMTEXT";
                case 8: return "CF_DIB"; case 9: return "CF_PALETTE"; case 13: return "CF_UNICODETEXT"; case 14: return "CF_ENHMETAFILE";
                case 15: return "CF_HDROP"; case 16: return "CF_LOCALE"; case 17: return "CF_DIBV5";
                default: return "format " + format;
            }
        }

        /// <summary>A save that is not kept: its metafile handle is freed.</summary>
        internal void Discard()
        {
            if (metafile != IntPtr.Zero) { Native.DeleteEnhMetaFile(metafile); metafile = IntPtr.Zero; }
        }

        /// <summary>The saved formats, for PendingClipboard (registered formats by name, so they re-register).</summary>
        public void WriteTo(System.IO.BinaryWriter writer)
        {
            writer.Write(items.Count + presenceOnly.Count);
            foreach (KeyValuePair<uint, byte[]> item in items)
            {
                writer.Write(item.Key);
                writer.Write(item.Key >= 0xC000 ? FormatName(item.Key) : "");
                writer.Write(item.Value.Length);
                writer.Write(item.Value);
            }
            // Presence-only formats (round 22): written with length -1 and no bytes.
            foreach (uint format in presenceOnly)
            {
                writer.Write(format);
                writer.Write(FormatName(format));
                writer.Write(-1);
            }
            // Round 22: the EMF bytes the capture validated (or read back from a record) are written as they are. Only a
            // metafile without them is extracted here, and a failed extraction is written as LOST (-1), never as absent
            // (0): a record that had an EMF must never read back as a complete record without one.
            byte[] bits = metafileBits;
            if (bits == null && metafile != IntPtr.Zero)
            {
                uint size = Native.GetEnhMetaFileBits(metafile, 0, null);
                bits = size > 0 ? new byte[size] : null;
                if (bits != null && Native.GetEnhMetaFileBits(metafile, size, bits) != size) bits = null;
                if (bits == null) Wire.Log("ERROR: the saved metafile could not be written down; the record is marked incomplete");
            }
            bool lost = bits == null && (metafile != IntPtr.Zero || metafileExpected);
            writer.Write(lost ? -1 : bits != null ? bits.Length : 0);
            if (bits != null) writer.Write(bits);
            writer.Write(forceMarkers);
            // How complete the save was, so a recovery reports what an ordinary restore would.
            writer.Write(complete);
            writer.Write(reportedSkip);
            // Provenance (round 22): the listed count and what could not be kept, by name and reason.
            writer.Write(ListedCount);
            writer.Write(skippedNames.Count);
            foreach (string skipped in skippedNames) writer.Write(skipped);
        }

        public static SavedClipboard ReadFrom(System.IO.BinaryReader reader)
        {
            SavedClipboard saved = new SavedClipboard();
            int count = reader.ReadInt32();
            for (int i = 0; i < count; i++)
            {
                uint format = reader.ReadUInt32();
                string name = reader.ReadString();
                int length = reader.ReadInt32();
                if (length == -1)
                {
                    // A presence-only format (round 22): it must name one of the known ones, or the record is incomplete.
                    uint registered = PresenceOnly.Contains(name) ? Native.RegisterClipboardFormat(name) : 0;
                    if (registered != 0) saved.presenceOnly.Add(registered);
                    else { saved.contentLost = true; saved.lostNames.Add((name.Length > 0 ? name : "a registered format") + " (could not be read back)"); }
                    continue;
                }
                byte[] bytes = reader.ReadBytes(length);
                if (format >= 0xC000) format = name.Length > 0 ? Native.RegisterClipboardFormat(name) : 0;
                // Round 21: a registered format with no name, or one that cannot be registered again, cannot go back:
                // the record is INCOMPLETE (never "restored", never deleted as already there), not silently smaller.
                if (format != 0) saved.items.Add(new KeyValuePair<uint, byte[]>(format, bytes));
                else { saved.contentLost = true; saved.lostNames.Add((name.Length > 0 ? name : "a registered format") + " (its name could not be read back)"); }
            }
            int metaLength = reader.ReadInt32();
            if (metaLength < 0) { saved.contentLost = true; saved.metafileExpected = true; saved.lostNames.Add("CF_ENHMETAFILE (it could not be written down)"); } // round 22: an EMF that could not be written down: incomplete, never absent
            if (metaLength > 0)
            {
                byte[] bits = reader.ReadBytes(metaLength);
                saved.metafileBits = bits;
                saved.metafile = Native.SetEnhMetaFileBits((uint)bits.Length, bits);
                // A metafile that cannot be rebuilt is part of the save that cannot go back: never "restored", never
                // "already on the clipboard" (so such a record is never dropped as untouched).
                if (saved.metafile == IntPtr.Zero) { saved.contentLost = true; saved.lostNames.Add("CF_ENHMETAFILE (it could not be rebuilt)"); }
            }
            saved.forceMarkers = reader.ReadBoolean();
            saved.complete = reader.ReadBoolean() && !saved.contentLost;
            if (TestMode.Env("DICTATION_HELPER_TEST_RECORD_LOSES_NAME") == "1" && saved.items.Count > 0) { saved.items.RemoveAt(saved.items.Count - 1); saved.contentLost = true; saved.complete = false; saved.lostNames.Add("a registered format (its name could not be read back)"); } // test build only
            saved.reportedSkip = reader.ReadBoolean();
            if (reader.BaseStream.Position < reader.BaseStream.Length)
            {
                saved.ListedCount = reader.ReadInt32();
                int skipped = reader.ReadInt32();
                for (int i = 0; i < skipped; i++) saved.skippedNames.Add(reader.ReadString());
            }
            return saved;
        }

        /// <summary>Set every saved format on the clipboard, which the caller has open and has emptied.</summary>
        public bool PutBackOpen(PutBackTrace trace = null)
        {
            bool ok = true;
            uint sentinel = Native.RegisterClipboardFormat(PendingClipboard.SentinelFormat);
            int stallAfter = TestMode.Int("DICTATION_HELPER_TEST_PUTBACK_STALL_AFTER", -1);
            int set = 0;
            foreach (KeyValuePair<uint, byte[]> item in items)
            {
                if (item.Key == sentinel) continue; // never ours as the user's content (an older record may hold one)
                if (set == stallAfter) Thread.Sleep(TestMode.Int("DICTATION_HELPER_TEST_PUTBACK_STALL_MS", 0)); // test build only: die inside the put-back
                bool failNow = TestMode.On && Interlocked.Decrement(ref testFailPutBacks) >= 0; // test build only: a set-back that fails
                int error = -2; // -2: failed by the test hook
                bool done = !failNow && ClipboardText.SetBytes(item.Key, item.Value, out error);
                if (!done) ok = false;
                if (trace != null) trace.Set(item.Key, item.Value.Length, done, error);
                set++;
            }
            foreach (uint format in presenceOnly)
            {
                // Presence only: delayed rendering our window never renders (available, no data), as its owner set it.
                Native.SetClipboardData(format, IntPtr.Zero);
                bool done = Native.IsClipboardFormatAvailable(format);
                if (trace != null) trace.Set(format, -1, done, done ? 0 : -1);
                if (!done) ok = false;
            }
            if (metafile != IntPtr.Zero)
            {
                bool done = Native.SetClipboardData(CF_ENHMETAFILE, metafile) != IntPtr.Zero;
                if (trace != null) trace.Set(CF_ENHMETAFILE, -1, done, done ? 0 : Marshal.GetLastWin32Error());
                if (!done) ok = false;
                metafile = IntPtr.Zero;
            }
            // A marker was present but unreadable: keep the content out of history and cloud.
            if (forceMarkers)
            {
                bool marked = ClipboardText.SetConservativeMarkers();
                if (trace != null) trace.Set(0, -1, marked, marked ? 0 : -1);
                if (!marked) ok = false;
            }
            // Test build only (round 23, B2): die with every retained format set back, before the close.
            int stallEnd = TestMode.Int("DICTATION_HELPER_TEST_PUTBACK_STALL_END_MS", 0);
            if (stallEnd > 0) Thread.Sleep(stallEnd);
            return ok;
        }

        public int Count { get { return items.Count; } }
        /// <summary>How many formats the save kept (an offer shows formats and size only).</summary>
        public int FormatCount { get { return items.Count + presenceOnly.Count + (metafile != IntPtr.Zero ? 1 : 0); } }
        /// <summary>The saved bytes (an offer shows formats and size only).</summary>
        public long ByteCount
        {
            get
            {
                long total = 0;
                foreach (KeyValuePair<uint, byte[]> item in items) total += item.Value.Length;
                if (metafile != IntPtr.Zero) total += Native.GetEnhMetaFileBits(metafile, 0, null);
                return total;
            }
        }
        /// <summary>
        /// Every saved format is among the present ones (with MatchesOpenClipboard: the clipboard holds exactly the saved
        /// content). Round 23 (B2): only for a WHOLE save. A save that skipped anything (a class-3 or cap or policy skip),
        /// was not complete, or lost content on read-back is never "already on the clipboard": what is there can be the
        /// retained subset only, so the record is never deleted as untouched nor answered "restored" through that proof.
        /// </summary>
        public bool AllPresent(IList<uint> present)
        {
            if (Incomplete) return false;
            uint sentinel = Native.RegisterClipboardFormat(PendingClipboard.SentinelFormat);
            foreach (KeyValuePair<uint, byte[]> item in items) if (item.Key != sentinel && !present.Contains(item.Key)) return false;
            foreach (uint format in presenceOnly) if (!present.Contains(format)) return false;
            if (metafile != IntPtr.Zero && !present.Contains(CF_ENHMETAFILE)) return false;
            return items.Count > 0 || metafile != IntPtr.Zero;
        }
        /// <summary>A standard format Windows can synthesize from another (see Synthesizes).</summary>
        public static bool MaybeSynthesized(uint format)
        {
            foreach (KeyValuePair<uint, uint[]> rule in Synthesizes) if (Array.IndexOf(rule.Value, format) >= 0) return true;
            return false;
        }
        /// <summary>Whether this format is one of the saved items (or the saved EMF).</summary>
        public bool Has(uint format)
        {
            if (format == CF_ENHMETAFILE && metafile != IntPtr.Zero) return true;
            foreach (KeyValuePair<uint, byte[]> item in items) if (item.Key == format) return true;
            return presenceOnly.Contains(format);
        }
#if DICTATION_TEST
        /// <summary>Test build only: the saved formats by number (registered ones by name), never content.</summary>
        public string DescribeFormats()
        {
            List<string> names = new List<string>();
            foreach (KeyValuePair<uint, byte[]> item in items) names.Add(item.Key >= 0xC000 ? FormatName(item.Key) : item.Key.ToString());
            if (metafile != IntPtr.Zero) names.Add("14");
            return string.Join(",", names.ToArray());
        }
#endif
        static int testFailPutBacks = TestMode.Int("DICTATION_HELPER_TEST_FAIL_PUTBACKS", 0);
        /// <summary>Clipboard operations a put-back performs after its EmptyClipboard (Decide's bound for a restore cut short).</summary>
        /// <summary>The clipboard carried a privacy marker: the saved content must never be written to disk.</summary>
        public bool PrivacyMarked;
        /// <summary>This paste's clipboard transaction (PendingClipboard), until it is settled.</summary>
        public PendingRecord Record;

        /// <summary>The transaction is over (restore ran, or nothing was emptied): finish its record once. Nothing more is written.</summary>
        public void Settle(string restoreResult)
        {
            PendingRecord record = Record;
            Record = null;
            try { LoseAuthority("settled (" + restoreResult + ")"); }
            finally { PendingClipboard.Finish(record, restoreResult); }
        }

        /// <summary>
        /// THE GUARD (round 18). Automatic restore authority exists only here, in this live, in-memory transaction, in the
        /// process that wrote; nothing read from disk ever carries it (PendingClipboard.Decide). One flag, set once by
        /// LoseAuthority and never cleared, checked at the top of RestoreInner (the only in-process path that writes the
        /// clipboard after our write) and of OurWriteStillThere. Set on: a confirmation rejection or failed read, every
        /// keep-as-offer, an incomplete put-back, a stage that could not be journaled, the write's own put-back, and
        /// settlement (the transaction leaving in-flight). The record, if any, is marked offer-only too (informational).
        /// </summary>
        public bool OfferOnly { get { return offerOnly; } }
        bool offerOnly;

        public void LoseAuthority(string why)
        {
            if (!offerOnly)
            {
                offerOnly = true;
                Wire.Log("this transaction may no longer write the clipboard on its own: " + why);
            }
            if (Record != null) PendingClipboard.MarkOfferOnly(Record, why);
        }

        /// <summary>Tests: a saved clipboard with these items (and a privacy marker or not).</summary>
        internal static SavedClipboard ForTest(IEnumerable<KeyValuePair<uint, byte[]>> items, bool privacyMarked, bool complete = true, bool reportedSkip = false, IEnumerable<uint> presenceOnlyFormats = null)
        {
            SavedClipboard saved = new SavedClipboard();
            saved.items.AddRange(items);
            if (presenceOnlyFormats != null) saved.presenceOnly.AddRange(presenceOnlyFormats);
            saved.PrivacyMarked = privacyMarked;
            saved.complete = complete;
            saved.reportedSkip = reportedSkip;
            return saved;
        }

        /// <summary>
        /// Under the clipboard lock: what is on the clipboard is exactly a restore of ours cut short (see
        /// ExplainsPresent). Read without asking any live owner to render (the caller checked the owner).
        /// </summary>
        public bool MatchesOpenClipboard()
        {
            List<uint> present;
            if (!ClipboardText.EnumerateComplete(out present, "matches")) return false; // incomplete: no proof (no "untouched" deletion)
            byte[] emf = null;
            if (metafile != IntPtr.Zero)
            {
                uint size = Native.GetEnhMetaFileBits(metafile, 0, null);
                if (size > 0) { emf = new byte[size]; if (Native.GetEnhMetaFileBits(metafile, size, emf) != size) emf = null; }
            }
            return ExplainsPresent(present, delegate (uint f, int cap) { return ClipboardText.ReadBytes(f, cap); }, items, emf, ReadOpenEmf, forceMarkers, presenceOnly);
        }

        static byte[] ReadOpenEmf()
        {
            IntPtr handle = Native.GetClipboardData(CF_ENHMETAFILE);
            if (handle == IntPtr.Zero) return null;
            uint size = Native.GetEnhMetaFileBits(handle, 0, null);
            if (size == 0) return null;
            byte[] bits = new byte[size];
            return Native.GetEnhMetaFileBits(handle, size, bits) == size ? bits : null;
        }

        /// <summary>
        /// Windows' synthesized formats, directed: a format present on the clipboard is explained by one of
        /// these only when its SOURCE is present and compared equal (CF_LOCALE comes with a text format; a
        /// saved CF_LOCALE alone explains no text).
        /// </summary>
        static readonly Dictionary<uint, uint[]> Synthesizes = new Dictionary<uint, uint[]>
        {
            { CF_TEXT, new[] { CF_OEMTEXT, CF_UNICODETEXT, CF_LOCALE } },
            { CF_OEMTEXT, new[] { CF_TEXT, CF_UNICODETEXT, CF_LOCALE } },
            { CF_UNICODETEXT, new[] { CF_TEXT, CF_OEMTEXT, CF_LOCALE } },
            { CF_BITMAP, new[] { CF_DIB, CF_DIBV5 } },
            { CF_DIB, new[] { CF_BITMAP, CF_PALETTE, CF_DIBV5 } },
            { CF_DIBV5, new[] { CF_BITMAP, CF_DIB, CF_PALETTE } },
            { CF_ENHMETAFILE, new[] { CF_METAFILEPICT } },
            { CF_METAFILEPICT, new[] { CF_ENHMETAFILE } }
        };

        /// <summary>
        /// The rule (unit-tested): every format present is either one we saved, with identical bytes and
        /// length (compared; EMF by its bits), or a format Windows synthesizes from a present, compared
        /// format (directed, see Synthesizes), or, when the save forced them, our conservative markers. Any
        /// other format, or any differing content, means the clipboard holds something else (a new
        /// screenshot, a new copy). At least one format must have been compared.
        /// </summary>
        internal static bool ExplainsPresent(IList<uint> present, Func<uint, int, byte[]> read, IList<KeyValuePair<uint, byte[]>> saved, byte[] savedEmf, Func<byte[]> readEmf, bool forcedMarkers = false, IList<uint> presenceOnlySaved = null)
        {
            HashSet<uint> compared = new HashSet<uint>();
            List<uint> rest = new List<uint>();
            foreach (uint f in present)
            {
                if (presenceOnlySaved != null && presenceOnlySaved.Contains(f)) continue; // saved as presence only: present is all it can be
                byte[] mine = null;
                foreach (KeyValuePair<uint, byte[]> item in saved) if (item.Key == f) { mine = item.Value; break; }
                if (mine != null)
                {
                    // One byte more than ours is asked for: longer data that starts with our bytes is not ours.
                    byte[] now = read(f, mine.Length + 1);
                    if (!ClipboardText.Same(now, mine)) return false;
                    compared.Add(f);
                    continue;
                }
                if (f == CF_ENHMETAFILE && savedEmf != null)
                {
                    if (!ClipboardText.Same(readEmf(), savedEmf)) return false;
                    compared.Add(f);
                    continue;
                }
                rest.Add(f);
            }
            uint[] markerFormats = new uint[ClipboardText.MarkerNames.Length];
            for (int i = 0; i < markerFormats.Length; i++) markerFormats[i] = Native.RegisterClipboardFormat(ClipboardText.MarkerNames[i]);
            foreach (uint f in rest)
            {
                bool synthesized = false;
                foreach (uint source in compared)
                {
                    uint[] derived;
                    if (Synthesizes.TryGetValue(source, out derived) && Array.IndexOf(derived, f) >= 0) synthesized = true;
                }
                if (synthesized) continue;
                int marker = Array.IndexOf(markerFormats, f);
                if (forcedMarkers && marker >= 0)
                {
                    byte[] expected = marker == 0 ? new byte[] { 0 } : BitConverter.GetBytes(0);
                    if (ClipboardText.Same(read(f, expected.Length + 1), expected)) continue;
                }
                return false;
            }
            return compared.Count > 0;
        }

        /// <summary>The clipboard sequence number the save was taken at (the paste requires it unchanged).</summary>
        public uint Sequence;
        /// <summary>After a Restore that returned "unrestored": dictated | foreign | unknown (see DeliveryResult.ClipboardHolds).</summary>
        public string Holds;
        /// <summary>A user-visible format was dropped by a cap (not a silent private-format drop).</summary>
        public bool ReportedSkip { get { return reportedSkip; } }

        /// <summary>
        /// Restores only while the clipboard is provably still our write (owner window and final
        /// sequence number, checked under the lock). restored: back as it was. skipped: some content
        /// was too large or could not be kept. partial: some content could not be re-rendered.
        /// user-changed: someone else wrote to it meanwhile (their newer copy is left alone).
        /// unrestored: the clipboard could not be emptied, so it still holds the dictated text.
        /// </summary>
        public string Restore(ClipboardOwnership ours)
        {
            keepRecord = false;
            string result = RestoreInner(ours);
            // Someone else's content now (an owner change): left alone, and the saved clipboard kept as an offer.
            if (result == "user-changed" && Record != null) { KeepAsOffer("the clipboard's owner changed"); return result; }
            // Anything short of a completed put-back ends this transaction's authority before the record is kept.
            if (result == "unrestored" || keepRecord) LoseAuthority("an incomplete put-back (" + result + ")");
            if (keepRecord && Record != null && Record.Persisted)
            {
                // Put back, but an interruption could not have been proven ours (its stage was not journaled):
                // the record is kept; the next check finds the saved content on the clipboard and drops it.
                PendingRecord record = Record;
                Record = null;
                PendingClipboard.Keep(record, "a restore whose stage could not be journaled");
            }
            else Settle(result);
            return result;
        }

        /// <summary>Under the lock: our window owns the clipboard and our complete write (this transaction's) is on it.</summary>
        bool OurWriteStillThere(ClipboardOwnership ours)
        {
            // The one guard: a transaction that lost its authority (a rejection, a keep, ...) is never "ours" again.
            if (offerOnly) return false;
            if (Record == null || Record.DictatedHash == null || ours.Owner == IntPtr.Zero || Native.GetClipboardOwner() != ours.Owner) return false;
            List<uint> present;
            if (!ClipboardText.EnumerateComplete(out present, "still-there")) return false; // incomplete: no proof, no automatic restore
            if (ClipboardText.ClassifyOurWrite(present, delegate (uint f, int cap) { return ClipboardText.ReadBytes(f, cap); }, Record.Id, Record.Nonce, Record.DictatedHash, ours.ExpectedForms()) != OurWrite.Complete) return false;
            // And at a sequence our close explains (as the confirmation requires).
            int synthesized = 0;
            foreach (uint f in present) if (MaybeSynthesized(f) && !ClipboardText.OurWriteFormat(f)) synthesized++;
            uint basis = ours.Confirmed ? ours.SequenceFinal : ours.SequenceInside;
            uint now = ClipboardText.Sequence("still-there");
            return basis != 0 && now != 0 && unchecked(now - basis) <= (uint)(PendingClipboard.CloseMoves + synthesized);
        }

        /// <summary>
        /// What a look at the clipboard found against our write. FOREIGN only when its owner changed (someone emptied
        /// it: their copy is newer, settled). OWNED BUT CHANGED: our window still owns it but our complete write is not
        /// on it (an app added a format without emptying, a monitor read it): kept, as an offer. UNINSPECTABLE: it
        /// could not be opened: no proof of anything, kept.
        /// </summary>
        public enum Inspection { Ours, Foreign, OwnedButChanged, Uninspectable }

        /// <summary>
        /// Opens the clipboard (a blocking call: it may retry for ~180 ms) and says whether our window owns it with our
        /// complete write (this transaction's) on it; `sequence` is the sequence at that look. A clipboard that could
        /// not be opened is UNINSPECTABLE: that is no proof our write is gone, so nothing may be settled on it.
        /// </summary>
        public Inspection InspectOurWrite(ClipboardOwnership ours, out uint sequence)
        {
            sequence = 0;
            if (!ClipboardText.Open()) return Inspection.Uninspectable;
            try
            {
                sequence = Native.GetClipboardSequenceNumber();
                if (OurWriteStillThere(ours)) return Inspection.Ours;
                return ours.Owner != IntPtr.Zero && Native.GetClipboardOwner() == ours.Owner ? Inspection.OwnedButChanged : Inspection.Foreign;
            }
            finally { Native.CloseClipboard(); }
        }

        /// <summary>Keep this transaction's record as an offer: this transaction may never write on its own again.</summary>
        public void KeepAsOffer(string why)
        {
            LoseAuthority(why);
            PendingRecord record = Record;
            Record = null;
            if (record == null) return;
            if (record.Persisted) PendingClipboard.Keep(record, "kept as an offer");
            else PendingClipboard.Finish(record, "unrestored");
        }

        /// <summary>Set by RestoreInner when the record must be kept whatever the result (a lost journal).</summary>
        bool keepRecord;

        string RestoreInner(ClipboardOwnership ours)
        {
            Holds = null;
            if (ours == null || !ours.Emptied) return "untouched";
            // THE GUARD: this transaction lost its authority (whether or not it still has a record): it never writes again.
            if (offerOnly)
            {
                Wire.Log("this transaction may not write on its own any more: not restored (kept as an offer)");
                Holds = ours.Holds();
                keepRecord = true;
                return "unrestored";
            }
            // Someone else emptied the clipboard right after our write: their copy is newer and wins.
            if (ours.ForeignAtConfirm) return "user-changed";
            PutBackTrace trace = new PutBackTrace("restore"); // log only
            if (!ClipboardText.Open())
            {
                // Not looked at: the record is kept and only ever offered (nothing on disk is proof).
                Holds = ours.Holds();
                return "unrestored";
            }
            bool ok = true;
            try
            {
                // Only a confirmed write (its content checked at the confirmation) is proven by owner and sequence.
                bool provenBySequence = ours.Confirmed && ours.StillOurs();
                if (!provenBySequence && OurWriteStillThere(ours))
                {
                    // The sequence moved since our confirmation, but the clipboard still holds exactly our write (every
                    // format compared byte for byte, at a sequence within our close and the formats Windows synthesizes):
                    // ours. (Our confirmation materializes the synthesized forms, so a later reader does not move it.)
                    Wire.Log("the clipboard sequence moved since our write, but our window owns it and our complete write is on it (a target read the synthesized formats): restoring");
                    provenBySequence = true;
                }
                if (!provenBySequence && ours.Owner != IntPtr.Zero && Native.GetClipboardOwner() == ours.Owner)
                {
                    // Our window still owns it, but it is not exactly our write (an app added a format without emptying):
                    // not someone else's newer copy, and not provably ours either: kept, as an offer (never settled).
                    Wire.Log("our window owns the clipboard but our write is not all there: kept as an offer");
                    keepRecord = true;
                    Holds = "unknown";
                    return "unrestored";
                }
                if (!provenBySequence && ours.Confirmed)
                {
                    // Proven ownership was lost: a different owner, or other content, is a newer copy by someone
                    // else, which wins (no warning; nothing of the user's was lost to us).
                    return "user-changed";
                }
                if (!provenBySequence)
                {
                    // Ownership was never confirmed (the clipboard was busy) and the owner or the
                    // sequence changed since our write: it is not provably ours, so it is not
                    // overwritten, and the user is told their clipboard was not put back, and what it
                    // holds instead.
                    Holds = ours.Holds();
                    return "unrestored";
                }
                // If the clipboard cannot be emptied, do not partially overwrite it: report it plainly.
                // (A test build can simulate EmptyClipboard failing here.)
                // Journaled before our EmptyClipboard and again right after it under the same lock, so a restore cut
                // short anywhere leaves a record that is offered (since round 18 nothing on disk finishes it on its
                // own). A restore sets no sentinel: a restored clipboard holds only the user's content.
                // Every journal result is honored: without "restoring" nothing is emptied (kept, retried).
                if (!PendingClipboard.Stage(Record, "restoring", Native.GetClipboardSequenceNumber()))
                {
                    Wire.Log("the restore could not be journaled; nothing emptied (kept for a retry)");
                    Holds = "dictated";
                    return "unrestored";
                }
                int beforeEmpty = TestMode.Int("DICTATION_HELPER_TEST_RESTORE_STALL_BEFORE_EMPTY_MS", 0);
                if (beforeEmpty > 0) Thread.Sleep(beforeEmpty); // test build only: die before the restore empties
                bool emptied = TestMode.Env("DICTATION_HELPER_TEST_FAIL_RESTORE_EMPTY") != "1" && Native.EmptyClipboard();
                trace.Emptied(emptied, emptied ? 0 : Marshal.GetLastWin32Error());
                if (!emptied)
                {
                    Holds = "dictated";
                    return "unrestored";
                }
                if (!PendingClipboard.Stage(Record, "restore-emptied", Native.GetClipboardSequenceNumber()))
                {
                    // The user's content goes back now (it must not stay off the clipboard), and the record is kept.
                    Wire.Log("the restore's emptied stage could not be journaled: putting back, and keeping the record");
                    keepRecord = true;
                }
                int stall = TestMode.Int("DICTATION_HELPER_TEST_RESTORE_STALL_MS", 0);
                if (stall > 0) Thread.Sleep(stall); // test build only: die in the middle of a restore
                ok = PutBackOpen(trace);
            }
            finally
            {
                Native.ClearLastError(0); // round 22 (S6): the error read is this close's own
                bool closed = Native.CloseClipboard();
                int closeError = closed ? 0 : Marshal.GetLastWin32Error();
                trace.Closed(closed, closeError);
            }
            string result = RestoreResult(ok, complete, reportedSkip);
            if (result == "unrestored") Holds = "unknown";
            return result;
        }

        /// <summary>
        /// The result of a put-back (unit-tested): a format we could not set back is a FAILED restore
        /// ("unrestored": the record is kept and retried, no warning is cleared); content the save itself
        /// could not keep is "skipped" or "partial" (settled: nothing more can be put back later).
        /// </summary>
        internal static string RestoreResult(bool setOk, bool complete, bool reportedSkip)
        {
            if (!setOk) return "unrestored";
            // (A metafile that could not be rebuilt is not "partial": see PutBackResult, the record is kept.)
            if (reportedSkip) return "skipped";
            return complete ? "restored" : "partial";
        }

        /// <summary>The late write's put-back (inside Write), mapped the same way.</summary>
        public string PutBackResult(bool setOk)
        {
            // The payload still holds a metafile that could not be rebuilt this time: not settled, the record is kept.
            if (contentLost) return "unrestored";
            return RestoreResult(setOk, complete, reportedSkip);
        }
    }
}

namespace DoodleNote.DictationHelper
{
    /// <summary>
    /// Deliveries in progress, so the helper never exits in the middle of one (between our clipboard
    /// write and its restore, or before its reply): every exit path closes this first (new deliveries
    /// are refused) and waits, bounded, for the running one to finish.
    /// </summary>
    internal static class DeliveriesInFlight
    {
        static readonly object gate = new object();
        static int count;
        /// <summary>Clipboard writes running on their own thread (an abandoned one is an in-flight transaction).</summary>
        static int writes;
        static bool closed;
        static long deadlineTicks = long.MaxValue;

        public static void LateBegin() { lock (gate) writes++; }
        public static void LateEnd() { lock (gate) { writes--; Monitor.PulseAll(gate); } }

        /// <summary>False once the helper is leaving (the delivery must be refused, not started).</summary>
        public static bool Begin()
        {
            lock (gate)
            {
                if (closed) return false;
                count++;
                return true;
            }
        }

        public static void End()
        {
            lock (gate)
            {
                count--;
                Monitor.PulseAll(gate);
            }
        }

        static long Now { get { return Stopwatch.GetTimestamp() * 1000 / Stopwatch.Frequency; } }

        /// <summary>
        /// Refuse new deliveries, then wait for the running ones AND for every clipboard write's rollback,
        /// until ONE deadline (timeoutMs from now, or earlier once Shorten moves it; Shorten wakes this
        /// wait at once). True when nothing is left.
        /// </summary>
        public static bool CloseAndWait(int timeoutMs)
        {
            lock (gate)
            {
                closed = true;
                deadlineTicks = Math.Min(deadlineTicks, Now + timeoutMs);
                while (count > 0 || writes > 0)
                {
                    long left = deadlineTicks - Now;
                    if (left <= 0) return false;
                    Monitor.Wait(gate, (int)Math.Min(left, int.MaxValue));
                }
                return true;
            }
        }

        /// <summary>The exit's wait ends no later than ms from now (stdin closed during a restart's long wait).</summary>
        public static void Shorten(int ms)
        {
            lock (gate)
            {
                deadlineTicks = Math.Min(deadlineTicks, Now + ms);
                Monitor.PulseAll(gate);
            }
        }

        /// <summary>What is still running when the wait ends (for the exit's log).</summary>
        public static string Pending { get { lock (gate) return count + " delivery(ies), " + writes + " clipboard write(s)"; } }
    }
}
