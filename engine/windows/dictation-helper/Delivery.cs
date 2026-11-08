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
            // to process the key (measured 43-45 ms per character on Dev04 in WinForms and Edge), plus
            // 70 ms at each word boundary, plus confirm and settle. Mirrored in dictation-helper-protocol.ts.
            return normalized.Length * 50 + boundaries * 70 + 3000;
        }

        static DeliveryResult DeliverInner(TargetSnapshot snapshot, string text, DeliveryGuards guards, DeliveryTimings timings, int deadlineMs, int alreadyElapsedMs)
        {
            // The deadline is measured from when the request was received, not from here: a
            // deliver stuck behind a slow UIA call must not begin after the app gave up.
            Stopwatch began = Stopwatch.StartNew();
            Func<long> elapsed = () => began.ElapsedMilliseconds + alreadyElapsedMs;
            if (!snapshot.HasElement || snapshot.Facts == null) return new DeliveryResult(DeliveryOutcome.Refused, "no-target");
            AutomationElement current;
            if (!Target.StillFocused(snapshot, out current)) return new DeliveryResult(DeliveryOutcome.Refused, "focus-changed");
            // Re-read: the field may have become a password field since the snapshot.
            Native.GUITHREADINFO gui = Target.CurrentGui();
            ElementFacts now = ElementFacts.Of(current, gui);
            if (snapshot.Facts.Secure || now.Secure) return new DeliveryResult(DeliveryOutcome.Refused, "secure-field");
            if (snapshot.AboveUs) return new DeliveryResult(DeliveryOutcome.Refused, "elevated-target");
            if (!now.Editable) return new DeliveryResult(DeliveryOutcome.Refused, "not-editable");

            if (guards.ExpectSelection != null)
            {
                if (current == null || UIA.Selection(current) != guards.ExpectSelection)
                    return new DeliveryResult(DeliveryOutcome.Refused, "selection-changed");
            }
            if (guards.Replace != null)
            {
                // Undo and the like: find the one copy of the old text, select it, and let
                // the normal insertion below replace it.
                string value = null;
                try { value = current != null ? UIA.ReadValue(current, FieldRead.MaxCharacters * 4) : null; }
                catch (ElementNotAvailableException) { }
                if (value == null || TextLocator.UniqueIndex(guards.Replace, value) < 0 || !UIA.SelectText(current, guards.Replace))
                    return new DeliveryResult(DeliveryOutcome.Refused, "text-changed");
            }
            ControlState before = ControlState.Read(current);
            timings.ValidateMs = Ms(began);

            // Windows has no caret insertion through UI Automation (ValuePattern replaces
            // the whole field), so text goes in the way people paste: the clipboard and
            // Ctrl+V, with the clipboard put back. Synthetic Unicode typing is the fallback
            // when the clipboard cannot be opened. DICTATION_HELPER_STRATEGY=type forces the fallback
            // in a test build only (TestMode); the shipped helper has no such switch.
            bool forceType = TestMode.Env("DICTATION_HELPER_STRATEGY") == "type";
            // The client sized its wait from the text length; never begin an insertion it has
            // already given up on, or doubled text could land after the user pastes from the card.
            if (deadlineMs > 0 && !forceType && elapsed() + PasteEstimateMs > deadlineMs
                && elapsed() + TypeEstimateMs(text) > deadlineMs)
                return new DeliveryResult(DeliveryOutcome.Refused, "deadline-exceeded");
            if (!forceType)
            {
                if (deadlineMs == 0 || elapsed() + PasteEstimateMs <= deadlineMs)
                {
                    DeliveryResult pasted = Paste(text, current, snapshot, before, timings);
                    if (pasted != null) return pasted;
                }
            }
            if (deadlineMs > 0 && elapsed() + TypeEstimateMs(text) > deadlineMs)
                return new DeliveryResult(DeliveryOutcome.Refused, "deadline-exceeded");
            return TypeText(text, current, snapshot, before, timings, deadlineMs, elapsed);
        }

        /// <summary>Null when the clipboard could not be opened (nothing was attempted).</summary>
        static DeliveryResult Paste(string text, AutomationElement element, TargetSnapshot snapshot, ControlState before, DeliveryTimings timings)
        {
            Stopwatch insert = Stopwatch.StartNew();
            SavedClipboard saved = SavedClipboard.Capture();
            if (saved == null) return null;
            ClipboardOwnership ours;
            if (!ClipboardText.Write(text, out ours))
            {
                // The write failed part-way. If we emptied the clipboard, the user's content is gone
                // from it unless we put it back now (before any typing fallback): ownership comes from
                // having emptied it, not from the text landing, so an owned partial write is restored.
                if (ours.Emptied) saved.Restore(ours);
                return null;
            }
            if (!ReleaseModifiers() || !TargetStillSafe(snapshot))
            {
                DeliveryResult moved = new DeliveryResult(DeliveryOutcome.Refused, "focus-changed");
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

        static DeliveryResult TypeText(string text, AutomationElement element, TargetSnapshot snapshot, ControlState before, DeliveryTimings timings, int deadlineMs, Func<long> elapsed)
        {
            Stopwatch insert = Stopwatch.StartNew();
            if (!ReleaseModifiers() || !TargetStillSafe(snapshot))
            {
                DeliveryResult moved = new DeliveryResult(DeliveryOutcome.Refused, "focus-changed");
                moved.Method = "type";
                return moved;
            }
            // A UIA target must have an identity to compare against; without one (or without a
            // readable secure state, checked per keystroke below) typing is refused, never permitted.
            if (snapshot.Element != null && snapshot.RuntimeId == null)
            {
                DeliveryResult unverifiable = new DeliveryResult(DeliveryOutcome.Refused, "target-unverifiable");
                unverifiable.Method = "type";
                return unverifiable;
            }
            // One character per call with a short gap: text controls built on XAML and the
            // Text Services Framework drop Unicode keystrokes that arrive in a burst.
            string normalized = text.Replace("\r\n", "\n");
            GuardStats guardStats = new GuardStats();
            GuardStats settleStats = new GuardStats();
            // A "the target has processed the key" signal (caret offset, and the value length for a
            // short field): after each keystroke the loop waits (bounded) for it to change before the
            // next guard runs. Chromium reports value changes but not always caret moves, Win32 edits
            // both; a long document only pays for the caret read.
            bool readValue = before.Value != null && before.Value.Length < 4096;
            string signal = element != null ? KeySignal(element, readValue) : null;
            if (signal == "-:-1") signal = null; // nothing observable: no settle wait
            int expected = 0;
            uint sent = 0;
            int charsTyped = 0;
            bool aborted = false;
            string abortReason = null;
            Stopwatch sinceCheck = Stopwatch.StartNew();
            // A focus-change subscription keeps the focused element's identity current between the
            // synchronous refreshes the guard does whenever that cache is older than FocusStaleMs.
            using (FocusMonitor focus = new FocusMonitor())
            {
            for (int i = 0; i < normalized.Length; i++)
            {
                // Immediately before EVERY keystroke: foreground app, focused control identity and a
                // FRESH secure-state read (KeystrokeGuard). Any failure, or anything it cannot read,
                // stops typing at once; not one more keystroke is sent.
                long guardStart = Stopwatch.GetTimestamp();
                string unsafeReason = KeystrokeGuard(snapshot, focus);
                double guardMs = (Stopwatch.GetTimestamp() - guardStart) * 1000.0 / Stopwatch.Frequency;
                guardStats.Add(guardMs);
                if (unsafeReason != null)
                {
                    aborted = true;
                    abortReason = unsafeReason;
                    break;
                }
                // A guard read that stalls (a hung UIA provider) means the state it vouched for may be
                // stale by the time the key lands: stop rather than type on old information.
                if (guardMs > GuardBudgetMs)
                {
                    aborted = true;
                    abortReason = "target-unverifiable";
                    break;
                }
                // A fuller UIA check (re-reads the live focused control's secure state) on an
                // interval, as a backstop for targets without a RuntimeId.
                if (i == 0 || charsTyped % 24 == 0 || sinceCheck.ElapsedMilliseconds >= 100)
                {
                    sinceCheck.Restart();
                    if (!TargetStillSafe(snapshot)) { aborted = true; abortReason = "focus-changed"; break; }
                }
                // Re-check the deadline each iteration: a stalled UIA check must not let typing run
                // past the client's timeout (item 3).
                if (deadlineMs > 0 && elapsed() > deadlineMs) { aborted = true; abortReason = "deadline-exceeded"; break; }
                char unit = normalized[i];
                Native.INPUT[] pair;
                if (unit == '\n') pair = new[] { Native.Key(Native.VK_RETURN, false, false), Native.Key(Native.VK_RETURN, true, false) };
                else if (char.IsHighSurrogate(unit) && i + 1 < normalized.Length)
                {
                    // A surrogate pair goes as one call, so the character is never split.
                    char low = normalized[++i];
                    pair = new[] { Native.Unicode(unit, false), Native.Unicode(low, false), Native.Unicode(unit, true), Native.Unicode(low, true) };
                }
                else pair = new[] { Native.Unicode(unit, false), Native.Unicode(unit, true) };
                expected += pair.Length;
                uint count = Native.Send(pair);
                sent += count;
                if (count != pair.Length) break;
                charsTyped = i + 1;
                // Word boundaries are where editors run spelling and suggestions; keystrokes
                // that arrive meanwhile were seen to be dropped (Windows 11 Notepad).
                // Wait until the target has processed this key (its caret moved) before the guard for
                // the next one: a page that reacts to this key (moving focus, turning the field into a
                // password field) has then published that change, so the next guard sees it. Chromium
                // updates its accessibility tree asynchronously; without this a fast typist could get
                // one key in after the switch. Bounded, so an unobservable or slow target only waits
                // KeystrokeSettleMs.
                if (signal != null)
                {
                    long settleStart = Stopwatch.GetTimestamp();
                    string now = signal;
                    while (true)
                    {
                        now = KeySignal(element, readValue);
                        if (now != signal) break;
                        if ((Stopwatch.GetTimestamp() - settleStart) * 1000.0 / Stopwatch.Frequency >= KeystrokeSettleMs) break;
                        Thread.Sleep(1);
                    }
                    settleStats.Add((Stopwatch.GetTimestamp() - settleStart) * 1000.0 / Stopwatch.Frequency);
                    signal = now;
                }
                Thread.Sleep(char.IsWhiteSpace(unit) || char.IsPunctuation(unit) ? 70 : 8);
            }
            }
            timings.InsertMs += Ms(insert);
            if (aborted)
            {
                // The target changed/became secure, or the deadline passed, mid-type: some characters
                // may already be in, so the host keeps the text and must not resend.
                DeliveryResult stopped = new DeliveryResult(sent == 0 ? DeliveryOutcome.Refused : DeliveryOutcome.Uncertain, sent == 0 ? abortReason : "insertion-unverifiable");
                stopped.Method = "type";
                stopped.CharsDelivered = charsTyped;
                stopped.Guard = guardStats;
                stopped.Settle = settleStats;
                return stopped;
            }
            if (sent == 0)
            {
                DeliveryResult failed = new DeliveryResult(DeliveryOutcome.Failed, "keystroke-unavailable");
                failed.Method = "type";
                failed.Guard = guardStats;
                failed.Settle = settleStats;
                return failed;
            }
            if (sent != expected)
            {
                DeliveryResult partial = new DeliveryResult(DeliveryOutcome.Uncertain, "insertion-unverifiable");
                partial.Method = "type";
                partial.CharsDelivered = charsTyped;
                partial.Guard = guardStats;
                partial.Settle = settleStats;
                return partial;
            }
            Stopwatch confirm = Stopwatch.StartNew();
            // Keystrokes arrive one by one: wait for the field to change and then to settle,
            // so the reply (and the clipboard of a later paste) never races the last characters.
            bool verified = before.Observable && Changed(element, before, 800 + 4 * normalized.Length) && Settled(element, 150, 2000 + 4 * normalized.Length);
            // Keystrokes can be dropped one by one, so a change is not enough: the whole text must be there.
            if (verified)
            {
                ControlState after = ControlState.Read(element);
                verified = after.Value == null || after.Value.Replace("\r\n", "\n").Replace('\r', '\n').Contains(normalized);
            }
            timings.ConfirmMs += Ms(confirm);
            DeliveryResult result = verified
                ? new DeliveryResult(DeliveryOutcome.Delivered, null)
                : new DeliveryResult(DeliveryOutcome.Uncertain, "insertion-unverifiable");
            result.Method = "type";
            result.Verified = verified;
            result.CharsDelivered = charsTyped;
            result.Guard = guardStats;
            result.Settle = settleStats;
            return result;
        }

        /// <summary>
        /// The focus cache is refreshed synchronously when older than this. 0: every keystroke reads
        /// the live focused element, so a move to another control is seen before the next key, not up
        /// to one cache period later. (The cost is measured per delivery in DeliveryResult.Guard.)
        /// </summary>
        const int FocusStaleMs = 0;
        /// <summary>Caret offset and (when readValue) value length, as "caret:length"; "-:-1" when neither is readable.</summary>
        static string KeySignal(AutomationElement element, bool readValue)
        {
            int? caret = UIA.SelectionStart(element);
            int length = -1;
            if (readValue)
            {
                try
                {
                    ValuePattern value = UIA.Value(element);
                    string text = value != null ? value.Current.Value : null;
                    if (text != null) length = text.Length;
                }
                catch (Exception) { length = -2; } // unreadable now (e.g. it became a password field): a change
            }
            return (caret.HasValue ? caret.Value.ToString() : "-") + ":" + length;
        }

        /// <summary>A single guard check slower than this aborts typing (its answer may be stale).</summary>
        const double GuardBudgetMs = 250;
        /// <summary>The longest wait for the target to process one typed key (see TypeText).</summary>
        const double KeystrokeSettleMs = 120;

        /// <summary>
        /// The safety check run immediately before each typed keystroke. Null when it is safe to send
        /// the next key; otherwise the refusal reason. Missing identity or an unreadable secure state
        /// is a refusal ("target-unverifiable"), never a pass.
        ///  - The foreground window still belongs to the snapshot's process.
        ///  - Win32 (every key, cheap): the focused window is not an Edit with ES_PASSWORD; for a target
        ///    without a UIA element, the focused window is still the snapshot's.
        ///  - UIA: the focused element (cache, refreshed when older than FocusStaleMs) is still the
        ///    snapshot's RuntimeId in the same process and not a password control, AND a fresh
        ///    IsPassword read on the element itself is false, so a field that becomes secure without
        ///    any focus change (a page flipping input type, PasswordChar set mid-type) stops typing.
        /// </summary>
        static string KeystrokeGuard(TargetSnapshot snapshot, FocusMonitor focus)
        {
            IntPtr foreground = Native.GetForegroundWindow();
            if (foreground == IntPtr.Zero) return "focus-changed";
            uint pid;
            uint thread = Native.GetWindowThreadProcessId(foreground, out pid);
            if (pid != snapshot.Pid) return "focus-changed";
            Native.GUITHREADINFO gui = Target.GuiInfo(thread);
            if (Target.IsPasswordEdit(gui.hwndFocus)) return "secure-field";
            if (snapshot.Element == null)
                return snapshot.FocusWindow != IntPtr.Zero && gui.hwndFocus == snapshot.FocusWindow ? null : "focus-changed";
            string rid;
            bool? focusedSecure;
            int owner;
            focus.Current(FocusStaleMs, out rid, out focusedSecure, out owner);
            if (rid == null || focusedSecure == null) return "target-unverifiable";
            if (focusedSecure.Value) return "secure-field";
            if (owner != (int)snapshot.Pid || rid != snapshot.RuntimeId) return "focus-changed";
            bool? secure = UIA.TryIsPassword(snapshot.Element);
            if (secure == null) return "target-unverifiable";
            return secure.Value ? "secure-field" : null;
        }

        static bool TargetStillSafe(TargetSnapshot snapshot)
        {
            if (snapshot.AboveUs) return false;
            AutomationElement current;
            if (!Target.StillFocused(snapshot, out current)) return false;
            ElementFacts now = ElementFacts.Of(current, Target.CurrentGui());
            return !now.Secure;
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

        /// <summary>True once the control has read the same for quietMs (false if it never settles in time).</summary>
        static bool Settled(AutomationElement element, int quietMs, int withinMs)
        {
            Stopwatch watch = Stopwatch.StartNew();
            ControlState last = ControlState.Read(element);
            Stopwatch quiet = Stopwatch.StartNew();
            while (watch.ElapsedMilliseconds < withinMs)
            {
                Thread.Sleep(15);
                ControlState now = ControlState.Read(element);
                if (!now.SameAs(last))
                {
                    last = now;
                    quiet.Restart();
                }
                else if (quiet.ElapsedMilliseconds >= quietMs) return true;
            }
            return false;
        }

        static bool Changed(AutomationElement element, ControlState before, int withinMs)
        {
            Stopwatch watch = Stopwatch.StartNew();
            do
            {
                if (!ControlState.Read(element).SameAs(before)) return true;
                Thread.Sleep(15);
            } while (watch.ElapsedMilliseconds < withinMs);
            return !ControlState.Read(element).SameAs(before);
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
                for (uint format = Native.EnumClipboardFormats(0); format != 0; format = Native.EnumClipboardFormats(format))
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
                if (!ours.StillOurs()) return "user-changed";
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
