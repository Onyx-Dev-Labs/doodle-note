using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using System.Windows.Automation;
using System.Windows.Automation.Text;

namespace DoodleNote.DictationHelper
{
    /// <summary>
    /// Side-effect-free reads of the focused control through UI Automation, with the
    /// Win32 focus and caret as the fallback when a control has no automation element.
    /// The Windows counterpart of AX in Accessibility.swift.
    /// </summary>
    internal static class UIA
    {
        /// <summary>The element with keyboard focus, or null.</summary>
        public static AutomationElement Focused()
        {
            try { return AutomationElement.FocusedElement; }
            catch (ElementNotAvailableException) { return null; }
            catch (InvalidOperationException) { return null; }
            catch (System.Runtime.InteropServices.COMException) { return null; }
        }

        public static bool Same(AutomationElement a, AutomationElement b)
        {
            if (a == null || b == null) return false;
            try { return Automation.Compare(a, b); }
            catch (ElementNotAvailableException) { return false; }
        }

        public static int Pid(AutomationElement element)
        {
            try { return element.Current.ProcessId; }
            catch (ElementNotAvailableException) { return 0; }
        }

        /// <summary>The element's RuntimeId as a stable key, or null when unavailable.</summary>
        public static string RuntimeId(AutomationElement element)
        {
            if (element == null) return null;
            try
            {
                int[] id = element.GetRuntimeId();
                return id == null ? null : string.Join(".", id);
            }
            catch (ElementNotAvailableException) { return null; }
            catch (InvalidOperationException) { return null; }
            catch (System.Runtime.InteropServices.COMException) { return null; }
        }

        /// <summary>The element's IsPassword, or null when it cannot be read (never a guess).</summary>
        public static bool? TryIsPassword(AutomationElement element)
        {
            if (element == null) return null;
            try { return element.Current.IsPassword; }
            catch (ElementNotAvailableException) { return null; }
            catch (InvalidOperationException) { return null; }
            catch (System.Runtime.InteropServices.COMException) { return null; }
        }

        public static bool IsPassword(AutomationElement element)
        {
            if (element == null) return false;
            try { return element.Current.IsPassword; }
            catch (ElementNotAvailableException) { return false; }
            catch (InvalidOperationException) { return false; }
            catch (System.Runtime.InteropServices.COMException) { return false; }
        }

        static object Pattern(AutomationElement element, AutomationPattern pattern)
        {
            object found;
            try { return element.TryGetCurrentPattern(pattern, out found) ? found : null; }
            catch (ElementNotAvailableException) { return null; }
            catch (InvalidOperationException) { return null; }
        }

        public static ValuePattern Value(AutomationElement element) { return Pattern(element, ValuePattern.Pattern) as ValuePattern; }
        public static TextPattern Text(AutomationElement element) { return Pattern(element, TextPattern.Pattern) as TextPattern; }

        /// <summary>The control's whole text, or null when it does not expose one.</summary>
        public static string ReadValue(AutomationElement element, int max)
        {
            try
            {
                ValuePattern value = Value(element);
                if (value != null)
                {
                    string text = value.Current.Value;
                    if (text != null) return text;
                }
                TextPattern pattern = Text(element);
                if (pattern != null) return pattern.DocumentRange.GetText(max + 1);
            }
            catch (ElementNotAvailableException) { throw; }
            catch (InvalidOperationException) { }
            catch (System.Runtime.InteropServices.COMException) { }
            return null;
        }

        /// <summary>The selected text, or null when the control does not expose a selection.</summary>
        public static string Selection(AutomationElement element)
        {
            try
            {
                TextPattern pattern = Text(element);
                if (pattern == null) return null;
                TextPatternRange[] ranges = pattern.GetSelection();
                if (ranges == null || ranges.Length == 0) return "";
                return string.Concat(ranges.Select(range => range.GetText(-1)));
            }
            catch (ElementNotAvailableException) { return null; }
            catch (InvalidOperationException) { return null; }
            catch (System.Runtime.InteropServices.COMException) { return null; }
        }

        /// <summary>Where the selection starts, as an offset from the start of the text (a change detector only).</summary>
        public static int? SelectionStart(AutomationElement element)
        {
            try
            {
                TextPattern pattern = Text(element);
                if (pattern == null) return null;
                TextPatternRange[] ranges = pattern.GetSelection();
                if (ranges == null || ranges.Length == 0) return null;
                return pattern.DocumentRange.CompareEndpoints(TextPatternRangeEndpoint.Start, ranges[0], TextPatternRangeEndpoint.Start);
            }
            catch (Exception) { return null; }
        }

        /// <summary>Select the one occurrence of text in the control. False when it cannot.</summary>
        public static bool SelectText(AutomationElement element, string target)
        {
            try
            {
                TextPattern pattern = Text(element);
                if (pattern == null) return false;
                TextPatternRange found = pattern.DocumentRange.FindText(target, false, false);
                if (found == null) return false;
                found.Select();
                return Selection(element) == target;
            }
            catch (Exception) { return false; }
        }
    }

