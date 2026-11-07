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

        public bool Active { get { return keyHook != IntPtr.Zero; } }
        public bool MouseActive { get { return mouseHook != IntPtr.Zero; } }
        public bool MouseSwallowing { get { return mouseSwallowing; } }

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
            keyMachine = HoldMachine.ForKey(0);
            minHoldMs = HoldDelay(minHold);
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
            mouseMachine = HoldMachine.ForMouse((int)button, click, 0);
            minHoldMs = HoldDelay(minHold);
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
