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
            Bounded.Outcome validated = Bounded.Call(token => Validate(snapshot, guards, token), ValidateBudgetMs, out v);
            if (validated == Bounded.Outcome.Busy) return new DeliveryResult(DeliveryOutcome.Refused, "helper-busy");
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
            if (!forceType)
            {
                if (deadlineMs == 0 || elapsed() + PasteEstimateMs <= deadlineMs)
                {
                    DeliveryResult pasted = Paste(text, current, snapshot, before, timings, out clipboardAfterPaste, out holdsAfterPaste);
                    if (pasted != null) return pasted;
                }
            }
            if (deadlineMs > 0 && elapsed() + TypeEstimateMs(text) > deadlineMs)
            {
                DeliveryResult late = new DeliveryResult(DeliveryOutcome.Refused, "deadline-exceeded");
                late.Clipboard = clipboardAfterPaste;
                late.ClipboardHolds = holdsAfterPaste;
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
            return typed;
        }

        /// <summary>
        /// Null when the clipboard could not be used (nothing was pasted; the typing fallback may run).
        /// `clipboardAfterFailedWrite` (and `holdsAfterFailedWrite` for "unrestored") report what
        /// happened to the user's clipboard in that case.
        /// </summary>
        static DeliveryResult Paste(string text, AutomationElement element, TargetSnapshot snapshot, ControlState before, DeliveryTimings timings, out string clipboardAfterFailedWrite, out string holdsAfterFailedWrite)
        {
            clipboardAfterFailedWrite = "untouched";
            holdsAfterFailedWrite = null;
            Stopwatch insert = Stopwatch.StartNew();
            // Saving the user's clipboard renders lazily-provided formats (OLE "Embed Source" and the
            // like), which can take arbitrarily long; it runs in the reader process, bounded per format.
            SavedClipboard saved = SavedClipboard.CaptureBounded(CaptureBudgetMs);
            if (saved == null) return null;
            ClipboardOwnership ours;
            if (!ClipboardText.Write(text, out ours, saved.Sequence))
            {
                // The write failed part-way. If we emptied the clipboard, the user's content is gone
                // from it unless we put it back now (before any typing fallback): ownership comes from
                // having emptied it, not from the text landing, so an owned partial write is restored.
                if (ours.Emptied)
                {
                    clipboardAfterFailedWrite = saved.Restore(ours);
                    holdsAfterFailedWrite = saved.Holds;
                }
                return null;
            }
            // Immediately before Ctrl+V, the same strict check the typing path makes: anything that
            // cannot be read (identity, password state) refuses; nothing is pasted on a guess.
            string unsafeReason = ReleaseModifiers() ? PasteGuard(snapshot) : "focus-changed";
            if (unsafeReason != null)
            {
                DeliveryResult moved = new DeliveryResult(DeliveryOutcome.Refused, unsafeReason);
                moved.Method = "paste";
                moved.Clipboard = saved.Restore(ours);
                moved.ClipboardHolds = saved.Holds;
                return moved;
            }
            // The clipboard must still be our write, or Ctrl+V would paste someone else's content
            // (another app copied between our write and now). Nothing is pasted then, and their newer
            // copy is left alone; the typing fallback may still run.
            if (!ours.LooksOurs())
            {
                Wire.Log("the clipboard changed hands before Ctrl+V; not pasting");
                clipboardAfterFailedWrite = "user-changed";
                return null;
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
        /// Before the Ctrl+V keystroke: the foreground app and focused control are still the snapshot's,
        /// the focused window is not an ES_PASSWORD edit, and (one bounded UIA call) the control is
        /// still focused and its IsPassword reads false. Unreadable or slow → target-unverifiable.
        /// </summary>
        static string PasteGuard(TargetSnapshot snapshot)
        {
            string win32 = Win32Guard(snapshot);
            if (win32 != null) return win32;
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

        /// <summary>Foreground process, focused window identity (Win32 targets) and ES_PASSWORD; no provider call.</summary>
        static string Win32Guard(TargetSnapshot snapshot)
        {
            IntPtr foreground = Native.GetForegroundWindow();
            if (foreground == IntPtr.Zero) return "focus-changed";
            uint pid;
            uint thread = Native.GetWindowThreadProcessId(foreground, out pid);
            if (pid != snapshot.Pid) return "focus-changed";
            Native.GUITHREADINFO gui = Target.GuiInfo(thread);
            if (Target.IsPasswordEdit(gui.hwndFocus)) return "secure-field";
            if (snapshot.Element == null && (snapshot.FocusWindow == IntPtr.Zero || gui.hwndFocus != snapshot.FocusWindow)) return "focus-changed";
            return null;
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
        /// (every UIA-only app: browsers, Electron, Firefox, Java, Qt, XAML/UWP, Office), or when the
        /// pre-flight probe (text length, selection, ES_PASSWORD) does not answer in time. Then, for
        /// EVERY key: the foreground app and focused window are still the snapshot's, ES_PASSWORD is
        /// still clear (fresh GetWindowLong), the field still has the length the previous key left
        /// (nothing else changed it), and after the key the length moves by exactly the units the key
        /// adds minus the selection it replaces. Anything else stops typing at once (uncertain), with
        /// the reason, the number of keys confirmed, and whether one key was sent but not confirmed.
        /// </summary>
        static DeliveryResult TypeText(string text, TargetSnapshot snapshot, DeliveryTimings timings, int deadlineMs, Func<long> elapsed, BoundedStats stats)
        {
            Stopwatch insert = Stopwatch.StartNew();
            string normalized = text.Replace("\r\n", "\n");
            string refusal = null;
            IntPtr focusWindow = FocusWindow();
            // Without a focused window there is nothing to read per keystroke: refuse, never guess.
            if (focusWindow == IntPtr.Zero) refusal = "target-unverifiable";
            else if (snapshot.FocusWindow == IntPtr.Zero || focusWindow != snapshot.FocusWindow) refusal = "focus-changed";
            ClassicTextBox box = null;
            if (refusal == null) box = ClassicTextBox.Probe(focusWindow, out refusal);
            // A single-line box ignores Enter (or presses its dialog's default button).
            if (refusal == null && normalized.IndexOf('\n') >= 0 && !box.Multiline) refusal = "typing-unsupported";
            if (refusal == null && !ReleaseModifiers()) refusal = "focus-changed";
            if (refusal == null) refusal = TypingGuard(snapshot, box);
            long confirmed = refusal == null ? box.Length() : -1;
            if (refusal == null && confirmed < 0) refusal = "target-unverifiable";
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
                string unsafeReason = TypingGuard(snapshot, box);
                // Nothing may have changed the field since the previous key was confirmed.
                long now = unsafeReason == null ? box.Length() : -1;
                if (unsafeReason == null && now < 0) { unsafeReason = "target-unverifiable"; Wire.Log("typing: the field did not answer its length"); }
                else if (unsafeReason == null && now != confirmed) { unsafeReason = "target-changed"; Wire.Log("typing: the field changed between keys (" + confirmed + " -> " + now + ")"); }
                int selection = unsafeReason == null ? box.SelectionLength() : 0;
                if (unsafeReason == null && selection < 0) { unsafeReason = "target-unverifiable"; Wire.Log("typing: the selection could not be read: " + box.LastSelectionError); }
                guardStats.Add((Stopwatch.GetTimestamp() - guardStart) * 1000.0 / Stopwatch.Frequency);
                if (unsafeReason != null) { abortReason = unsafeReason; break; }
                if (deadlineMs > 0 && elapsed() > deadlineMs) { abortReason = "deadline-exceeded"; break; }
                // A target that processes keys slowly (but observably) would run past the deadline
                // part-way through: once the rate is known from at least 10 keys, stop at once if the
                // rest cannot finish in time, rather than typing most of the text and stopping late.
                if (deadlineMs > 0 && rate != null && charsTyped >= 10)
                {
                    double perChar = rate.ElapsedMilliseconds / (double)charsTyped;
                    if (elapsed() + perChar * (normalized.Length - i) > deadlineMs) { abortReason = "deadline-exceeded"; break; }
                }
                char unit = normalized[i];
                Native.INPUT[] pair;
                int start = i;
                int units;
                if (unit == '\n')
                {
                    pair = new[] { Native.Key(Native.VK_RETURN, false, false), Native.Key(Native.VK_RETURN, true, false) };
                    units = 2; // a multiline Edit or RichEdit stores CR LF (measured on Dev04 for all four classes)
                }
                else if (char.IsHighSurrogate(unit) && i + 1 < normalized.Length)
                {
                    // A surrogate pair goes as one call, so the character is never split.
                    char low = normalized[++i];
                    pair = new[] { Native.Unicode(unit, false), Native.Unicode(low, false), Native.Unicode(unit, true), Native.Unicode(low, true) };
                    units = 2;
                }
                else
                {
                    pair = new[] { Native.Unicode(unit, false), Native.Unicode(unit, true) };
                    units = 1;
                }
                long expected = confirmed + units - selection;
                // A key that would leave the length unchanged (it replaces a selection of its own size)
                // could not be told apart from a key that was never processed.
                if (expected == confirmed) { abortReason = "target-unverifiable"; Wire.Log("typing: a key replacing a selection of its own size cannot be confirmed"); break; }
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
                bool processed = box.WaitLength(confirmed, expected, KeySettleMs, out seen);
                settleStats.Add((Stopwatch.GetTimestamp() - settleStart) * 1000.0 / Stopwatch.Frequency);
                if (!processed)
                {
                    unconfirmed = true;
                    abortReason = seen >= 0 && seen != confirmed ? "target-changed" : "target-unconfirmed";
                    break;
                }
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
            // Every key was confirmed one by one; a last quiet look makes sure nothing (an autocomplete
            // after the final key) changed the field afterwards.
            Thread.Sleep(60);
            long final = box.Length();
            timings.ConfirmMs += Ms(confirm);
            bool verified = final == confirmed && !box.Secure;
            DeliveryResult result = stamp(verified
                ? new DeliveryResult(DeliveryOutcome.Delivered, null)
                : new DeliveryResult(DeliveryOutcome.Uncertain, final < 0 ? "target-unconfirmed" : "target-changed"));
            result.Verified = verified;
            return result;
        }

        /// <summary>
        /// The check before each typed key, with no provider call: the foreground process is the
        /// snapshot's, its focused window is the very text box being typed into, and that box is not a
        /// password box (ES_PASSWORD read fresh).
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
            if (box.Secure || Target.IsPasswordEdit(gui.hwndFocus)) return "secure-field";
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

        /// <summary>
        /// Put text on the clipboard, marked so clipboard history and sync skip it, and record what
        /// makes the clipboard provably ours afterwards (see ClipboardOwnership). `ownership.Emptied`
        /// is set as soon as EmptyClipboard succeeds, even if the text could not be set, so the caller
        /// can still put the user's content back.
        /// </summary>
        public static bool Write(string text, out ClipboardOwnership ownership, uint expectSequence = 0)
        {
            ownership = new ClipboardOwnership();
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
                if (Native.EmptyClipboard())
                {
                    ownership.Emptied = true;
                    // Test build only: simulate SetClipboardData failing after the clipboard was emptied.
                    ok = TestMode.Env("DICTATION_HELPER_TEST_FAIL_SET") != "1"
                        && SetBytes(CF_UNICODETEXT, System.Text.Encoding.Unicode.GetBytes(text + "\0"));
                    // Windows' own clipboard history and cloud clipboard, and clipboard
                    // managers that honor it, leave entries with these formats alone.
                    SetConservativeMarkers();
                    // Sampled INSIDE the same open/close as our SetClipboardData: nobody else can
                    // write while we hold the clipboard.
                    ownership.SequenceInside = Native.GetClipboardSequenceNumber();
                }
            }
            finally { Native.CloseClipboard(); }
            if (ownership.Emptied) ownership.Confirm();
            return ok;
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
            SequenceUnlocked = Native.GetClipboardSequenceNumber();
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
        /// Wall-clock bound for reading one format (a render that takes longer ends the save). Each read
        /// is also bounded by what is left of the whole save's budget, so the clipboard is never held by
        /// the reader for longer than that budget (1.5 s): a user's copy meanwhile waits at most that.
        /// </summary>
        const int PerFormatMs = 1500;

        /// <summary>
        /// Save the clipboard through the reader process (ClipboardReader), one bounded request per
        /// format, within timeoutMs in total. The clipboard is open only inside each request, never
        /// across the helper's own work, and a read that overruns (an owner slow to render) ends the
        /// reader, which releases the clipboard at once. Null, and nothing is pasted, when the save
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
                else if (Markers.Contains(name)) { marker = true; cap = MaxMarkerBytes; }
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

        public int Count { get { return items.Count; } }
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
                if (ours.Confirmed)
                {
                    // Proven ownership: a different owner or sequence is a newer copy by someone else,
                    // which wins (no warning; nothing of the user's was lost to us).
                    if (!ours.StillOurs()) return "user-changed";
                }
                else if (!ours.OwnerUnchanged())
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
                if (TestMode.Env("DICTATION_HELPER_TEST_FAIL_RESTORE_EMPTY") == "1" || !Native.EmptyClipboard())
                {
                    Holds = "dictated";
                    return "unrestored";
                }
                foreach (KeyValuePair<uint, byte[]> item in items)
                    if (!ClipboardText.SetBytes(item.Key, item.Value)) ok = false;
                if (metafile != IntPtr.Zero)
                {
                    if (Native.SetClipboardData(CF_ENHMETAFILE, metafile) == IntPtr.Zero) ok = false;
                    metafile = IntPtr.Zero;
                }
                // A marker was present but unreadable: keep the content out of history and cloud.
                if (forceMarkers) ClipboardText.SetConservativeMarkers();
            }
            finally { Native.CloseClipboard(); }
            if (reportedSkip) return "skipped";
            return ok && complete ? "restored" : "partial";
        }
    }
}
