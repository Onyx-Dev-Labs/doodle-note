using System.Collections.Generic;

namespace DoodleNote.DictationHelper
{
    /// <summary>
    /// The decision logic of hold-to-talk, with no timers, hooks or I/O, so it can be
    /// driven by tests. A port of engine/Sources/dictation-helper/HoldMachine.swift; the
    /// only difference is the input vocabulary. macOS reports modifiers as flag changes;
    /// Windows reports each key going down and up, and the watcher polls the key's live
    /// state while it is held (the counterpart of the Swift machine noticing a missing
    /// flag in another key's event).
    ///
    /// A key pressed on its own is announced as a hold only after the watcher's delay
    /// (AnnounceTimer). Released before that, it is a Tap: the raw material of the
    /// double tap. A chord, or any other key struck while it is down, is neither.
    /// A mouse button in click mode reports every press as one Click.
    /// </summary>
    internal sealed class HoldMachine
    {
        public enum Kind
        {
            /// <summary>The trigger key went down (repeats arrive while held).</summary>
            KeyDown,
            KeyUp,
            /// <summary>Any other key went down.</summary>
            OtherKeyDown,
            /// <summary>The key's live state, polled while held. Up while we think it is down = lost release.</summary>
            KeyState,
            AnnounceTimer,
            ButtonDown,
            ButtonUp,
            ButtonState,
            /// <summary>The hook stopped delivering; a release may have been missed.</summary>
            TapDisabled,
            Reset
        }

        public struct Input
        {
            public Kind Kind;
            public int Button;
            public bool Down;
            public static Input Of(Kind kind) { Input input = new Input(); input.Kind = kind; return input; }
            public static Input Press(Kind kind, int button) { Input input = Of(kind); input.Button = button; return input; }
            public static Input State(Kind kind, bool down) { Input input = Of(kind); input.Down = down; return input; }
        }

        public enum OutKind { ScheduleAnnounce, CancelAnnounce, HoldDown, HoldUp, Tap, Click }

        public struct Output
        {
            public OutKind Kind;
            public int Id;
            public string Reason;
            public override string ToString()
            {
                switch (Kind)
                {
                    case OutKind.HoldDown: return "holdDown(" + Id + ")";
                    case OutKind.HoldUp: return "holdUp(" + Id + "," + Reason + ")";
                    default: return Kind.ToString();
                }
            }
        }

        static Output Out(OutKind kind) { Output output = new Output(); output.Kind = kind; return output; }

        /// <summary>Set for a mouse trigger; -1 for the key.</summary>
        public readonly int MouseButton;
        public readonly bool ClickMode;
        bool keyIsDown, tainted, announced;
        /// <summary>Settable so the watcher can keep one counter across a key and a button.</summary>
        public int HoldId;

        HoldMachine(int mouseButton, bool clickMode, int holdId)
        {
            MouseButton = mouseButton;
            ClickMode = clickMode;
            HoldId = holdId;
        }

        public static HoldMachine ForKey(int holdId) { return new HoldMachine(-1, false, holdId); }
        public static HoldMachine ForMouse(int button, bool clickMode, int holdId) { return new HoldMachine(button, clickMode, holdId); }

        bool IsMouse { get { return MouseButton >= 0; } }
        public bool IsDown { get { return keyIsDown; } }