    internal sealed class ElementFacts
    {
        public string Role = "";
        public bool Secure;
        public bool Editable;
        /// <summary>The element's facts could be read (false when it vanished mid-read: never trust the defaults then).</summary>
        public bool Readable;

        public static ElementFacts Of(AutomationElement element, Native.GUITHREADINFO gui)
        {
            ElementFacts facts = new ElementFacts();
            if (element == null)
            {
                // No automation element: a blinking caret is the sign of a text field.
                facts.Role = "Win32";
                facts.Editable = gui.hwndCaret != IntPtr.Zero;
                facts.Secure = IsPasswordEdit(gui.hwndFocus);
                facts.Readable = true;
                return facts;
            }
            try
            {
                AutomationElement.AutomationElementInformation info = element.Current;
                string name = info.ControlType != null ? info.ControlType.ProgrammaticName : "";
                facts.Role = name.StartsWith("ControlType.") ? name.Substring(12) : name;
                facts.Secure = info.IsPassword;
                ValuePattern value = UIA.Value(element);
                bool textLike = info.ControlType == ControlType.Edit || info.ControlType == ControlType.Document || info.ControlType == ControlType.ComboBox;
                if (value != null) facts.Editable = !value.Current.IsReadOnly;
                else facts.Editable = textLike && info.IsEnabled && info.IsKeyboardFocusable;
                // Some web and custom controls report a generic role but show a caret.
                if (!facts.Editable && gui.hwndCaret != IntPtr.Zero) facts.Editable = true;
                facts.Readable = true;
            }
            catch (ElementNotAvailableException) { }
            return facts;
        }

