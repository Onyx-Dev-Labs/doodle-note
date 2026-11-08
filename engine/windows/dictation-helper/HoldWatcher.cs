using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace DoodleNote.DictationHelper
{
    /// <summary>
    /// Hold-to-talk and its double tap, from a key and, optionally, a mouse button,
    /// through low-level hooks. The keyboard hook only looks: it never changes, swallows
    /// or delays anyone's keystrokes. The one thing it adds is an unassigned "mask" key
    /// pressed while Right Alt or the Right Windows key is held, so letting go of it never
    /// opens an app's menu bar or the Start menu. The mouse hook can hold back the chosen
    /// button so the app under the pointer does not also act on it. Both sources share
    /// one hold counter and one owner, like HoldWatcher in the Swift helper.
    /// Every method runs on the main (hook) thread.
    /// </summary>
    internal sealed class HoldWatcher
    {
        // Static fields initialize in the order written, and Shared's constructor reads the two below,
        // so they come first (otherwise Shared would see 0 for both).
        /// <summary>How often the watchdog runs (a test build may shorten it).</summary>
        static readonly int WatchdogMs = TestMode.Int("DICTATION_HELPER_WATCHDOG_MS", 2000);
        /// <summary>10 s of watchdog ticks.</summary>
        static readonly int MouseEvidenceWindowTicks = Math.Max(1, 10000 / WatchdogMs);

        public static readonly HoldWatcher Shared = new HoldWatcher();

        IntPtr keyHook = IntPtr.Zero;
        Native.HookProc keyProc;
        HoldKeySpec keySpec;
        HoldMachine keyMachine;
        Ui.Cancelable keyPending;

        IntPtr mouseHook = IntPtr.Zero;
        Native.HookProc mouseProc;
        HoldMachine mouseMachine;
        Ui.Cancelable mousePending;
        int mouseButton = -1;
        bool mouseSwallowing;
        bool swallowedDown;
        bool mousePaused;

        Ui.Cancelable poll;
        int minHoldMs = 150;
        readonly HoldArbiter arbiter = new HoldArbiter();
        /// <summary>Hold ids keep counting across restarts, so a late "up" never pairs with a newer hold.</summary>
        int lastHoldId;
        /// <summary>The key name the watcher was started with, so a lost hook can be re-installed.</summary>
        string keyName;
        bool clickMode;
        /// <summary>Incremented by the keyboard hook on every callback; the watchdog watches it advance.</summary>
        long keyCallbackCount;
        Ui.Cancelable watchdog;
        /// <summary>False only while the keyboard hook is known to be gone and not yet re-installed.</summary>
        bool hooksLive = true;
        /// <summary>Incremented by the mouse hook on every callback (moves included).</summary>
        long mouseCallbackCount;
        /// <summary>Armed key down-state and callback counts seen on the previous tick, to spot a missed callback.</summary>
        bool prevArmedDown;
        long prevKeyCallbackCount, prevMouseCallbackCount;
        readonly HookLossDetector keyDetector = new HookLossDetector(1);
        /// <summary>
        /// Two suspect ticks for the mouse within MouseEvidenceWindowTicks (10 s): one stray cursor move
        /// is not enough, and evidence older than the window expires, so isolated SetCursorPos calls by
        /// other apps never add up to a false alarm; quiet ticks inside the window do not clear it.
        /// </summary>
        readonly HookLossDetector mouseDetector = new HookLossDetector(2, false, MouseEvidenceWindowTicks);
        /// <summary>
        /// The armed key and button are sampled this often on the hook thread (GetAsyncKeyState, its
        /// state and its "pressed since" bit), so a short stationary press between watchdog ticks is
        /// still seen. A transition with no hook callback across the surrounding samples is a suspect.
        /// </summary>
        public const int SampleMs = 40;
        const int SampleTolerance = 20;
        /// <summary>Transitions seen while the foreground ran above us (hooks legitimately see nothing then).</summary>
        int keyAboveSamples, buttonAboveSamples;
        Ui.Cancelable sampler;
        bool sampledKeyDown, sampledButtonDown;
        /// <summary>Callback counts at the previous two samples (a callback always precedes the state change it causes).</summary>
        long keyCountAtSample1, keyCountAtSample2, mouseCountAtSample1, mouseCountAtSample2;
        /// <summary>Transitions of the armed key / button seen with no callback, since the last watchdog tick.</summary>
        int keySuspectSamples, buttonSuspectSamples;
        /// <summary>Per hook: when to retry re-installing it (4/8/16/30 s while re-installing fails).</summary>
        readonly RetryClock keyRetry = new RetryClock(WatchdogMs), mouseRetry = new RetryClock(WatchdogMs);
        /// <summary>The armed mouse button's async state on the previous tick (stationary-use evidence).</summary>
        bool prevButtonDown;
        /// <summary>Whether a lost event has been announced for each hook, to balance with restored.</summary>
        bool keyLostAnnounced, mouseLostAnnounced;
#if DICTATION_TEST
        /// <summary>Test build only: drop the key / mouse hook so the watchdog must notice and re-install it.</summary>
        int dropKeyHookForTest, dropMouseHookForTest;
#endif

        public bool Active { get { return keyHook != IntPtr.Zero; } }
        public bool MouseActive { get { return mouseHook != IntPtr.Zero; } }
        public bool MouseSwallowing { get { return mouseSwallowing; } }
        /// <summary>Whether the low-level hooks are known to be installed (false during a detected loss).</summary>
        public bool HooksLive { get { return hooksLive; } }

#if DICTATION_TEST
        /// <summary>Test build only: remove the keyboard hook now, as Windows would, without telling the watchdog.</summary>
        public void DropKeyHookForTest() { dropKeyHookForTest = 1; }

        /// <summary>Test build only: remove the mouse hook now, as Windows would, without telling the watchdog.</summary>
        public void DropMouseHookForTest() { dropMouseHookForTest = 1; }

        /// <summary>Test build only: the hook handles Windows sees as installed right now.</summary>
        public bool KeyHookInstalled { get { return keyHook != IntPtr.Zero; } }
        public bool MouseHookInstalled { get { return mouseHook != IntPtr.Zero; } }
#endif

        /// <summary>Whether a low-level hook can be installed at all (blocked by policy or security software otherwise).</summary>
        public bool HooksAllowed()
        {
            if (Active || MouseActive) return true;
            Native.HookProc probe = delegate(int code, IntPtr w, IntPtr l) { return Native.CallNextHookEx(IntPtr.Zero, code, w, l); };
            IntPtr hook = Native.SetWindowsHookEx(Native.WH_KEYBOARD_LL, probe, Native.GetModuleHandle(null), 0);
            if (hook == IntPtr.Zero) return false;
            Native.UnhookWindowsHookEx(hook);
            GC.KeepAlive(probe);
            return true;
        }

        public string Start(string key, int minHold)
        {
            Stop();
            HoldKeySpec spec = HoldKeySpec.Named(key);
            if (spec == null) return "unknown-key";
            keyProc = OnKey;
            IntPtr hook = Native.SetWindowsHookEx(Native.WH_KEYBOARD_LL, keyProc, Native.GetModuleHandle(null), 0);
            if (hook == IntPtr.Zero)
            {
                Wire.Log("keyboard hook refused: " + Marshal.GetLastWin32Error());
                return "input-monitoring-denied";
            }
            keyHook = hook;
            keySpec = spec;
            keyName = key;
            keyMachine = HoldMachine.ForKey(0);
            minHoldMs = HoldDelay(minHold);
            prevKeyCallbackCount = keyCallbackCount;
            prevArmedDown = Native.IsDown(spec.Vk);
            ResetKeySamples();
            keyDetector.Reset();
            RaiseHookThreadPriority();
            StartWatchdog();
            return null;
        }

        public void Stop()
        {
            Apply(HoldArbiter.Source.Key, HoldMachine.Input.Of(HoldMachine.Kind.Reset));
            if (keyHook != IntPtr.Zero) Native.UnhookWindowsHookEx(keyHook);
            keyHook = IntPtr.Zero;
            keyMachine = null;
            keySpec = null;
            // A removed or replaced watcher takes its loss state with it.
            keyLostAnnounced = false;
            keyRetry.Succeeded();
            keyDetector.Reset();
            UpdatePoll();
            AnnounceHooks();
            MaybeStopWatchdog();
        }

        /// <summary>Middle (2), back (3) and forward (4): the buttons Windows hooks can tell apart. Never left or right click.</summary>
        public static bool AllowedButton(long button) { return button >= 2 && button <= 4; }

        public string StartMouse(long button, bool wantSwallow, int minHold, bool click)
        {
            StopMouse();
            if (!AllowedButton(button)) return "invalid-button";
            mouseProc = OnMouse;
            IntPtr hook = Native.SetWindowsHookEx(Native.WH_MOUSE_LL, mouseProc, Native.GetModuleHandle(null), 0);
            if (hook == IntPtr.Zero)
            {
                Wire.Log("mouse hook refused: " + Marshal.GetLastWin32Error());
                return "input-monitoring-denied";
            }
            mouseHook = hook;
            mouseButton = (int)button;
            // A low-level mouse hook may consume events without any extra permission.
            mouseSwallowing = wantSwallow;
            clickMode = click;
            mouseMachine = HoldMachine.ForMouse((int)button, click, 0);
            minHoldMs = HoldDelay(minHold);
            prevMouseCallbackCount = mouseCallbackCount;
            prevButtonDown = Native.IsDown(ButtonVk((int)button));
            ResetMouseSamples();
            mouseDetector.Reset();
            RaiseHookThreadPriority();
            StartWatchdog();
            return null;
        }

        public void StopMouse()
        {
            Apply(HoldArbiter.Source.Mouse, HoldMachine.Input.Of(HoldMachine.Kind.Reset));
            if (mouseHook != IntPtr.Zero) Native.UnhookWindowsHookEx(mouseHook);
            mouseHook = IntPtr.Zero;
            mouseMachine = null;
            mouseSwallowing = false;
            swallowedDown = false;
            mousePaused = false;
            mouseButton = -1;
            mouseLostAnnounced = false;
            mouseRetry.Succeeded();
            mouseDetector.Reset();
            UpdatePoll();
            AnnounceHooks();
            MaybeStopWatchdog();
        }

        public void SetMousePaused(bool paused)
        {
            if (mouseHook == IntPtr.Zero) return;
            mousePaused = paused;
            if (paused) Apply(HoldArbiter.Source.Mouse, HoldMachine.Input.Of(HoldMachine.Kind.Reset));
        }

        public void StopAll()
        {
            Stop();
            StopMouse();
        }

        static int HoldDelay(int ms) { return Math.Max(60, Math.Min(ms, 1000)); }

        static int ButtonFor(int message, uint mouseData)
        {
            switch (message)
            {
                case Native.WM_MBUTTONDOWN:
                case Native.WM_MBUTTONUP:
                    return 2;
                case Native.WM_XBUTTONDOWN:
                case Native.WM_XBUTTONUP:
                    uint which = (mouseData >> 16) & 0xFFFF;
                    return which == 1 ? 3 : which == 2 ? 4 : -1;
                default:
                    return -1;
            }
        }

        static bool IsOwn(IntPtr extra) { return extra == Native.OwnInputMarker; }

        /* ---- hook callbacks: decode, feed the machine, return at once ---- */

        IntPtr OnKey(int code, IntPtr wParam, IntPtr lParam)
        {
            // Every delivered callback is proof the hook is alive; the watchdog reads this counter.
            if (code >= 0) keyCallbackCount++;
            if (code >= 0 && keyMachine != null)
            {
                Native.KBDLLHOOKSTRUCT info = (Native.KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(Native.KBDLLHOOKSTRUCT));
                int message = wParam.ToInt32();
                bool down = message == Native.WM_KEYDOWN || message == Native.WM_SYSKEYDOWN;
                bool up = message == Native.WM_KEYUP || message == Native.WM_SYSKEYUP;
                // AltGr layouts send a fake Left Ctrl (scan code 0x21D) with Right Alt: not another key.
                bool fakeAltGrControl = info.vkCode == Native.VK_LCONTROL && info.scanCode == 0x21D;
                if (!IsOwn(info.dwExtraInfo) && !fakeAltGrControl && (down || up))
                {
                    if ((int)info.vkCode == keySpec.Vk)
                    {
                        bool first = down && !keyMachine.IsDown;
                        Apply(HoldArbiter.Source.Key, HoldMachine.Input.Of(down ? HoldMachine.Kind.KeyDown : HoldMachine.Kind.KeyUp));
                        if (first && keySpec.NeedsMask) Ui.Post(SendMask);
                    }
                    else if (down)
                    {
                        Apply(HoldArbiter.Source.Key, HoldMachine.Input.Of(HoldMachine.Kind.OtherKeyDown));
                    }
                }
            }
            return Native.CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
        }

        static void SendMask()
        {
            Native.Send(new[] { Native.Key(Native.VK_MASK, false, false), Native.Key(Native.VK_MASK, true, false) });
        }

        IntPtr OnMouse(int code, IntPtr wParam, IntPtr lParam)
        {
            // Every delivered callback (moves included) is proof the hook is alive.
            if (code >= 0) mouseCallbackCount++;
            if (code >= 0 && mouseMachine != null && !mousePaused)
            {
                Native.MSLLHOOKSTRUCT info = (Native.MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(Native.MSLLHOOKSTRUCT));
                int message = wParam.ToInt32();
                int number = ButtonFor(message, info.mouseData);
                if (number == mouseButton && !IsOwn(info.dwExtraInfo))
                {
                    bool down = message == Native.WM_MBUTTONDOWN || message == Native.WM_XBUTTONDOWN;
                    if (down)
                    {
                        Apply(HoldArbiter.Source.Mouse, HoldMachine.Input.Press(HoldMachine.Kind.ButtonDown, number));
                        swallowedDown = mouseSwallowing;
                        if (mouseSwallowing) return new IntPtr(1);
                    }
                    else
                    {
                        Apply(HoldArbiter.Source.Mouse, HoldMachine.Input.Press(HoldMachine.Kind.ButtonUp, number));
                        bool consume = swallowedDown;
                        swallowedDown = false;
                        if (consume) return new IntPtr(1);
                    }
                }
            }
            return Native.CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
        }

        /// <summary>
        /// While a trigger is held, check now and then that it still is: a lost release
        /// (a hook Windows skipped, a secure desktop) must end the hold. A swallowed mouse
        /// button never reaches the system's button state, so it is not polled.
        /// </summary>
        void UpdatePoll()
        {
            bool keyHeld = keyMachine != null && keyMachine.IsDown;
            bool mouseHeld = mouseMachine != null && mouseMachine.IsDown && !mouseMachine.ClickMode && !mouseSwallowing;
            if (keyHeld || mouseHeld)
            {
                if (poll == null) poll = Ui.Every(250, PollTick);
            }
            else if (poll != null)
            {
                poll.Cancel();
                poll = null;
            }
        }

        void PollTick()
        {
            if (keyMachine != null && keyMachine.IsDown && keySpec != null)
                Apply(HoldArbiter.Source.Key, HoldMachine.Input.State(HoldMachine.Kind.KeyState, Native.IsDown(keySpec.Vk)));
            if (mouseMachine != null && mouseMachine.IsDown && !mouseMachine.ClickMode && !mouseSwallowing)
            {
                int vk = mouseButton == 2 ? Native.VK_MBUTTON : mouseButton == 3 ? Native.VK_XBUTTON1 : Native.VK_XBUTTON2;
                Apply(HoldArbiter.Source.Mouse, HoldMachine.Input.State(HoldMachine.Kind.ButtonState, Native.IsDown(vk)));
            }
            UpdatePoll();
        }

        /// <summary>Feed one source's machine and carry out what it asks for, with the one-owner rule.</summary>
        void Apply(HoldArbiter.Source source, HoldMachine.Input input)
        {
            HoldMachine machine = source == HoldArbiter.Source.Key ? keyMachine : mouseMachine;
            if (machine == null) return;
            if (input.Kind == HoldMachine.Kind.AnnounceTimer) machine.HoldId = lastHoldId;
            List<HoldMachine.Output> outputs = machine.Handle(input);
            foreach (HoldMachine.Output output in outputs)
            {
                if (!arbiter.Allow(output, source)) continue;
                switch (output.Kind)
                {
                    case HoldMachine.OutKind.ScheduleAnnounce:
                        HoldArbiter.Source from = source;
                        SetPending(source, Ui.After(minHoldMs, delegate { Apply(from, HoldMachine.Input.Of(HoldMachine.Kind.AnnounceTimer)); }));
                        break;
                    case HoldMachine.OutKind.CancelAnnounce:
                        SetPending(source, null);
                        break;
                    case HoldMachine.OutKind.HoldDown:
                        lastHoldId = output.Id;
                        Wire.Send(Wire.Fields("event", "hold", "phase", "down", "holdId", output.Id));
                        break;
                    case HoldMachine.OutKind.HoldUp:
                        Wire.Send(Wire.Fields("event", "hold", "phase", "up", "holdId", output.Id, "reason", output.Reason));
                        break;
                    case HoldMachine.OutKind.Tap:
                        Wire.Send(Wire.Fields("event", "tap"));
                        break;
                    case HoldMachine.OutKind.Click:
                        Wire.Send(Wire.Fields("event", "click"));
                        break;
                }
            }
            UpdatePoll();
        }

        /// <summary>
        /// Windows silently removes a low-level hook whose callback runs past
        /// LowLevelHooksTimeout, most likely right after a key release while Parakeet is decoding
        /// at full CPU. The hook thread runs at the highest priority to make that rare; the
        /// watchdog (WatchdogTick) detects a loss from real traffic — never by injecting input —
        /// and re-installs the keyboard and mouse hooks independently.
        /// </summary>
        static void RaiseHookThreadPriority()
        {
            // The hooks are serviced on this (the main/UI) thread; nothing slow runs on it.
            Native.SetThreadPriority(Native.GetCurrentThread(), Native.THREAD_PRIORITY_HIGHEST);
        }

        void StartWatchdog()
        {
            // A coalescable timer (20 ms tolerance): the 25 Hz sampling lets Windows batch its wake-ups.
            if (sampler == null) sampler = Ui.EveryCoalesced(SampleMs, SampleTolerance, SampleTick);
            if (watchdog != null) return;
            watchdog = Ui.Every(WatchdogMs, WatchdogTick);
        }

        void MaybeStopWatchdog()
        {
            if (keySpec != null || mouseMachine != null) return;
            if (watchdog != null)
            {
                watchdog.Cancel();
                watchdog = null;
            }
            if (sampler != null)
            {
                sampler.Cancel();
                sampler = null;
            }
        }

        void ResetKeySamples()
        {
            if (keySpec != null) sampledKeyDown = Native.IsDown(keySpec.Vk);
            keyCountAtSample1 = keyCountAtSample2 = keyCallbackCount;
            keySuspectSamples = 0;
        }

        void ResetMouseSamples()
        {
            if (mouseButton >= 0) sampledButtonDown = Native.IsDown(ButtonVk(mouseButton));
            mouseCountAtSample1 = mouseCountAtSample2 = mouseCallbackCount;
            buttonSuspectSamples = 0;
        }

        /// <summary>
        /// Every SampleMs on the hook thread: did the armed key or button change state (or report a
        /// press since the last query) while its hook delivered no callback across this and the previous
        /// sample interval? The hook runs on this thread and Windows waits for it before updating the
        /// key state, so a live hook's callback always comes first; two intervals absorb the one case
        /// where a sample lands between the callback and the state update.
        /// </summary>
        public void SampleTick()
        {
            if (keySpec != null && keyHook != IntPtr.Zero)
            {
                bool down, pressed;
                Native.KeyState(keySpec.Vk, out down, out pressed);
                long count = keyCallbackCount;
                if ((down != sampledKeyDown || pressed) && count == keyCountAtSample2)
                {
                    // Recorded with the moment it happened: a press in a higher-integrity window followed
                    // by a switch back before the tick is never loss evidence.
                    if (ForegroundRunsAboveUs()) keyAboveSamples++;
                    else keySuspectSamples++;
                }
                sampledKeyDown = down;
                keyCountAtSample2 = keyCountAtSample1;
                keyCountAtSample1 = count;
            }
            if (mouseMachine != null && mouseHook != IntPtr.Zero && mouseButton >= 0)
            {
                bool down, pressed;
                Native.KeyState(ButtonVk(mouseButton), out down, out pressed);
                long count = mouseCallbackCount;
                if ((down != sampledButtonDown || pressed) && count == mouseCountAtSample2)
                {
                    if (ForegroundRunsAboveUs()) buttonAboveSamples++;
                    else buttonSuspectSamples++;
                }
                sampledButtonDown = down;
                mouseCountAtSample2 = mouseCountAtSample1;
                mouseCountAtSample1 = count;
            }
        }

        /// <summary>
        /// Keep the hooks alive without ever injecting input and without reordering the hook chain
        /// needlessly. Windows silently removes a low-level hook whose callback runs past
        /// LowLevelHooksTimeout and sends no event for it, so a loss is inferred from real traffic:
        /// the armed key changed state, or the cursor moved, while the hook delivered no callback at
        /// all (HookLossDetector, which also keeps a higher-integrity foreground from raising a false
        /// alarm). Only a detected loss re-installs a hook; there is no periodic re-install, so the
        /// chain order against remappers (AutoHotkey and the like) only changes after a real loss.
        /// Each hook recovers independently with its own growing retry delay; a loss is announced
        /// only when re-installing fails. Runs on the hook thread.
        /// </summary>
        public void WatchdogTick()
        {
            bool wantKey = keySpec != null;
            bool wantMouse = mouseMachine != null;
            if (!wantKey && !wantMouse) return;
#if DICTATION_TEST
            // Simulate Windows silently removing a hook (the watchdog is not told).
            if (System.Threading.Interlocked.Exchange(ref dropKeyHookForTest, 0) == 1 && keyHook != IntPtr.Zero)
                Native.UnhookWindowsHookEx(keyHook); // handle kept: Windows does not tell us either
            if (System.Threading.Interlocked.Exchange(ref dropMouseHookForTest, 0) == 1 && mouseHook != IntPtr.Zero)
                Native.UnhookWindowsHookEx(mouseHook);
#endif
            bool above = ForegroundRunsAboveUs() || keyAboveSamples > 0 || buttonAboveSamples > 0;
            keyAboveSamples = buttonAboveSamples = 0;

            if (wantKey && keyHook != IntPtr.Zero)
            {
                bool armedDown = Native.IsDown(keySpec.Vk);
                long count = keyCallbackCount;
                bool advanced = count != prevKeyCallbackCount;
                // The state at the two ticks, or any transition the 40 ms sampler saw with no callback
                // (a short press between ticks leaves the state unchanged at both).
                bool transitioned = armedDown != prevArmedDown || keySuspectSamples > 0;
                keySuspectSamples = 0;
                prevArmedDown = armedDown;
                prevKeyCallbackCount = count;
                if (keyDetector.Observe(transitioned && !advanced, advanced, above))
                {
                    Wire.Log("keyboard hook loss detected (the armed key moved with no callback)");
                    Native.UnhookWindowsHookEx(keyHook);
                    keyHook = IntPtr.Zero;
                }
            }
            if (wantMouse && mouseHook != IntPtr.Zero)
            {
                // Mouse-specific evidence only: the armed button's own state, read passively at the tick and
                // every 40 ms in between. Cursor movement is not evidence (another app's SetCursorPos moves
                // it with no callback, and keyboard input moves the last-input time while it does).
                // pressing it without moving the mouse is evidence too (a button the live hook swallows
                // never changes this state).
                bool buttonDown = Native.IsDown(ButtonVk(mouseButton));
                bool buttonMoved = buttonDown != prevButtonDown || buttonSuspectSamples > 0;
                buttonSuspectSamples = 0;
                prevButtonDown = buttonDown;
                long count = mouseCallbackCount;
                bool advanced = count != prevMouseCallbackCount;
                prevMouseCallbackCount = count;
                if (mouseDetector.Observe(buttonMoved && !advanced, advanced, above))
                {
                    Wire.Log("mouse hook loss detected (the armed button moved with no callback)");
                    Native.UnhookWindowsHookEx(mouseHook);
                    mouseHook = IntPtr.Zero;
                }
            }

            if (wantKey && keyHook == IntPtr.Zero) RecoverKey();
            if (wantMouse && mouseHook == IntPtr.Zero) RecoverMouse();
        }

        static int ButtonVk(int button)
        {
            return button == 2 ? Native.VK_MBUTTON : button == 3 ? Native.VK_XBUTTON1 : Native.VK_XBUTTON2;
        }

        void RecoverKey()
        {
            if (!keyRetry.Tick()) return;
            if (ReinstallKey())
            {
                Wire.Log("keyboard hook re-installed");
                keyRetry.Succeeded();
                prevKeyCallbackCount = keyCallbackCount;
                prevArmedDown = Native.IsDown(keySpec.Vk);
                ResetKeySamples();
                keyDetector.Reset();
                if (keyLostAnnounced) { keyLostAnnounced = false; AnnounceHooks(); }
                return;
            }
            keyRetry.Failed();
            if (!keyLostAnnounced) { keyLostAnnounced = true; AnnounceHooks(); }
        }

        void RecoverMouse()
        {
            if (!mouseRetry.Tick()) return;
            if (ReinstallMouse())
            {
                Wire.Log("mouse hook re-installed");
                mouseRetry.Succeeded();
                prevMouseCallbackCount = mouseCallbackCount;
                prevButtonDown = Native.IsDown(ButtonVk(mouseButton));
                ResetMouseSamples();
                mouseDetector.Reset();
                if (mouseLostAnnounced) { mouseLostAnnounced = false; AnnounceHooks(); }
                return;
            }
            mouseRetry.Failed();
            if (!mouseLostAnnounced) { mouseLostAnnounced = true; AnnounceHooks(); }
        }


        /// <summary>Whether the foreground window's process runs at a higher integrity than this helper.</summary>
        static bool ForegroundRunsAboveUs()
        {
            IntPtr fg = Native.GetForegroundWindow();
            if (fg == IntPtr.Zero) return false;
            uint pid = Native.WindowPid(fg);
            return pid != 0 && Native.RunsAboveUs(pid);
        }

        /// <summary>
        /// Recompute hooksLive from the CONFIGURED watchers only and send a single lost/restored
        /// event on a real change. A watcher that was stopped no longer counts, so a stale loss flag
        /// can never keep the status at "lost".
        /// </summary>
        void AnnounceHooks()
        {
            bool wantKey = keySpec != null;
            bool wantMouse = mouseMachine != null;
            bool anyLost = (wantKey && keyLostAnnounced) || (wantMouse && mouseLostAnnounced);
            bool nextLive = !anyLost;
            if (nextLive == hooksLive) return;
            hooksLive = nextLive;
            Wire.Send(Wire.Fields("event", "hooks", "phase", nextLive ? "restored" : "lost"));
        }

        bool ReinstallKey()
        {
            if (keySpec == null) return false;
            if (keyHook != IntPtr.Zero) { Native.UnhookWindowsHookEx(keyHook); keyHook = IntPtr.Zero; }
            IntPtr hook = Native.SetWindowsHookEx(Native.WH_KEYBOARD_LL, keyProc, Native.GetModuleHandle(null), 0);
            if (hook == IntPtr.Zero) return false;
            keyHook = hook;
            return true;
        }

        bool ReinstallMouse()
        {
            if (mouseMachine == null) return false;
            if (mouseHook != IntPtr.Zero) { Native.UnhookWindowsHookEx(mouseHook); mouseHook = IntPtr.Zero; }
            IntPtr hook = Native.SetWindowsHookEx(Native.WH_MOUSE_LL, mouseProc, Native.GetModuleHandle(null), 0);
            if (hook == IntPtr.Zero) return false;
            mouseHook = hook;
            return true;
        }

        void SetPending(HoldArbiter.Source source, Ui.Cancelable work)
        {
            if (source == HoldArbiter.Source.Key)
            {
                if (keyPending != null) keyPending.Cancel();
                keyPending = work;
            }
            else
            {
                if (mousePending != null) mousePending.Cancel();
                mousePending = work;
            }
        }
    }

    /// <summary>Records the next mouse button pressed, for the settings page. Listen-only.</summary>
    internal sealed class MouseCapture
    {
        public static readonly MouseCapture Shared = new MouseCapture();
        IntPtr hook = IntPtr.Zero;
        Native.HookProc proc;
        Ui.Cancelable timeout;
        Action<Dictionary<string, object>, string> completion;

        public void Begin(double seconds, Action<Dictionary<string, object>, string> done)
        {
            Cancel("superseded");
            proc = OnMouse;
            IntPtr installed = Native.SetWindowsHookEx(Native.WH_MOUSE_LL, proc, Native.GetModuleHandle(null), 0);
            if (installed == IntPtr.Zero)
            {
                done(null, "input-monitoring-denied");
                return;
            }
            hook = installed;
            completion = done;
            timeout = Ui.After((int)(seconds * 1000), delegate { Finish(null, "timeout"); });
        }

        public void Cancel(string reason) { Finish(null, reason); }

        IntPtr OnMouse(int code, IntPtr wParam, IntPtr lParam)
        {
            if (code >= 0 && hook != IntPtr.Zero)
            {
                Native.MSLLHOOKSTRUCT info = (Native.MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(Native.MSLLHOOKSTRUCT));
                int message = wParam.ToInt32();
                int button = -1;
                if (message == Native.WM_LBUTTONDOWN) button = 0;
                else if (message == Native.WM_RBUTTONDOWN) button = 1;
                else if (message == Native.WM_MBUTTONDOWN) button = 2;
                else if (message == Native.WM_XBUTTONDOWN) button = ((info.mouseData >> 16) & 0xFFFF) == 1 ? 3 : 4;
                if (button >= 0 && info.dwExtraInfo != Native.OwnInputMarker)
                {
                    int seen = button;
                    // Finish after the hook returns; never unhook from inside the callback.
                    Ui.Post(delegate
                    {
                        if (HoldWatcher.AllowedButton(seen)) Finish(Wire.Fields("button", seen), null);
                        else Finish(null, "primary-button");
                    });
                }
            }
            return Native.CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
        }

        void Finish(Dictionary<string, object> fields, string reason)
        {
            if (timeout != null) timeout.Cancel();
            timeout = null;
            if (hook != IntPtr.Zero) Native.UnhookWindowsHookEx(hook);
            hook = IntPtr.Zero;
            Action<Dictionary<string, object>, string> done = completion;
            completion = null;
            if (done != null) done(fields, reason);
        }
    }
}
