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

        static int Ms(Stopwatch watch) { return (int)watch.ElapsedMilliseconds; }

        /// <summary>Validate the target immediately before inserting, then insert once.</summary>
        public static DeliveryResult Deliver(TargetSnapshot snapshot, string text, DeliveryGuards guards, int deadlineMs = 0, int alreadyElapsedMs = 0)
        {
            DeliveryTimings timings = new DeliveryTimings();
            BoundedStats stats = Bounded.Track();
            try
            {
                DeliveryResult result = DeliverInner(snapshot, text, guards, timings, deadlineMs, alreadyElapsedMs, stats);
                result.Timings = timings;
                if (result.ProviderSlowestMs < 0 && stats.SlowestMs > 0) result.ProviderSlowestMs = stats.SlowestMs;
                return result;
            }
            finally { Bounded.Untrack(); }
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
                    DeliveryResult pasted = Paste(text, current, snapshot, before, timings, out clipboardAfterPaste, out holdsAfterPaste, out lateWrite);
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
                if (look == SavedClipboard.Inspection.Foreign) { saved.Settle("user-changed"); return "user-changed|" + savedFormats; }
                // The sequence moved under our ownership: ownership alone no longer proves anything (proof c is off).
                if (look != SavedClipboard.Inspection.Ours) PendingClipboard.ForgetOwnership();
                if (look == SavedClipboard.Inspection.Uninspectable) return "uninspectable/" + saved.Restore(ours) + "|" + savedFormats;
                if (look == SavedClipboard.Inspection.OwnedButChanged) { saved.KeepAsOffer(); return "owned-but-changed/unrestored|" + savedFormats; }
            }
            // Test build only: a target that pastes by reading the synthesized ANSI text formats (an ANSI or
            // RichEdit app does), on another thread right after "Ctrl+V", as a real target would.
            if (TestMode.Env("DICTATION_HELPER_TEST_TARGET_READ") == "ansi") SimulateAnsiTargetRead();
            return saved.Restore(ours) + "|" + savedFormats;
        }

        static void SimulateAnsiTargetRead()
        {
            uint before = Native.GetClipboardSequenceNumber();
            Thread reader = new Thread(delegate ()
            {
                for (int attempt = 0; attempt < 50 && !Native.OpenClipboard(IntPtr.Zero); attempt++) Thread.Sleep(10);
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

        static DeliveryResult Paste(string text, AutomationElement element, TargetSnapshot snapshot, ControlState before, DeliveryTimings timings, out string clipboardAfterFailedWrite, out string holdsAfterFailedWrite, out ClipboardText.LateWrite lateWrite)
        {
            clipboardAfterFailedWrite = "untouched";
            holdsAfterFailedWrite = null;
            lateWrite = null;
            Stopwatch insert = Stopwatch.StartNew();
            SavedClipboard saved;
            ClipboardOwnership ours;
            ClipboardText.LateWrite late;
            bool written;
            if (BeginClipboardWrite(text, out saved, out ours, out written, out late) != null) return null;
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
        static string BeginClipboardWrite(string text, out SavedClipboard saved, out ClipboardOwnership ours, out bool written, out ClipboardText.LateWrite late, Action<SavedClipboard> afterSave = null)
        {
            ours = new ClipboardOwnership();
            written = false;
            late = null;
            // An earlier transaction that could not be put back gets its chance first (before our write).
            PendingClipboard.RecoverLeftover("delivery");
            // Saving the user's clipboard renders lazily-provided formats (OLE "Embed Source" and the
            // like), which can take arbitrarily long; it runs in the reader process, bounded per format.
            saved = SavedClipboard.CaptureBounded(CaptureBudgetMs);
            if (saved == null) return "no-save";
            if (afterSave != null) afterSave(saved);
            // Emptying the clipboard sends WM_DESTROYCLIPBOARD to its owner and waits for its answer
            // (measured on Dev04: Windows gave up after about 5.2 s on a hung owner). An owner that does
            // not answer a WM_NULL now is not asked at all; one that answers and then stalls is bounded
            // by the write's own thread (WriteBounded).
            string ownerProblem = ClipboardText.OwnerUnresponsive();
            if (ownerProblem != null)
            {
                Wire.Log("the clipboard's owner is not responding (" + ownerProblem + "); not pasting");
                return "owner-unresponsive";
            }
            // The transaction is written down until its restore ran, so a helper that ends meanwhile
            // loses nothing (see PendingClipboard; content with a privacy marker stays in memory only).
            // Without a record, no paste.
            PendingRecord record = PendingClipboard.Begin(saved, text);
            if (record == null) return "no-record";
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
            clipboard = ours != null && ours.Emptied ? saved.Restore(ours) : "untouched";
            saved.Settle(clipboard);
            holds = saved.Holds;
        }

        static DeliveryResult PasteAfterWrite(string text, AutomationElement element, TargetSnapshot snapshot, ControlState before, DeliveryTimings timings, SavedClipboard saved, ClipboardOwnership ours, bool written, Stopwatch insert, out string clipboardAfterFailedWrite, out string holdsAfterFailedWrite)
        {
            clipboardAfterFailedWrite = "untouched";
            holdsAfterFailedWrite = null;
            if (!written)
            {
                // The write failed part-way. If we emptied the clipboard, the user's content is gone
                // from it unless we put it back now (before any typing fallback): ownership comes from
                // having emptied it, not from the text landing, so an owned partial write is restored.
                if (ours.Emptied)
                {
                    clipboardAfterFailedWrite = saved.Restore(ours);
                    holdsAfterFailedWrite = saved.Holds;
                }
                else
                {
                    // The write put the saved content back itself (its emptied stage could not be journaled), or
                    // never emptied anything.
                    clipboardAfterFailedWrite = ours.PutBack ?? "untouched";
                    saved.Settle(clipboardAfterFailedWrite);
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
            // with our complete write on it is still ours. Someone else's content: nothing is pasted, their copy is
            // left alone (settled). A clipboard that could not be looked at: nothing is pasted, nothing settled.
            bool sequenceProof = true;
            uint inspectedSequence = 0;
            if (unsafeReason == null && !ours.LooksOurs())
            {
                SavedClipboard.Inspection look = saved.InspectOurWrite(ours, out inspectedSequence);
                if (look == SavedClipboard.Inspection.Foreign)
                {
                    Wire.Log("the clipboard changed hands before Ctrl+V; not pasting");
                    clipboardAfterFailedWrite = "user-changed";
                    saved.Settle("user-changed");
                    return null;
                }
                // The sequence moved under our ownership: ownership alone no longer proves anything (proof c is off).
                if (look != SavedClipboard.Inspection.Ours) PendingClipboard.ForgetOwnership();
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
                    saved.KeepAsOffer();
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
                DeliveryResult moved = new DeliveryResult(DeliveryOutcome.Refused, unsafeReason == "clipboard-changed" ? "focus-changed" : unsafeReason);
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

        public static bool Open()
        {
            // Another program may hold the clipboard for a moment.
            for (int attempt = 0; attempt < 12; attempt++)
            {
                if (Native.OpenClipboard(Ui.ClipboardWindow)) return true;
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
                ClipboardOwnership ours;
                bool ok = false;
                try { ok = Write(text, out ours, saved.Sequence, job, saved, false); }
                catch (Exception) { ours = new ClipboardOwnership(); }
                job.Ours = ours;
                job.Result = ok;
                if (Interlocked.CompareExchange(ref job.State, 1, 0) == 2)
                {
                    // Abandoned: this thread owns the rollback. If our text was already set, put the
                    // user's content back now; if it put it back while still open (Write), settle.
                    string outcome;
                    if (ours.Emptied)
                    {
                        ConfirmWritten(ours, saved.Record);
                        outcome = saved.Restore(ours);
                        Wire.Log("the late clipboard write was undone: " + outcome);
                    }
                    else outcome = ours.PutBack ?? job.PutBack ?? "untouched";
                    // A failed put-back stays "unrestored": its record is kept for a retry, and no warning is cleared.
                    saved.Settle(outcome);
                    job.Holds = outcome == "unrestored" ? "unknown" : null;
                    job.Outcome = outcome;
                    // Whenever it lands (before or after the reply), the app learns what happened.
                    Wire.Send(Wire.Fields("event", "clipboard", "phase", "late-restore", "id", deliveryId ?? "", "clipboard", outcome));
                    DeliveriesInFlight.LateEnd();
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
            if (ownership.Emptied) ConfirmWritten(ownership, saved.Record);
            return job.Result;
        }

        /// <summary>
        /// Put text on the clipboard, marked so clipboard history and sync skip it, and record what
        /// makes the clipboard provably ours afterwards (see ClipboardOwnership). `ownership.Emptied`
        /// is set as soon as EmptyClipboard succeeds, even if the text could not be set, so the caller
        /// can still put the user's content back.
        /// </summary>
        public static bool Write(string text, out ClipboardOwnership ownership, uint expectSequence = 0)
        {
            return Write(text, out ownership, expectSequence, null, null, true);
        }

        static bool Write(string text, out ClipboardOwnership ownership, uint expectSequence, LateWrite job, SavedClipboard saved, bool confirm)
        {
            ownership = new ClipboardOwnership();
            PendingRecord record = saved != null ? saved.Record : null;
            if (!Open()) return false;
            bool ok = false;
            try
            {
                // Under the lock: the clipboard must still be exactly what was saved, or emptying it
                // would discard a copy the user made after the save (it would never come back).
                if (expectSequence != 0 && Native.GetClipboardSequenceNumber() != expectSequence)
                {
                    Wire.Log("the clipboard changed after it was saved; not pasting");
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
                    // The sequence right after OUR EmptyClipboard, read under the same lock: the only proof an
                    // empty clipboard is our doing (PendingClipboard.Decide).
                    uint emptiedAt = Native.GetClipboardSequenceNumber();
                    PendingClipboard.NoteEmptied(record);
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
                        ownership.PutBack = saved.PutBackResult(saved.PutBackOpen());
                        if (job != null) job.PutBack = ownership.PutBack;
                        Wire.Log((abandoned ? "the late clipboard write" : "the unjournaled clipboard write") + " put the user's saved content back: " + ownership.PutBack);
                        return false;
                    }
                    ownership.Emptied = true;
                    // Test build only: simulate SetClipboardData failing after the clipboard was emptied.
                    ok = TestMode.Env("DICTATION_HELPER_TEST_FAIL_SET") != "1"
                        && SetBytes(CF_UNICODETEXT, System.Text.Encoding.Unicode.GetBytes(text + "\0"));
                    // Windows' own clipboard history and cloud clipboard, and clipboard
                    // managers that honor it, leave entries with these formats alone.
                    SetConservativeMarkers();
                    // Our transaction's sentinel, LAST (it is never the first format a reader sees): with our
                    // exact markers and our text (by hash) it proves our complete write (Decide).
                    if (record != null) SetSentinel(record);
                    // Sampled INSIDE the same open/close as our SetClipboardData: nobody else can
                    // write while we hold the clipboard.
                    ownership.SequenceInside = Native.GetClipboardSequenceNumber();
                }
            }
            finally { Native.CloseClipboard(); }
            if (ownership.Emptied)
            {
                // Journaled right after the close (before any confirmation), on the normal and the late path.
                int beforeWritten = TestMode.Int("DICTATION_HELPER_TEST_STALL_BEFORE_WRITTEN_MS", 0);
                if (beforeWritten > 0) Thread.Sleep(beforeWritten); // test build only: die before "written" is journaled
                PendingClipboard.Stage(record, "written", ownership.SequenceInside, ownership.SequenceInside);
            }
            if (confirm && ownership.Emptied) ConfirmWritten(ownership, record);
            return ok;
        }

        /// <summary>Confirm our write, and journal the sequence confirmed after the close (Windows moves it at the close).</summary>
        public static void ConfirmWritten(ClipboardOwnership ownership, PendingRecord record)
        {
            ownership.Confirm();
            if (ownership.Confirmed) PendingClipboard.StageClosed(record, ownership.SequenceFinal);
        }

        public static readonly string[] MarkerNames =
        {
            "ExcludeClipboardContentFromMonitorProcessing",
            "CanIncludeInClipboardHistory",
            "CanUploadToCloudClipboard"
        };

        /// <summary>Set the three privacy markers to "do not record" on the current clipboard (must be open).</summary>
        public static void SetConservativeMarkers()
        {
            SetBytes(Native.RegisterClipboardFormat(MarkerNames[0]), new byte[] { 0 });
            SetBytes(Native.RegisterClipboardFormat(MarkerNames[1]), BitConverter.GetBytes(0));
            SetBytes(Native.RegisterClipboardFormat(MarkerNames[2]), BitConverter.GetBytes(0));
        }

        /// <summary>Our transaction's sentinel format on the open clipboard ("record id:nonce"; no user content).</summary>
        public static void SetSentinel(PendingRecord record)
        {
            SetBytes(Native.RegisterClipboardFormat(PendingClipboard.SentinelFormat), System.Text.Encoding.UTF8.GetBytes(record.Id + ":" + record.Nonce));
        }

        const uint CF_TEXT_ = 1, CF_OEMTEXT_ = 7, CF_LOCALE_ = 16;
        static readonly byte[][] MarkerValues = { new byte[] { 0 }, BitConverter.GetBytes(0), BitConverter.GetBytes(0) };

        /// <summary>
        /// The rule (unit-tested): what the open clipboard holds against our write of THIS transaction.
        /// Complete: our sentinel with this transaction's nonce, our text (its SHA-256 matches the record's),
        /// and our three markers with exactly our values, and nothing else but the text formats Windows
        /// synthesizes from our text. Partial: some of that and nothing else (a write cut short; our
        /// sentinel, set last, may be missing). None: anything else, or nothing at all.
        /// </summary>
        internal static OurWrite ClassifyOurWrite(IList<uint> present, Func<uint, int, byte[]> read, string recordId, string nonce, byte[] dictatedHash)
        {
            if (present.Count == 0 || string.IsNullOrEmpty(nonce) || dictatedHash == null) return OurWrite.None;
            uint sentinelFormat = Native.RegisterClipboardFormat(PendingClipboard.SentinelFormat);
            uint[] markerFormats = new uint[MarkerNames.Length];
            for (int i = 0; i < MarkerNames.Length; i++) markerFormats[i] = Native.RegisterClipboardFormat(MarkerNames[i]);
            bool sentinel = false, ours = false;
            int markers = 0;
            foreach (uint f in present)
            {
                if (f == CF_TEXT_ || f == CF_OEMTEXT_ || f == CF_LOCALE_) continue; // judged below (synthesized from ours)
                if (f == sentinelFormat)
                {
                    byte[] value = read(f, 257);
                    string expected = recordId + ":" + nonce;
                    if (value == null || System.Text.Encoding.UTF8.GetString(value).TrimEnd('\0') != expected) return OurWrite.None;
                    sentinel = true;
                    continue;
                }
                if (f == CF_UNICODETEXT)
                {
                    byte[] value = read(f, int.MaxValue);
                    if (value == null) return OurWrite.None;
                    int length = value.Length - value.Length % 2;
                    while (length >= 2 && value[length - 1] == 0 && value[length - 2] == 0) length -= 2;
                    byte[] digest;
                    using (System.Security.Cryptography.SHA256 sha = System.Security.Cryptography.SHA256.Create()) digest = sha.ComputeHash(value, 0, length);
                    if (!Same(digest, dictatedHash)) return OurWrite.None;
                    ours = true;
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
            // Text formats Windows synthesizes are ours only with our text present.
            foreach (uint f in present) if ((f == CF_TEXT_ || f == CF_OEMTEXT_ || f == CF_LOCALE_) && !ours) return OurWrite.None;
            return sentinel && ours && markers == MarkerNames.Length ? OurWrite.Complete : OurWrite.Partial;
        }

        /// <summary>
        /// Under the lock: the bytes on the clipboard, formats and size only (an offer that changed shows what a
        /// restore would overwrite). Never for a live foreign owner (it may render: -1), and synthesized formats
        /// are not read (a read would render them). GDI-handle formats count as 0.
        /// </summary>
        public static long OpenClipboardBytes(bool foreignOwner)
        {
            if (foreignOwner) return -1;
            long total = 0;
            for (uint f = Native.EnumClipboardFormats(0); f != 0; f = Native.EnumClipboardFormats(f))
            {
                if (SavedClipboard.MaybeSynthesized(f) || f == 2 || f == 3 || f == 9 || f == 14) continue;
                IntPtr data = Native.GetClipboardData(f);
                if (data != IntPtr.Zero) total += (long)Native.GlobalSize(data).ToUInt64();
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
                Native.GlobalFree(memory);
                return false;
            }
            return true; // the clipboard owns the memory now
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
        /// <summary>Our write emptied the clipboard: the user's content is gone from it until restored.</summary>
        public bool Emptied;
        /// <summary>The write emptied the clipboard and put the saved content back itself, in the same open: its result.</summary>
        public string PutBack;
        /// <summary>The transaction could not be journaled before emptying: nothing was emptied.</summary>
        public bool JournalFailed;
        public uint SequenceInside;
        public uint SequenceFinal;
        /// <summary>
        /// The sequence number read right after our write closed the clipboard while our window was
        /// still its owner (without the lock; 0 when not read). The best evidence when Confirm() cannot
        /// take the lock: a later change to it means someone wrote after us.
        /// </summary>
        public uint SequenceUnlocked;
        public IntPtr Owner;
        /// <summary>Confirm() proved the clipboard was ours after our write was finalized.</summary>
        public bool Confirmed;
        /// <summary>
        /// Right after our write, another window already owned the clipboard: someone else emptied it
        /// after us, so what it holds is provably not ours (a newer copy by another app).
        /// </summary>
        public bool ForeignAtConfirm;

        public void Confirm()
        {
            IntPtr window = Ui.ClipboardWindow;
            Owner = window;
            if (window == IntPtr.Zero) return;
            // Test build only: widen the moment between our write and its confirmation.
            int confirmDelay = TestMode.Int("DICTATION_HELPER_TEST_CONFIRM_DELAY_MS", 0);
            if (confirmDelay > 0) Thread.Sleep(confirmDelay);
            if (Native.GetClipboardOwner() != window) { ForeignAtConfirm = true; return; }
            uint unlocked = Native.GetClipboardSequenceNumber();
            // The owner read again AFTER the sequence number: only a number sampled while our window was
            // still the owner on both sides is accepted (someone may write between two unlocked reads).
            if (Native.GetClipboardOwner() != window) { ForeignAtConfirm = true; return; }
            SequenceUnlocked = unlocked;
            // Test build only: simulate another reader holding the clipboard through the confirmation.
            if (TestMode.Env("DICTATION_HELPER_TEST_SKIP_CONFIRM") == "1") return;
            if (!ClipboardText.Open()) return;
            try
            {
                if (Native.GetClipboardOwner() != window) { ForeignAtConfirm = true; return; }
                uint now = Native.GetClipboardSequenceNumber();
                if (now < SequenceInside) return;
                SequenceFinal = now;
                Confirmed = true;
            }
            finally { Native.CloseClipboard(); }
        }

        /// <summary>Under the clipboard lock: the clipboard is still exactly as our write left it.</summary>
        public bool StillOurs()
        {
            return Confirmed && Native.GetClipboardOwner() == Owner && Native.GetClipboardSequenceNumber() == SequenceFinal;
        }

        /// <summary>
        /// Under the clipboard lock, when Confirm() could not take the lock (another reader held the
        /// clipboard): our window is still the owner (nobody has emptied it since our write) AND the
        /// sequence number is the one read right after our write (nobody has added to it either).
        /// </summary>
        public bool OwnerUnchanged()
        {
            return Owner != IntPtr.Zero && Native.GetClipboardOwner() == Owner
                && SequenceUnlocked != 0 && Native.GetClipboardSequenceNumber() == SequenceUnlocked;
        }

        /// <summary>Without the lock (right before Ctrl+V): our window still owns the clipboard and its sequence is the one a content look saw.</summary>
        public bool UnchangedSince(uint sequence)
        {
            return Owner != IntPtr.Zero && Native.GetClipboardOwner() == Owner && sequence != 0 && Native.GetClipboardSequenceNumber() == sequence;
        }

        /// <summary>Without the lock (right before Ctrl+V): the clipboard still holds our write, as far as can be seen.</summary>
        public bool LooksOurs()
        {
            if (ForeignAtConfirm || Owner == IntPtr.Zero || Native.GetClipboardOwner() != Owner) return false;
            uint now = Native.GetClipboardSequenceNumber();
            return Confirmed ? now == SequenceFinal : SequenceUnlocked != 0 && now == SequenceUnlocked;
        }

        /// <summary>What the clipboard holds when it could not be put back: dictated, foreign or unknown.</summary>
        public string Holds()
        {
            if (Owner != IntPtr.Zero && Native.GetClipboardOwner() != Owner) return "foreign";
            uint now = Native.GetClipboardSequenceNumber();
            if (Confirmed && now == SequenceFinal) return "dictated";
            if (!Confirmed && SequenceUnlocked != 0 && now == SequenceUnlocked) return "dictated";
            return "unknown";
        }
    }

    /// <summary>
    /// The user's clipboard, saved before a paste and put back afterwards. Every registered format
    /// and the known-safe standard formats (text, bitmaps, a file list) are preserved, so an app's
    /// own content (Excel cells, editor formats) round-trips; only OLE/private bookkeeping formats
    /// and the privacy markers get special handling. Total bytes and copy time are capped so a huge
    /// clipboard cannot stall a delivery; when a user-visible format is dropped by a cap the restore
    /// reports "skipped" so the overlay can warn.
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
        /// <summary>A written-down metafile that could not be rebuilt (see ReadFrom).</summary>
        bool metafileLost;
        bool complete = true;
        /// <summary>True only when a user-visible format was dropped by the byte or time cap; drops of private formats are silent.</summary>
        bool reportedSkip;
        /// <summary>A privacy marker was on the clipboard but could not be read, so set it conservatively on restore.</summary>
        bool forceMarkers;
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
        /// gives up the save; see ClipboardReader for what happens to that reader). Each read
        /// is also bounded by what is left of the whole save's budget, so the clipboard is never held by
        /// the reader for longer than that budget (1.5 s): a user's copy meanwhile waits at most that.
        /// </summary>
        const int PerFormatMs = 1500;

        /// <summary>
        /// Save the clipboard through the reader process (ClipboardReader), one bounded request per
        /// format, within timeoutMs in total. The clipboard is open only inside each request, never
        /// across the helper's own work, and other apps can still open it while a reader waits in a
        /// render. A read that overruns (an owner slow to render) abandons that reader, which finishes
        /// the render and exits on its own. Null, and nothing is pasted, when the save
        /// cannot complete: the clipboard cannot be opened, a read overran (the owner is stuck in a
        /// render, and the paste's own EmptyClipboard would wait for it too), or the clipboard changed
        /// while it was being saved (someone copied meanwhile).
        /// </summary>
        public static SavedClipboard CaptureBounded(int timeoutMs)
        {
            Stopwatch watch = Stopwatch.StartNew();
            ClipboardReaderClient reader = ClipboardReaderClient.Get();
            if (reader == null) return null;
            Func<int> left = () => timeoutMs - (int)watch.ElapsedMilliseconds;
            string list = reader.Request("list", Math.Min(PerFormatMs, left()));
            if (list == null || !list.StartsWith("list "))
            {
                Wire.Log(list == null ? "saving the clipboard: listing its formats overran; not pasting" : "saving the clipboard: it could not be opened; not pasting");
                return null;
            }
            string[] head = list.Split(' ');
            uint sequence = uint.Parse(head[1]);
            bool hasDib = head[2] == "1";
            bool hasEnhMetafile = head[3] == "1";
            List<KeyValuePair<uint, string>> formats = new List<KeyValuePair<uint, string>>();
            List<KeyValuePair<uint, string>> renderedLast = new List<KeyValuePair<uint, string>>();
            for (int i = 4; i < head.Length; i++)
            {
                int colon = head[i].IndexOf(':');
                if (colon <= 0) continue;
                uint format = uint.Parse(head[i].Substring(0, colon));
                string name = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(head[i].Substring(colon + 1)));
                KeyValuePair<uint, string> entry = new KeyValuePair<uint, string>(format, name);
                if (format >= 0xC000 && Array.IndexOf(RenderedLast, name.ToLowerInvariant()) >= 0) renderedLast.Add(entry);
                else formats.Add(entry);
            }
            formats.AddRange(renderedLast);
            SavedClipboard saved = new SavedClipboard();
            saved.Sequence = sequence;
            long total = 0;
            foreach (KeyValuePair<uint, string> entry in formats)
            {
                uint format = entry.Key;
                string name = entry.Value;
                long cap;
                bool marker = false;
                if (format == CF_BITMAP || format == CF_PALETTE)
                {
                    // Windows rebuilds these from the device-independent bitmap.
                    if (!hasDib) saved.complete = false;
                    continue;
                }
                if (format == CF_METAFILEPICT && hasEnhMetafile) continue; // synthesized from the saved EMF
                if (format < 0xC000)
                {
                    if (format != CF_ENHMETAFILE && !SafeStandard.Contains(format))
                    {
                        // A standard format we cannot replay (GDI handles, private/display formats) is a
                        // real loss and is reported, never dropped silently.
                        saved.reportedSkip = true;
                        continue;
                    }
                    cap = Math.Min(MaxFormatBytes, MaxBytes - total);
                }
                else if (name == PendingClipboard.SentinelFormat) continue; // ours (a write left by an earlier transaction), never the user's content
                else if (Markers.Contains(name)) { marker = true; saved.PrivacyMarked = true; cap = MaxMarkerBytes; }
                else if (SilentDrop.Contains(name)) continue; // OLE live-object bookkeeping
                else cap = Math.Min(MaxFormatBytes, MaxBytes - total);
                if (left() <= 0)
                {
                    if (marker) saved.forceMarkers = true; else saved.reportedSkip = true;
                    continue;
                }
                if (cap <= 0) { saved.reportedSkip = true; continue; }
                string answer = reader.Request("get " + format + " " + cap, Math.Min(PerFormatMs, left()));
                if (answer == null)
                {
                    Wire.Log("saving the clipboard: reading a format overran (its owner is slow to render); not pasting");
                    return null;
                }
                string[] parts = answer.Split(' ');
                if (parts.Length < 3 || parts[0] == "busy")
                {
                    Wire.Log("saving the clipboard: it could not be opened again; not pasting");
                    return null;
                }
                if (uint.Parse(parts[2]) != sequence)
                {
                    Wire.Log("saving the clipboard: it changed while being saved; not pasting");
                    return null;
                }
                if (parts[0] == "data" && parts.Length == 4)
                {
                    byte[] bytes = Convert.FromBase64String(parts[3]);
                    total += bytes.Length;
                    saved.items.Add(new KeyValuePair<uint, byte[]>(format, bytes));
                }
                else if (parts[0] == "emf" && parts.Length == 4)
                {
                    byte[] bits = Convert.FromBase64String(parts[3]);
                    IntPtr copy = Native.SetEnhMetaFileBits((uint)bits.Length, bits);
                    if (copy == IntPtr.Zero) saved.complete = false;
                    else { saved.metafile = copy; total += bits.Length; }
                }
                else if (marker) saved.forceMarkers = true; // present but unreadable: set conservatively
                else saved.reportedSkip = true; // promised but not rendered, too large, or unreadable: lost
            }
            // Someone copied while the save ran: their copy is the user's clipboard now; never paste over it.
            if (Native.GetClipboardSequenceNumber() != sequence)
            {
                Wire.Log("saving the clipboard: it changed while being saved; not pasting");
                return null;
            }
            return saved;
        }

        /// <summary>The saved formats, for PendingClipboard (registered formats by name, so they re-register).</summary>
        public void WriteTo(System.IO.BinaryWriter writer)
        {
            writer.Write(items.Count);
            foreach (KeyValuePair<uint, byte[]> item in items)
            {
                writer.Write(item.Key);
                writer.Write(item.Key >= 0xC000 ? FormatName(item.Key) : "");
                writer.Write(item.Value.Length);
                writer.Write(item.Value);
            }
            byte[] bits = null;
            if (metafile != IntPtr.Zero)
            {
                uint size = Native.GetEnhMetaFileBits(metafile, 0, null);
                bits = new byte[size];
                if (size == 0 || Native.GetEnhMetaFileBits(metafile, size, bits) != size) bits = null;
            }
            writer.Write(bits != null ? bits.Length : 0);
            if (bits != null) writer.Write(bits);
            writer.Write(forceMarkers);
            // How complete the save was, so a recovery reports what an ordinary restore would.
            writer.Write(complete);
            writer.Write(reportedSkip);
        }

        public static SavedClipboard ReadFrom(System.IO.BinaryReader reader)
        {
            SavedClipboard saved = new SavedClipboard();
            int count = reader.ReadInt32();
            for (int i = 0; i < count; i++)
            {
                uint format = reader.ReadUInt32();
                string name = reader.ReadString();
                byte[] bytes = reader.ReadBytes(reader.ReadInt32());
                if (format >= 0xC000) format = name.Length > 0 ? Native.RegisterClipboardFormat(name) : 0;
                if (format != 0) saved.items.Add(new KeyValuePair<uint, byte[]>(format, bytes));
            }
            int metaLength = reader.ReadInt32();
            if (metaLength > 0)
            {
                byte[] bits = reader.ReadBytes(metaLength);
                saved.metafile = Native.SetEnhMetaFileBits((uint)bits.Length, bits);
                // A metafile that cannot be rebuilt is part of the save that cannot go back: never "restored", never
                // "already on the clipboard" (so such a record is never dropped as untouched).
                if (saved.metafile == IntPtr.Zero) saved.metafileLost = true;
            }
            saved.forceMarkers = reader.ReadBoolean();
            saved.complete = reader.ReadBoolean() && !saved.metafileLost;
            saved.reportedSkip = reader.ReadBoolean();
            return saved;
        }

        /// <summary>Set every saved format on the clipboard, which the caller has open and has emptied.</summary>
        public bool PutBackOpen()
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
                if (failNow || !ClipboardText.SetBytes(item.Key, item.Value)) ok = false;
                set++;
            }
            if (metafile != IntPtr.Zero)
            {
                if (Native.SetClipboardData(CF_ENHMETAFILE, metafile) == IntPtr.Zero) ok = false;
                metafile = IntPtr.Zero;
            }
            // A marker was present but unreadable: keep the content out of history and cloud.
            if (forceMarkers) ClipboardText.SetConservativeMarkers();
            return ok;
        }

        public int Count { get { return items.Count; } }
        /// <summary>How many formats the save kept (an offer shows formats and size only).</summary>
        public int FormatCount { get { return items.Count + (metafile != IntPtr.Zero ? 1 : 0); } }
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
        /// <summary>Every saved format is among the present ones (with MatchesOpenClipboard: the clipboard holds exactly the saved content).</summary>
        public bool AllPresent(IList<uint> present)
        {
            if (metafileLost) return false;
            uint sentinel = Native.RegisterClipboardFormat(PendingClipboard.SentinelFormat);
            foreach (KeyValuePair<uint, byte[]> item in items) if (item.Key != sentinel && !present.Contains(item.Key)) return false;
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
            return false;
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
        public int RestoreOps { get { return items.Count + (metafile != IntPtr.Zero ? 1 : 0) + (forceMarkers ? ClipboardText.MarkerNames.Length : 0); } }
        /// <summary>The clipboard carried a privacy marker: the saved content must never be written to disk.</summary>
        public bool PrivacyMarked;
        /// <summary>This paste's clipboard transaction (PendingClipboard), until it is settled.</summary>
        public PendingRecord Record;

        /// <summary>The transaction is over (restore ran, or nothing was emptied): finish its record once.</summary>
        public void Settle(string restoreResult)
        {
            PendingRecord record = Record;
            Record = null;
            PendingClipboard.Finish(record, restoreResult);
        }

        /// <summary>Tests: a saved clipboard with these items (and a privacy marker or not).</summary>
        internal static SavedClipboard ForTest(IEnumerable<KeyValuePair<uint, byte[]>> items, bool privacyMarked, bool complete = true, bool reportedSkip = false)
        {
            SavedClipboard saved = new SavedClipboard();
            saved.items.AddRange(items);
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
            List<uint> present = new List<uint>();
            for (uint f = Native.EnumClipboardFormats(0); f != 0; f = Native.EnumClipboardFormats(f)) present.Add(f);
            byte[] emf = null;
            if (metafile != IntPtr.Zero)
            {
                uint size = Native.GetEnhMetaFileBits(metafile, 0, null);
                if (size > 0) { emf = new byte[size]; if (Native.GetEnhMetaFileBits(metafile, size, emf) != size) emf = null; }
            }
            return ExplainsPresent(present, delegate (uint f, int cap) { return ClipboardText.ReadBytes(f, cap); }, items, emf, ReadOpenEmf, forceMarkers);
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
        internal static bool ExplainsPresent(IList<uint> present, Func<uint, int, byte[]> read, IList<KeyValuePair<uint, byte[]>> saved, byte[] savedEmf, Func<byte[]> readEmf, bool forcedMarkers = false)
        {
            HashSet<uint> compared = new HashSet<uint>();
            List<uint> rest = new List<uint>();
            foreach (uint f in present)
            {
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
            if (keepRecord && Record != null && Record.Persisted)
            {
                // Put back, but an interruption could not have been proven ours (its stage was not journaled):
                // the record is kept; the next check finds the saved content on the clipboard and drops it.
                PendingRecord record = Record;
                Record = null;
                PendingClipboard.Keep(record);
            }
            else Settle(result);
            return result;
        }

        /// <summary>Under the lock: our window owns the clipboard and our complete write (this transaction's) is on it.</summary>
        bool OurWriteStillThere(ClipboardOwnership ours)
        {
            if (Record == null || Record.DictatedHash == null || ours.Owner == IntPtr.Zero || Native.GetClipboardOwner() != ours.Owner) return false;
            List<uint> present = new List<uint>();
            for (uint f = Native.EnumClipboardFormats(0); f != 0; f = Native.EnumClipboardFormats(f)) present.Add(f);
            return ClipboardText.ClassifyOurWrite(present, delegate (uint f, int cap) { return ClipboardText.ReadBytes(f, cap); }, Record.Id, Record.Nonce, Record.DictatedHash) == OurWrite.Complete;
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

        /// <summary>Keep this transaction's record as an offer: no proof by ownership may apply to it any more.</summary>
        public void KeepAsOffer()
        {
            PendingRecord record = Record;
            Record = null;
            PendingClipboard.ForgetOwnership();
            if (record == null) return;
            if (record.Persisted) PendingClipboard.Keep(record);
            else PendingClipboard.Finish(record, "unrestored");
        }

        /// <summary>Set by RestoreInner when the record must be kept whatever the result (a lost journal).</summary>
        bool keepRecord;

        string RestoreInner(ClipboardOwnership ours)
        {
            Holds = null;
            if (ours == null || !ours.Emptied) return "untouched";
            // Someone else emptied the clipboard right after our write: their copy is newer and wins.
            if (ours.ForeignAtConfirm) return "user-changed";
            if (!ClipboardText.Open())
            {
                Holds = ours.Holds();
                return "unrestored";
            }
            bool ok = true;
            try
            {
                bool provenBySequence = ours.Confirmed ? ours.StillOurs() : ours.OwnerUnchanged();
                if (!provenBySequence && OurWriteStillThere(ours))
                {
                    // A target that reads the synthesized ANSI text formats makes Windows render them, which
                    // moves the sequence (measured: +3). Our window still owning the clipboard with exactly our
                    // write on it (sentinel with this transaction's nonce, our markers, our text) is ours.
                    Wire.Log("the clipboard sequence moved since our write, but our window owns it and our complete write is on it (a target read the synthesized formats): restoring");
                    provenBySequence = true;
                }
                if (!provenBySequence && ours.Owner != IntPtr.Zero && Native.GetClipboardOwner() == ours.Owner)
                {
                    // Our window still owns it, but it is not exactly our write (an app added a format without emptying):
                    // not someone else's newer copy, and not provably ours either: kept, as an offer (never settled).
                    Wire.Log("our window owns the clipboard but our write is not all there: kept as an offer");
                    PendingClipboard.ForgetOwnership();
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
                // Journaled before our EmptyClipboard (with the sequence then: our write), and again right after
                // it under the same lock (the sequence our empty left), so a restore cut short anywhere is
                // provably ours to finish (PendingClipboard.Decide). A restore sets no sentinel: a restored
                // clipboard holds only the user's content.
                // Every journal result is honored: without "restoring" nothing is emptied (kept, retried).
                if (!PendingClipboard.Stage(Record, "restoring", Native.GetClipboardSequenceNumber()))
                {
                    Wire.Log("the restore could not be journaled; nothing emptied (kept for a retry)");
                    Holds = "dictated";
                    return "unrestored";
                }
                int beforeEmpty = TestMode.Int("DICTATION_HELPER_TEST_RESTORE_STALL_BEFORE_EMPTY_MS", 0);
                if (beforeEmpty > 0) Thread.Sleep(beforeEmpty); // test build only: die before the restore empties
                if (TestMode.Env("DICTATION_HELPER_TEST_FAIL_RESTORE_EMPTY") == "1" || !Native.EmptyClipboard())
                {
                    Holds = "dictated";
                    return "unrestored";
                }
                PendingClipboard.NoteEmptied(Record);
                if (!PendingClipboard.Stage(Record, "restore-emptied", Native.GetClipboardSequenceNumber()))
                {
                    // The user's content goes back now (it must not stay off the clipboard), and the record is kept.
                    Wire.Log("the restore's emptied stage could not be journaled: putting back, and keeping the record");
                    keepRecord = true;
                }
                int stall = TestMode.Int("DICTATION_HELPER_TEST_RESTORE_STALL_MS", 0);
                if (stall > 0) Thread.Sleep(stall); // test build only: die in the middle of a restore
                ok = PutBackOpen();
            }
            finally { Native.CloseClipboard(); }
            string result = RestoreResult(ok, complete, reportedSkip);
            if (result == "unrestored") Holds = "unknown";
            // A kept record: the sequence after our close, confirmed with our window still the owner.
            if (result == "unrestored" || keepRecord) PendingClipboard.ConfirmClosed(Record);
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
            if (reportedSkip) return "skipped";
            return complete ? "restored" : "partial";
        }

        /// <summary>The late write's put-back (inside Write), mapped the same way.</summary>
        public string PutBackResult(bool setOk) { return RestoreResult(setOk, complete, reportedSkip); }
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
