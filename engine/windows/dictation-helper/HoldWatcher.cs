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
        /// <summary>Armed key down-state and callback count seen on the previous tick, to spot a missed callback.</summary>
        bool prevArmedDown;
        long prevKeyCallbackCount;
        long lastSilentReinstallTick;
        /// <summary>Per-hook backoff (ms) before the next re-install attempt; 0 = ready now.</summary>
        int keyBackoffMs, mouseBackoffMs;
        /// <summary>Whether a lost event has been announced for each hook, to balance with restored.</summary>
        bool keyLostAnnounced, mouseLostAnnounced;
        /// <summary>Test hook (DICTATION_HELPER_TEST): drop the key / mouse hook so the watchdog re-installs it.</summary>
        int dropKeyHookForTest, dropMouseHookForTest;
        /// <summary>How often the watchdog runs; overridable only under DICTATION_HELPER_TEST.</summary>
        static readonly int WatchdogMs = TestInt("DICTATION_HELPER_WATCHDOG_MS", 2000);
        /// <summary>
        /// The silent periodic re-install interval. Kept long (5 min) because a re-install moves our
        /// hook to the top of the chain, which would otherwise flip precedence with an AutoHotkey-style
        /// remapper that often; real-traffic loss detection handles the common case between re-installs.
        /// </summary>
        static readonly int SilentReinstallMs = TestInt("DICTATION_HELPER_SILENT_REINSTALL_MS", 5 * 60 * 1000);

        static int TestInt(string name, int fallback)
        {
            if (Environment.GetEnvironmentVariable("DICTATION_HELPER_TEST") == null) return fallback;
            int value;
            string raw = Environment.GetEnvironmentVariable(name);
            return raw != null && int.TryParse(raw, out value) && value > 0 ? value : fallback;
        }

        public bool Active { get { return keyHook != IntPtr.Zero; } }
        public bool MouseActive { get { return mouseHook != IntPtr.Zero; } }
        public bool MouseSwallowing { get { return mouseSwallowing; } }
        /// <summary>Whether the low-level hooks are known to be installed (false during a detected loss).</summary>
        public bool HooksLive { get { return hooksLive; } }

        /// <summary>Test only: ask the watchdog to drop the keyboard hook on its next tick.</summary>
        public void DropKeyHookForTest() { dropKeyHookForTest = 1; }

        /// <summary>Test only: ask the watchdog to drop the mouse hook on its next tick.</summary>
        public void DropMouseHookForTest() { dropMouseHookForTest = 1; }

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
            UpdatePoll();
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
            UpdatePoll();
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
            if (watchdog != null) return;
            lastSilentReinstallTick = Environment.TickCount;
            prevKeyCallbackCount = keyCallbackCount;
            prevArmedDown = keySpec != null && Native.IsDown(keySpec.Vk);
            keyBackoffMs = 0;
            mouseBackoffMs = 0;
            watchdog = Ui.Every(WatchdogMs, WatchdogTick);
        }

        void MaybeStopWatchdog()
        {
            if (watchdog != null && keyHook == IntPtr.Zero && mouseHook == IntPtr.Zero)
            {
                watchdog.Cancel();
                watchdog = null;
                hooksLive = true;
                keyLostAnnounced = false;
                mouseLostAnnounced = false;
                keyBackoffMs = 0;
                mouseBackoffMs = 0;
            }
        }

        /// <summary>
        /// Keep the hooks alive without ever injecting input. Windows silently removes a
        /// low-level hook whose callback runs past LowLevelHooksTimeout, which there is no
        /// event for; so the hook thread re-installs the hooks silently on a long interval
        /// (Windows allows Unhook+SetWindowsHookEx without any synthetic input), and, when the
        /// user is actually typing, a key that transitions without a matching callback is taken
        /// as a loss and re-installed at once. No probe keys are sent, so the idle timer, games,
        /// Remote Desktop and a lone Alt/Win tap are never touched, and a locked screen, UAC or
        /// an elevated foreground (where callbacks legitimately stop) never raises a false alarm.
        /// Runs on the hook thread.
        /// </summary>
        public void WatchdogTick()
        {
            bool wantKey = keySpec != null;
            bool wantMouse = mouseMachine != null;
            if (!wantKey && !wantMouse) return;

            // Test hooks: simulate Windows silently removing a hook.
            if (System.Threading.Interlocked.Exchange(ref dropKeyHookForTest, 0) == 1 && keyHook != IntPtr.Zero)
            {
                Native.UnhookWindowsHookEx(keyHook);
                keyHook = IntPtr.Zero;
            }
            if (System.Threading.Interlocked.Exchange(ref dropMouseHookForTest, 0) == 1 && mouseHook != IntPtr.Zero)
            {
                Native.UnhookWindowsHookEx(mouseHook);
                mouseHook = IntPtr.Zero;
            }

            // 1. Real-traffic loss detection for the keyboard hook: the armed key changed state but
            //    the hook delivered no callback, so it was removed while a key moved. Suppressed when
            //    the foreground app runs above us — there the low-level hook legitimately sees nothing
            //    (secure desktop / higher integrity), so a transition without a callback is expected.
            if (wantKey && keyHook != IntPtr.Zero)
            {
                bool armedDown = Native.IsDown(keySpec.Vk);
                bool transitioned = armedDown != prevArmedDown;
                bool callbackAdvanced = keyCallbackCount != prevKeyCallbackCount;
                prevArmedDown = armedDown;
                prevKeyCallbackCount = keyCallbackCount;
                if (transitioned && !callbackAdvanced && !ForegroundRunsAboveUs())
                {
                    Native.UnhookWindowsHookEx(keyHook);
                    keyHook = IntPtr.Zero;
                }
            }

            // 2. Recover each desired-but-missing hook independently, each with its own backoff.
            if (wantKey && keyHook == IntPtr.Zero)
            {
                if (keyBackoffMs > 0) keyBackoffMs -= WatchdogMs;
                else
                {
                    if (!keyLostAnnounced) { keyLostAnnounced = true; AnnounceHooks(); }
                    if (ReinstallKey())
                    {
                        keyLostAnnounced = false;
                        keyBackoffMs = 0;
                        prevKeyCallbackCount = keyCallbackCount;
                        AnnounceHooks();
                    }
                    else keyBackoffMs = NextBackoff(keyBackoffMs);
                }
            }
            if (wantMouse && mouseHook == IntPtr.Zero)
            {
                if (mouseBackoffMs > 0) mouseBackoffMs -= WatchdogMs;
                else
                {
                    if (!mouseLostAnnounced) { mouseLostAnnounced = true; AnnounceHooks(); }
                    if (ReinstallMouse())
                    {
                        mouseLostAnnounced = false;
                        mouseBackoffMs = 0;
                        AnnounceHooks();
                    }
                    else mouseBackoffMs = NextBackoff(mouseBackoffMs);
                }
            }

            // 3. A silent periodic re-install (no event) keeps the hooks fresh even when nothing above
            //    fired, covering the callback-timeout removal there is no signal for. Long interval.
            if (Environment.TickCount - lastSilentReinstallTick >= SilentReinstallMs)
            {
                lastSilentReinstallTick = Environment.TickCount;
                if (wantKey && keyHook != IntPtr.Zero && ReinstallKey()) prevKeyCallbackCount = keyCallbackCount;
                if (wantMouse && mouseHook != IntPtr.Zero) ReinstallMouse();
            }
        }

        static int NextBackoff(int current) { return Math.Min(current <= 0 ? 2 * WatchdogMs : current * 2, 30000); }

        /// <summary>Whether the foreground window's process runs at a higher integrity than this helper.</summary>
        static bool ForegroundRunsAboveUs()
        {
            IntPtr fg = Native.GetForegroundWindow();
            if (fg == IntPtr.Zero) return false;
            uint pid = Native.WindowPid(fg);
            return pid != 0 && Native.RunsAboveUs(pid);
        }

        /// <summary>Recompute hooksLive and send a single lost/restored/failed event on a real change.</summary>
        void AnnounceHooks()
        {
            bool wantKey = keySpec != null;
            bool wantMouse = mouseMachine != null;
            bool allInstalled = (!wantKey || keyHook != IntPtr.Zero) && (!wantMouse || mouseHook != IntPtr.Zero);
            bool anyLost = keyLostAnnounced || mouseLostAnnounced;
            bool nextLive = allInstalled && !anyLost;
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