        internal static bool IsPasswordEdit(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero) return false;
            const int GWL_STYLE = -16, ES_PASSWORD = 0x20;
            return Native.ClassOf(hwnd).IndexOf("edit", StringComparison.OrdinalIgnoreCase) >= 0
                && (Native.GetWindowLong(hwnd, GWL_STYLE) & ES_PASSWORD) != 0;
        }
    }

    /// <summary>
    /// A focused control remembered by the helper. The element handle never leaves
    /// this process; the host only holds the snapshot id and descriptive fields.
    /// </summary>
    internal sealed class TargetSnapshot
    {
        public string Id;
        public uint Pid;
        /// <summary>The top-level window that had the user's attention.</summary>
        public IntPtr Window;
        /// <summary>The Win32 window with keyboard focus inside it (the fallback identity).</summary>
        public IntPtr FocusWindow;
        /// <summary>The executable's file name in lower case, the Windows stand-in for a bundle id.</summary>
        public string BundleId = "";
        public string AppName = "";
        public string AppPath = "";
        public AutomationElement Element;
        /// <summary>The focused control's RuntimeId at capture time, for the per-character typing check.</summary>
        public string RuntimeId;
        public ElementFacts Facts;
        /// <summary>The target runs elevated and this helper does not: Windows drops typed input to it.</summary>
        public bool AboveUs;
        public DateTime Taken = DateTime.UtcNow;

        public bool HasElement { get { return Element != null || FocusWindow != IntPtr.Zero; } }
    }

    internal sealed class SnapshotStore
    {
        readonly object gate = new object();
        readonly Dictionary<string, TargetSnapshot> items = new Dictionary<string, TargetSnapshot>();
        readonly List<string> order = new List<string>();
        /// <summary>Bounded so an abandoned session cannot pin automation handles forever.</summary>
        const int Limit = 6;

        public void Put(TargetSnapshot snapshot)
        {
            lock (gate)
            {
                items[snapshot.Id] = snapshot;
                order.Add(snapshot.Id);
                while (order.Count > Limit)
                {
                    items.Remove(order[0]);
                    order.RemoveAt(0);
                }
            }
        }

        public TargetSnapshot Get(string id)
        {
            lock (gate)
            {
                TargetSnapshot found;
                return items.TryGetValue(id, out found) ? found : null;
            }
        }

        public void Drop(string id)
        {
            lock (gate)
            {
                items.Remove(id);
                order.RemoveAll(x => x == id);
            }
        }
    }

    internal static class Target
    {
        /// <summary>Who has the user's attention right now: the foreground window and its real owner.</summary>
        public static bool Foreground(out IntPtr window, out uint pid, out uint thread)
        {
            window = Native.GetForegroundWindow();
            pid = 0;
            thread = 0;
            if (window == IntPtr.Zero) return false;
            thread = Native.GetWindowThreadProcessId(window, out pid);
            // Store apps live inside ApplicationFrameHost; the app's own window is a child from another process.
            if (pid != 0 && AppNames.ExeName(Native.ProcessPath(pid)) == "applicationframehost.exe")
            {
                uint host = pid, inner = 0;
                IntPtr innerWindow = IntPtr.Zero;
                Native.EnumChildWindows(window, delegate(IntPtr child, IntPtr l)
                {
                    uint childPid = Native.WindowPid(child);
                    if (childPid != 0 && childPid != host) { inner = childPid; innerWindow = child; return false; }
                    return true;
                }, IntPtr.Zero);
                if (inner != 0)
                {
                    pid = inner;
                    uint ignored;
                    thread = Native.GetWindowThreadProcessId(innerWindow, out ignored);
                }
            }
            return pid != 0;
        }

        /// <summary>The window is an Edit control with the ES_PASSWORD style (cheap: one GetWindowLong).</summary>
        public static bool IsPasswordEdit(IntPtr hwnd) { return ElementFacts.IsPasswordEdit(hwnd); }

        public static Native.GUITHREADINFO GuiInfo(uint thread)
        {
            Native.GUITHREADINFO info = new Native.GUITHREADINFO();
            info.cbSize = System.Runtime.InteropServices.Marshal.SizeOf(typeof(Native.GUITHREADINFO));
            if (thread == 0 || !Native.GetGUIThreadInfo(thread, ref info)) info = new Native.GUITHREADINFO();
            return info;
        }

        /// <summary>The Win32 focus and caret of the foreground app's thread.</summary>
        public static Native.GUITHREADINFO CurrentGui()
        {
            IntPtr window;
            uint pid, thread;
            Foreground(out window, out pid, out thread);
            return GuiInfo(thread);
        }

        /// <summary>The focused element, but only when it belongs to the foreground app.</summary>
        public static AutomationElement FocusedIn(uint pid)
        {
            AutomationElement element = UIA.Focused();
            if (element == null) return null;
            int owner = UIA.Pid(element);
            return owner == (int)pid ? element : null;
        }

        /// <summary>Capture the foreground app and its focused control, without activating anything.</summary>
        public static TargetSnapshot Capture(string id)
        {
            IntPtr window;
            uint pid, thread;
            if (!Foreground(out window, out pid, out thread)) return null;
            Native.GUITHREADINFO gui = GuiInfo(thread);
            AutomationElement element = FocusedIn(pid);
            if (element == null)
            {
                // Chromium and Electron build their automation tree when a client first
                // asks, and take a moment to do so. Wait briefly; delivery re-validates anyway.
                for (int i = 0; i < 20 && element == null; i++)
                {
                    Thread.Sleep(30);
                    element = FocusedIn(pid);
                }
            }
            string path = Native.ProcessPath(pid);
            TargetSnapshot snapshot = new TargetSnapshot();
            snapshot.Id = id;
            snapshot.Pid = pid;
            snapshot.Window = window;
            snapshot.FocusWindow = gui.hwndFocus;
            snapshot.AppPath = path;
            snapshot.BundleId = AppNames.ExeName(path);
            snapshot.AppName = AppNames.DisplayName(path, pid);
            snapshot.Element = element;
            snapshot.RuntimeId = UIA.RuntimeId(element);
            snapshot.Facts = ElementFacts.Of(element, gui);
            snapshot.AboveUs = Native.RunsAboveUs(pid);
            return snapshot;
        }

        public static Dictionary<string, object> Describe(TargetSnapshot snapshot)
        {
            Dictionary<string, object> output = Wire.Fields(
                "snapshotId", snapshot.Id,
                "pid", (long)snapshot.Pid,
                "bundleId", snapshot.BundleId,
                "appName", snapshot.AppName,
                "appPath", snapshot.AppPath,
                "hasElement", snapshot.HasElement,
                // Windows asks no permission for UI Automation or synthetic input.
                "accessibility", true);
            if (snapshot.Facts != null)
            {
                output["role"] = snapshot.Facts.Role;
                output["secure"] = snapshot.Facts.Secure;
                output["editable"] = snapshot.Facts.Editable && !snapshot.AboveUs;
            }
            if (snapshot.AboveUs) output["elevated"] = true;
            return output;
        }

        /// <summary>Is the snapshot's control still the one with focus, in the app with the user's attention?</summary>
        public static bool StillFocused(TargetSnapshot snapshot, out AutomationElement current)
        {
            current = null;
            IntPtr window;
            uint pid, thread;
            if (!Foreground(out window, out pid, out thread) || pid != snapshot.Pid) return false;
            if (snapshot.Element != null)
            {
                current = FocusedIn(pid);
                return UIA.Same(current, snapshot.Element);
            }
            Native.GUITHREADINFO gui = GuiInfo(thread);
            return snapshot.FocusWindow != IntPtr.Zero && gui.hwndFocus == snapshot.FocusWindow;
        }

        public static List<string> ConflictingDictationApps()
        {
            List<string> names = new List<string>();
            foreach (Process process in Process.GetProcesses())
            {
                try
                {
                    string name = process.ProcessName;
                    if (name.IndexOf("wispr", StringComparison.OrdinalIgnoreCase) >= 0 && !names.Contains(name)) names.Add(name);
                }
                catch (InvalidOperationException) { }
                finally { process.Dispose(); }
            }
            return names;
        }
    }
}
