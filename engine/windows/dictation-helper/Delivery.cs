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
        /// untouched | restored | user-changed | partial | skipped | unrestored. unrestored: the
        /// clipboard could not be emptied to put the user's content back, so it still holds the
        /// dictated text.
        /// </summary>
        public string Clipboard = "untouched";
        public DeliveryTimings Timings;
        /// <summary>Characters typed before a mid-type abort; -1 when not applicable.</summary>
        public int CharsDelivered = -1;
        /// <summary>Per-keystroke safety-check timing while typing (null for a paste).</summary>
        public GuardStats Guard;
        /// <summary>Per-keystroke wait for the target to process the key while typing (null for a paste).</summary>
        public GuardStats Settle;
        /// <summary>The slowest single provider (UIA) call during the delivery, in ms (diagnostics).</summary>
        public double ProviderSlowestMs = -1;

        public DeliveryResult(DeliveryOutcome outcome, string reason) { Outcome = outcome; Reason = reason; }

        public Dictionary<string, object> Fields()
        {
            Dictionary<string, object> output = Wire.Fields("outcome", Outcome.ToString().ToLowerInvariant(), "verified", Verified, "clipboard", Clipboard);
            if (Reason != null) output["reason"] = Reason;
            if (Method != null) output["method"] = Method;
            if (Timings != null) output["timings"] = Timings.Fields();
            if (CharsDelivered >= 0) output["charsDelivered"] = CharsDelivered;
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
            DeliveryResult result = DeliverInner(snapshot, text, guards, timings, deadlineMs, alreadyElapsedMs);
            result.Timings = timings;
            return result;
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
        /// </summary>
        static Validation Validate(TargetSnapshot snapshot, DeliveryGuards guards)
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
                if (value == null || TextLocator.UniqueIndex(guards.Replace, value) < 0 || !UIA.SelectText(current, guards.Replace))
                { v.Refusal = "text-changed"; return v; }
            }
            v.Current = current;
            v.Before = ControlState.Read(current);
            return v;
        }

        static DeliveryResult DeliverInner(TargetSnapshot snapshot, string text, DeliveryGuards guards, DeliveryTimings timings, int deadlineMs, int alreadyElapsedMs)
        {
            // The deadline is measured from when the request was received, not from here: a
            // deliver stuck behind a slow UIA call must not begin after the app gave up.
            Stopwatch began = Stopwatch.StartNew();
            Func<long> elapsed = () => began.ElapsedMilliseconds + alreadyElapsedMs;
            if (!snapshot.HasElement || snapshot.Facts == null) return new DeliveryResult(DeliveryOutcome.Refused, "no-target");
            Validation v;
            if (!Bounded.Run(() => Validate(snapshot, guards), ValidateBudgetMs, out v))
                return new DeliveryResult(DeliveryOutcome.Refused, "target-unverifiable");
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
            string clipboardAfterPaste = "untouched";
            if (!forceType)
            {
                if (deadlineMs == 0 || elapsed() + PasteEstimateMs <= deadlineMs)
                {
                    DeliveryResult pasted = Paste(text, current, snapshot, before, timings, out clipboardAfterPaste);
                    if (pasted != null) return pasted;
                }
            }
            if (deadlineMs > 0 && elapsed() + TypeEstimateMs(text) > deadlineMs)
            {
                DeliveryResult late = new DeliveryResult(DeliveryOutcome.Refused, "deadline-exceeded");
                late.Clipboard = clipboardAfterPaste;
                return late;
            }
            DeliveryResult typed = TypeText(text, current, snapshot, before, timings, deadlineMs, elapsed);
            if (typed.Clipboard == "untouched") typed.Clipboard = clipboardAfterPaste;
            return typed;
        }

        /// <summary>
        /// Null when the clipboard could not be used (nothing was pasted; the typing fallback may run).
        /// `clipboardAfterFailedWrite` reports what happened to the user's clipboard in that case.
        /// </summary>
        static DeliveryResult Paste(string text, AutomationElement element, TargetSnapshot snapshot, ControlState before, DeliveryTimings timings, out string clipboardAfterFailedWrite)
        {
            clipboardAfterFailedWrite = "untouched";
            Stopwatch insert = Stopwatch.StartNew();
            // Saving the user's clipboard renders lazily-provided formats (OLE "Embed Source" and the
            // like), which can take arbitrarily long; it runs on its own thread with a wall-clock bound.
            SavedClipboard saved = SavedClipboard.CaptureBounded(CaptureBudgetMs);
            if (saved == null) return null;
            ClipboardOwnership ours;
            if (!ClipboardText.Write(text, out ours))
            {
                // The write failed part-way. If we emptied the clipboard, the user's content is gone
                // from it unless we put it back now (before any typing fallback): ownership comes from
                // having emptied it, not from the text landing, so an owned partial write is restored.
                if (ours.Emptied) clipboardAfterFailedWrite = saved.Restore(ours);
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
            if (!Bounded.Run(delegate
            {
                AutomationElement current;
                if (!Target.StillFocused(snapshot, out current)) return "focus-changed";
                bool? secure = UIA.TryIsPassword(snapshot.Element);
                if (secure == null) return "target-unverifiable";
                return secure.Value ? "secure-field" : null;
            }, GuardBudgetMs, out reason)) return "target-unverifiable";
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
        /// Chromium and Electron windows publish their accessibility tree to UI Automation
        /// asynchronously, so a keystroke's effect (a field turning into a password field, focus moving)
        /// cannot be observed before the next key. The typing fallback is refused there: the paste path
        /// handles these apps; when it cannot, the text is kept for copying.
        /// </summary>
        internal static bool IsChromiumClass(IntPtr window)
        {
            for (IntPtr w = window; w != IntPtr.Zero; w = Native.GetParent(w))
            {
                string name = Native.ClassOf(w);
                if (name == "Chrome_RenderWidgetHostHWND" || name == "Chrome_WidgetWin_1" || name == "Chrome_WidgetWin_0") return true;
            }
            return false;
        }

        static DeliveryResult TypeText(string text, AutomationElement element, TargetSnapshot snapshot, ControlState before, DeliveryTimings timings, int deadlineMs, Func<long> elapsed)
        {
            Stopwatch insert = Stopwatch.StartNew();
            string refusal = null;
            if (!ReleaseModifiers()) refusal = "focus-changed";
            IntPtr focusWindow = FocusWindow();
            if (refusal == null && IsChromiumClass(focusWindow) && TestMode.Env("DICTATION_HELPER_TEST_ALLOW_CHROMIUM_TYPING") != "1")
                refusal = "typing-unsupported";
            // A UIA target must have an identity to compare against.
            if (refusal == null && snapshot.Element != null && snapshot.RuntimeId == null) refusal = "target-unverifiable";
            // Every keystroke must be observed as processed before the next one; a target whose
            // processing cannot be observed is refused up front rather than typed into blindly.
            KeystrokeObserver observer = null;
            if (refusal == null)
            {
                observer = KeystrokeObserver.For(snapshot, focusWindow);
                if (observer == null) refusal = "typing-unobservable";
            }
            if (refusal != null)
            {
                DeliveryResult refused = new DeliveryResult(DeliveryOutcome.Refused, refusal);
                refused.Method = "type";
                return refused;
            }
            // One character per call with a short gap: text controls built on XAML and the
            // Text Services Framework drop Unicode keystrokes that arrive in a burst.
            string normalized = text.Replace("\r\n", "\n");
            GuardStats guardStats = new GuardStats();
            GuardStats settleStats = new GuardStats();
            int expected = 0;
            uint sent = 0;
            int charsTyped = 0;
            bool aborted = false;
            string abortReason = null;
            double slowestBefore = Bounded.SlowestMs;
            using (observer)
            {
                for (int i = 0; i < normalized.Length; i++)
                {
                    // Immediately before EVERY keystroke: foreground app, focused control identity and a
                    // FRESH secure-state read, all within GuardBudgetMs of wall clock. Any failure, or
                    // anything it cannot read in time, stops typing; not one more keystroke is sent.
                    long guardStart = Stopwatch.GetTimestamp();
                    string unsafeReason = KeystrokeGuard(snapshot);
                    guardStats.Add((Stopwatch.GetTimestamp() - guardStart) * 1000.0 / Stopwatch.Frequency);
                    if (unsafeReason != null) { aborted = true; abortReason = unsafeReason; break; }
                    if (deadlineMs > 0 && elapsed() > deadlineMs) { aborted = true; abortReason = "deadline-exceeded"; break; }
                    // A target that processes keys slowly (but observably) would run past the deadline
                    // part-way through: once its rate is known (3 keys), stop at once if the rest cannot
                    // finish in time, rather than typing most of the text and stopping late.
                    if (deadlineMs > 0 && charsTyped >= 3)
                    {
                        double perChar = insert.ElapsedMilliseconds / (double)charsTyped;
                        if (elapsed() + perChar * (normalized.Length - i) > deadlineMs) { aborted = true; abortReason = "deadline-exceeded"; break; }
                    }
                    char unit = normalized[i];
                    Native.INPUT[] pair;
                    int start = i;
                    if (unit == '\n') pair = new[] { Native.Key(Native.VK_RETURN, false, false), Native.Key(Native.VK_RETURN, true, false) };
                    else if (char.IsHighSurrogate(unit) && i + 1 < normalized.Length)
                    {
                        // A surrogate pair goes as one call, so the character is never split.
                        char low = normalized[++i];
                        pair = new[] { Native.Unicode(unit, false), Native.Unicode(low, false), Native.Unicode(unit, true), Native.Unicode(low, true) };
                    }
                    else pair = new[] { Native.Unicode(unit, false), Native.Unicode(unit, true) };
                    long mark = observer.Mark();
                    expected += pair.Length;
                    uint count = Native.Send(pair);
                    sent += count;
                    if (count != pair.Length) break;
                    charsTyped = i + 1;
                    // The key counts as processed only when the target shows it (its text length moved,
                    // or a text/value event arrived for it) within KeySettleMs. Without that the next
                    // guard could read state from before this key: stop instead (uncertain).
                    long settleStart = Stopwatch.GetTimestamp();
                    bool secureNow;
                    bool processed = observer.WaitProcessed(mark, KeySettleMs, out secureNow);
                    settleStats.Add((Stopwatch.GetTimestamp() - settleStart) * 1000.0 / Stopwatch.Frequency);
                    if (secureNow) { aborted = true; abortReason = "secure-field"; break; }
                    if (!processed) { aborted = true; abortReason = "target-unconfirmed"; break; }
                    // Word boundaries are where editors run spelling and suggestions; keystrokes
                    // that arrive meanwhile were seen to be dropped (Windows 11 Notepad).
                    Thread.Sleep(char.IsWhiteSpace(normalized[start]) || char.IsPunctuation(normalized[start]) ? 70 : 8);
                }
            }
            timings.InsertMs += Ms(insert);
            Func<DeliveryResult, DeliveryResult> stamp = delegate (DeliveryResult r)
            {
                r.Method = "type";
                r.CharsDelivered = charsTyped;
                r.Guard = guardStats;
                r.Settle = settleStats;
                r.ProviderSlowestMs = Math.Max(Bounded.SlowestMs, slowestBefore);
                return r;
            };
            if (aborted)
            {
                // Stopped mid-type: some characters may already be in, so the host keeps the text and
                // must not resend.
                return stamp(new DeliveryResult(sent == 0 ? DeliveryOutcome.Refused : DeliveryOutcome.Uncertain, sent == 0 ? abortReason : "insertion-unverifiable"));
            }
            if (sent == 0) return stamp(new DeliveryResult(DeliveryOutcome.Failed, "keystroke-unavailable"));
            if (sent != expected) return stamp(new DeliveryResult(DeliveryOutcome.Uncertain, "insertion-unverifiable"));
            Stopwatch confirm = Stopwatch.StartNew();
            // Keystrokes arrive one by one: wait for the field to change and then to settle,
            // so the reply (and the clipboard of a later paste) never races the last characters.
            bool verified = before.Observable && Changed(element, before, 800 + 4 * normalized.Length) && Settled(element, 150, 2000 + 4 * normalized.Length);
            // Keystrokes can be dropped one by one, so a change is not enough: the whole text must be there.
            if (verified)
            {
                ControlState after = ControlState.TryRead(element, ReadBudgetMs);
                verified = after != null && (after.Value == null || after.Value.Replace("\r\n", "\n").Replace('\r', '\n').Contains(normalized));
            }
            timings.ConfirmMs += Ms(confirm);
            DeliveryResult result = stamp(verified
                ? new DeliveryResult(DeliveryOutcome.Delivered, null)
                : new DeliveryResult(DeliveryOutcome.Uncertain, "insertion-unverifiable"));
            result.Verified = verified;
            return result;
        }

        /// <summary>
        /// The safety check run immediately before each typed keystroke. Null when it is safe to send
        /// the next key; otherwise the refusal reason. The Win32 part (foreground process, ES_PASSWORD)
        /// makes no provider call; the UIA part (the focused element's RuntimeId, process and IsPassword,
        /// and a fresh IsPassword on the snapshot's element) runs as ONE bounded call: a missing identity,
        /// an unreadable secure state or a call slower than GuardBudgetMs is target-unverifiable.
        /// </summary>
        static string KeystrokeGuard(TargetSnapshot snapshot)
        {
            string win32 = Win32Guard(snapshot);
            if (win32 != null) return win32;
            if (snapshot.Element == null) return null;
            string reason;
            if (!Bounded.Run(delegate
            {
                AutomationElement focused = UIA.Focused();
                string rid = UIA.RuntimeId(focused);
                bool? focusedSecure = UIA.TryIsPassword(focused);
                int owner = focused != null ? UIA.Pid(focused) : 0;
                if (rid == null || focusedSecure == null) return "target-unverifiable";
                if (focusedSecure.Value) return "secure-field";
                if (owner != (int)snapshot.Pid || rid != snapshot.RuntimeId) return "focus-changed";
                bool? secure = UIA.TryIsPassword(snapshot.Element);
                if (secure == null) return "target-unverifiable";
                return secure.Value ? "secure-field" : null;
            }, GuardBudgetMs, out reason)) return "target-unverifiable";
            return reason;
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

        /// <summary>True once the control has read the same for quietMs (false if it never settles in time, or cannot be read).</summary>
        static bool Settled(AutomationElement element, int quietMs, int withinMs)
        {
            Stopwatch watch = Stopwatch.StartNew();
            ControlState last = ControlState.TryRead(element, ReadBudgetMs);
            if (last == null) return false;
            Stopwatch quiet = Stopwatch.StartNew();
            while (watch.ElapsedMilliseconds < withinMs)
            {
                Thread.Sleep(15);
                ControlState now = ControlState.TryRead(element, ReadBudgetMs);
                if (now == null) return false;
                if (!now.SameAs(last))
                {
                    last = now;
                    quiet.Restart();
                }
                else if (quiet.ElapsedMilliseconds >= quietMs) return true;
            }
            return false;
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
        public static bool Write(string text, out ClipboardOwnership ownership)
        {
            ownership = new ClipboardOwnership();
            if (!Open()) return false;
            bool ok = false;
            try
            {
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
        public IntPtr Owner;
        /// <summary>Confirm() proved the clipboard was ours after our write was finalized.</summary>
        public bool Confirmed;

        public void Confirm()
        {
            IntPtr window = Ui.ClipboardWindow;
            Owner = window;
            // Test build only: simulate another reader holding the clipboard through the confirmation.
            if (TestMode.Env("DICTATION_HELPER_TEST_SKIP_CONFIRM") == "1") return;
            if (window == IntPtr.Zero || !ClipboardText.Open()) return;
            try
            {
                if (Native.GetClipboardOwner() != window) return;
                uint now = Native.GetClipboardSequenceNumber();
                if (now < SequenceInside) return;
                SequenceFinal = now;
                Owner = window;
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
        /// Under the clipboard lock, when Confirm() could not run (another reader held the clipboard):
        /// our window is still the owner, i.e. nobody has emptied the clipboard since our write.
        /// </summary>
        public bool OwnerUnchanged()
        {
            return Owner != IntPtr.Zero && Native.GetClipboardOwner() == Owner;
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
        /// <summary>At most this long is spent copying the clipboard.</summary>
        const int MaxMs = 300;
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

        static byte[] ReadBytes(IntPtr data, int cap = int.MaxValue)
        {
            long size = (long)Native.GlobalSize(data).ToUInt64();
            if (size <= 0 || size > cap) return null;
            IntPtr source = Native.GlobalLock(data);
            if (source == IntPtr.Zero) return null;
            byte[] bytes = new byte[(int)size];
            Marshal.Copy(source, bytes, 0, (int)size);
            Native.GlobalUnlock(data);
            return bytes;
        }

        static string FormatName(uint format)
        {
            System.Text.StringBuilder name = new System.Text.StringBuilder(256);
            int length = Native.GetClipboardFormatName(format, name, name.Capacity);
            return length > 0 ? name.ToString(0, length) : "";
        }

        /// <summary>
        /// Formats an OLE source renders on demand (it may start or wake the source app): read after
        /// every other format, so a slow render costs only itself and runs last under the time cap.
        /// </summary>
        static readonly string[] RenderedLast =
        {
            "embed source", "embedded object", "link source", "link source descriptor", "object descriptor",
            "native", "ownerlink", "objectlink"
        };

        /// <summary>
        /// Capture on a dedicated thread, waiting at most timeoutMs of wall clock: an owner that takes
        /// long to render a lazily provided format (OLE "Embed Source") cannot stall the delivery. Null
        /// when the clipboard cannot be opened or saving it did not finish in time; nothing is pasted
        /// then (the user's clipboard would not come back), and the capture thread closes the
        /// clipboard when the owner finally answers.
        /// </summary>
        public static SavedClipboard CaptureBounded(int timeoutMs)
        {
            SavedClipboard result = null;
            Thread thread = new Thread(delegate () { result = Capture(); });
            thread.IsBackground = true;
            thread.Name = "dictation-clipboard-capture";
            thread.SetApartmentState(ApartmentState.STA);
            thread.Start();
            if (!thread.Join(timeoutMs))
            {
                Wire.Log("saving the clipboard took too long (a source app is rendering its content); not pasting");
                return null;
            }
            return result;
        }

        /// <summary>Null when the clipboard cannot be opened.</summary>
        public static SavedClipboard Capture()
        {
            if (!ClipboardText.Open()) return null;
            SavedClipboard saved = new SavedClipboard();
            Stopwatch watch = Stopwatch.StartNew();
            int total = 0;
            try
            {
                bool hasDib = Native.IsClipboardFormatAvailable(CF_DIB) || Native.IsClipboardFormatAvailable(CF_DIBV5);
                List<uint> formats = new List<uint>();
                List<uint> renderedLast = new List<uint>();
                for (uint format = Native.EnumClipboardFormats(0); format != 0; format = Native.EnumClipboardFormats(format))
                {
                    if (format >= 0xC000 && Array.IndexOf(RenderedLast, FormatName(format).ToLowerInvariant()) >= 0) renderedLast.Add(format);
                    else formats.Add(format);
                }
                formats.AddRange(renderedLast);
                int captureDelay = TestMode.Int("DICTATION_HELPER_TEST_CAPTURE_DELAY_MS", 0);
                if (captureDelay > 0) Thread.Sleep(captureDelay);
                foreach (uint format in formats)
                {
                    // Deciding which formats are user-visible is cheap; only safe ones are read below.
                    bool safe;
                    if (format == CF_BITMAP || format == CF_PALETTE)
                    {
                        // Windows rebuilds these from the device-independent bitmap.
                        if (!hasDib) saved.complete = false;
                        continue;
                    }
                    if (format == CF_ENHMETAFILE)
                    {
                        // Route the metafile through the caps too (it is user-visible content).
                        if (watch.ElapsedMilliseconds > MaxMs) { saved.reportedSkip = true; continue; }
                        IntPtr handle = Native.GetClipboardData(format);
                        uint emfSize = handle != IntPtr.Zero ? Native.GetEnhMetaFileBits(handle, 0, null) : 0;
                        if (handle == IntPtr.Zero) { saved.complete = false; continue; }
                        if (emfSize == 0 || emfSize > MaxFormatBytes || total + emfSize > MaxBytes) { saved.reportedSkip = true; continue; }
                        saved.metafile = Native.CopyEnhMetaFile(handle, IntPtr.Zero);
                        if (saved.metafile == IntPtr.Zero) saved.complete = false;
                        else total += (int)emfSize;
                        continue;
                    }
                    if (format < 0xC000) safe = SafeStandard.Contains(format);
                    else
                    {
                        string name = FormatName(format);
                        // Privacy markers (exclude-from-history / cloud): preserve their presence and
                        // value, so restoring a password manager's entry cannot republish it into
                        // clipboard history or cloud sync. Unreadable or oversized → set conservatively.
                        if (Markers.Contains(name))
                        {
                            IntPtr markerData = Native.GetClipboardData(format);
                            byte[] markerBytes = markerData != IntPtr.Zero ? ReadBytes(markerData, MaxMarkerBytes) : null;
                            if (markerBytes != null) saved.items.Add(new KeyValuePair<uint, byte[]>(format, markerBytes));
                            else saved.forceMarkers = true;
                            continue;
                        }
                        // OLE live-object bookkeeping is dropped silently (expected, not a loss).
                        if (SilentDrop.Contains(name)) continue;
                        // Every other registered format is the app's user-visible content: preserve it.
                        safe = true;
                    }
                    if (!safe)
                    {
                        // CF_METAFILEPICT is synthesized by Windows from a saved enhanced metafile;
                        // any other standard format we cannot replay (GDI handles, private/display
                        // formats) is a real loss and is reported, never dropped silently.
                        bool synthesized = format == CF_METAFILEPICT && Native.IsClipboardFormatAvailable(CF_ENHMETAFILE);
                        if (!synthesized) saved.reportedSkip = true;
                        continue;
                    }
                    // Reading a user-visible format renders delayed ones; cap total time so one huge
                    // read cannot stall the delivery, and report the drop as a visible loss.
                    if (watch.ElapsedMilliseconds > MaxMs) { saved.reportedSkip = true; continue; }
                    IntPtr data = Native.GetClipboardData(format);
                    if (data == IntPtr.Zero)
                    {
                        saved.reportedSkip = true; // promised content the owner did not render: lost
                        continue;
                    }
                    long size = (long)Native.GlobalSize(data).ToUInt64();
                    // Oversized: skip without copying the bytes, so a large Excel/Photoshop clipboard
                    // cannot blow the budget; the user is told a visible format was not kept.
                    if (size <= 0 || size > MaxFormatBytes || total + size > MaxBytes) { saved.reportedSkip = true; continue; }
                    IntPtr source = Native.GlobalLock(data);
                    if (source == IntPtr.Zero)
                    {
                        saved.reportedSkip = true; // not global memory (or unreadable): cannot be kept
                        continue;
                    }
                    byte[] bytes = new byte[(int)size];
                    Marshal.Copy(source, bytes, 0, (int)size);
                    Native.GlobalUnlock(data);
                    total += (int)size;
                    saved.items.Add(new KeyValuePair<uint, byte[]>(format, bytes));
                }
            }
            finally { Native.CloseClipboard(); }
            return saved;
        }

        public int Count { get { return items.Count; } }
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
            if (ours == null || !ours.Emptied) return "untouched";
            if (!ClipboardText.Open()) return "unrestored";
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
                    // Ownership was never confirmed (the clipboard was busy) and the owner changed: we
                    // cannot tell a foreign copy from our own write, so we do not overwrite it, and say
                    // the user's clipboard was not put back.
                    return "unrestored";
                }
                // If the clipboard cannot be emptied, do not partially overwrite it: report it plainly.
                // (A test build can simulate EmptyClipboard failing here.)
                if (TestMode.Env("DICTATION_HELPER_TEST_FAIL_RESTORE_EMPTY") == "1" || !Native.EmptyClipboard()) return "unrestored";
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