        public List<Output> Handle(Input input)
        {
            List<Output> none = new List<Output>();
            switch (input.Kind)
            {
                case Kind.TapDisabled:
                    {
                        List<Output> output = EndHold("tap-disabled");
                        keyIsDown = false;
                        return output;
                    }
                case Kind.Reset:
                    {
                        List<Output> output = new List<Output> { Out(OutKind.CancelAnnounce) };
                        output.AddRange(EndHold("stopped"));
                        keyIsDown = false;
                        tainted = false;
                        return output;
                    }
                case Kind.KeyDown:
                    if (IsMouse || keyIsDown) return none; // auto-repeat
                    keyIsDown = true;
                    tainted = false;
                    return new List<Output> { Out(OutKind.CancelAnnounce), Out(OutKind.ScheduleAnnounce) };
                case Kind.KeyUp:
                    if (IsMouse || !keyIsDown) return none;
                    return Release();
                case Kind.OtherKeyDown:
                    // Any other key means the trigger is part of a shortcut, not a hold.
                    if (IsMouse) return none;
                    if (keyIsDown && !announced) tainted = true;
                    return none;
                case Kind.KeyState:
                    if (IsMouse || !keyIsDown || input.Down) return none;
                    return Release();
                case Kind.ButtonDown:
                    if (ClickMode)
                    {
                        if (input.Button != MouseButton) return none;
                        keyIsDown = true;
                        return new List<Output> { Out(OutKind.Click) };
                    }
                    if (input.Button != MouseButton || keyIsDown) return none;
                    keyIsDown = true;
                    tainted = false;
                    return new List<Output> { Out(OutKind.CancelAnnounce), Out(OutKind.ScheduleAnnounce) };
                case Kind.ButtonUp:
                    if (input.Button != MouseButton || !keyIsDown) return none;
                    if (ClickMode)
                    {
                        keyIsDown = false;
                        return none;
                    }
                    return Release();
                case Kind.ButtonState:
                    if (!IsMouse || ClickMode || !keyIsDown || input.Down) return none;
                    return Release();
                case Kind.AnnounceTimer:
                    if (ClickMode || !keyIsDown || tainted || announced) return none;
                    announced = true;
                    HoldId += 1;
                    Output down = Out(OutKind.HoldDown);
                    down.Id = HoldId;
                    return new List<Output> { down };
            }
            return none;
        }

        List<Output> Release()
        {
            keyIsDown = false;
            List<Output> output = new List<Output> { Out(OutKind.CancelAnnounce) };
            if (announced) output.AddRange(EndHold("released"));
            else if (!tainted) output.Add(Out(OutKind.Tap)); // released before it counted as a hold
            return output;
        }

        List<Output> EndHold(string reason)
        {
            List<Output> output = new List<Output>();
            if (!announced) return output;
            announced = false;
            Output up = Out(OutKind.HoldUp);
            up.Id = HoldId;
            up.Reason = reason;
            output.Add(up);
            return output;
        }
    }

    /// <summary>
    /// Decides which of two hold sources (the key and the mouse button) the host hears
    /// from. The first one announced owns the session; the other is ignored until the
    /// owner is released. Port of HoldArbiter in HoldMachine.swift.
    /// </summary>
    internal sealed class HoldArbiter
    {
        public enum Source { Key, Mouse, None }
        public Source Owner = Source.None;

        public bool Allow(HoldMachine.Output output, Source source)
        {
            switch (output.Kind)
            {
                case HoldMachine.OutKind.HoldDown:
                    if (Owner != Source.None) return false;
                    Owner = source;
                    return true;
                case HoldMachine.OutKind.HoldUp:
                    if (Owner != source) return false;
                    Owner = Source.None;
                    return true;
                case HoldMachine.OutKind.Tap:
                case HoldMachine.OutKind.Click:
                    return Owner == Source.None;
                default:
                    return true;
            }
        }
    }

    /// <summary>The keys hold-to-talk can use on Windows, by the protocol's key names.</summary>
    internal sealed class HoldKeySpec
    {
        public readonly int Vk;
        /// <summary>Alt and Win act on their own release (menu bar, Start); a mask key stops that.</summary>
        public readonly bool NeedsMask;

        HoldKeySpec(int vk, bool mask) { Vk = vk; NeedsMask = mask; }

        /// <summary>
        /// The protocol keeps the macOS names: rightOption is the key in the same place
        /// (Right Alt / AltGr), rightControl is Right Ctrl, rightCommand is the Right
        /// Windows key. Fn never reaches Windows, so it is unknown here.
        /// </summary>
        public static HoldKeySpec Named(string name)
        {
            switch (name)
            {
                case "rightOption": return new HoldKeySpec(Native.VK_RMENU, true);
                case "rightControl": return new HoldKeySpec(Native.VK_RCONTROL, false);
                case "rightCommand": return new HoldKeySpec(Native.VK_RWIN, true);
                default: return null;
            }
        }
    }
}
