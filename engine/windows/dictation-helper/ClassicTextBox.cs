using System;
using System.Diagnostics;
using System.Text;
using System.Threading;

namespace DoodleNote.DictationHelper
{
    /// <summary>
    /// The only kind of control the typing fallback types into: a classic Win32 text box (the Edit and
    /// RichEdit window classes, including WinForms' and other subclassed variants). For these, whether
    /// each key landed and whether the field is secure are answered by the control's own UI thread, per
    /// keystroke, with no accessibility provider in between:
    ///  - WM_GETTEXTLENGTH (sent with SendMessageTimeout) is answered between messages, after the
    ///    previous key was handled, so the length moving by exactly the units the key adds (minus a
    ///    replaced selection, read with EM_GETSEL) proves that key, and only that key, was processed;
    ///  - ES_PASSWORD is a window style, read with GetWindowLong immediately before every key.
    /// Every other target (browsers, Electron, WebView2/CEF, Firefox, Java, Qt, XAML/UWP, Office) is
    /// reachable only through UI Automation, whose events and properties lag the control; typing is
    /// refused there and paste is the only delivery path.
    /// </summary>
    internal sealed class ClassicTextBox
    {
        /// <summary>How long the control's UI thread may take to answer one query (an app briefly busy is not a refusal).</summary>
        public const int QueryTimeoutMs = 250;
        /// <summary>One poll while waiting for a key to land (the wait itself is bounded by its caller).</summary>
        const int PollTimeoutMs = 100;
        /// <summary>EM_GETSEL packs 16-bit offsets: past this length a selection cannot be read exactly.</summary>
        public const int MaxLength = 0xFFFF;
        const int GWL_STYLE = -16, ES_MULTILINE = 0x4, ES_PASSWORD = 0x20, ES_READONLY = 0x800;

        public readonly IntPtr Window;
        public readonly string ClassName;

        ClassicTextBox(IntPtr window, string className)
        {
            Window = window;
            ClassName = className;
        }

        /// <summary>
        /// Window classes accepted as classic text boxes: Edit and the RichEdit family by name, and their
        /// subclassed variants (WinForms names its classes "WindowsForms10.EDIT.app..." and so on); a
        /// superclassed Edit whose RealGetWindowClass is "Edit" counts too.
        /// </summary>
        public static bool IsClassicClass(string name, string realClass)
        {
            if (string.IsNullOrEmpty(name)) return false;
            if (string.Equals(realClass, "Edit", StringComparison.OrdinalIgnoreCase)) return true;
            if (string.Equals(name, "Edit", StringComparison.OrdinalIgnoreCase)) return true;
            string bare = name.StartsWith("WindowsForms10.", StringComparison.OrdinalIgnoreCase) ? name.Substring(15) : name;
            if (bare.StartsWith("EDIT.", StringComparison.OrdinalIgnoreCase)) return true;
            // RichEdit (1.0), RichEdit20A/W, RICHEDIT50W, RichEditD2D, RichEditD2DPT (Windows 11 Notepad).
            return bare.StartsWith("RichEdit", StringComparison.OrdinalIgnoreCase);
        }

        static string RealClass(IntPtr window)
        {
            StringBuilder name = new StringBuilder(256);
            uint length = Native.RealGetWindowClass(window, name, (uint)name.Capacity);
            return length > 0 ? name.ToString(0, (int)length) : "";
        }

        /// <summary>
        /// Everything checked before the first key, with nothing sent: the focused window is a classic
        /// text box, editable, not secure, answers WM_GETTEXTLENGTH and EM_GETSEL within the timeout, and
        /// is short enough for EM_GETSEL to be exact. Null with the refusal otherwise.
        /// </summary>
        public static ClassicTextBox Probe(IntPtr window, out string refusal)
        {
            refusal = null;
            if (window == IntPtr.Zero || !Native.IsWindow(window)) { refusal = "target-unverifiable"; return null; }
            string name = Native.ClassOf(window);
            if (!IsClassicClass(name, RealClass(window))) { refusal = "typing-unsupported"; return null; }
            ClassicTextBox box = new ClassicTextBox(window, name);
            if (box.Secure) { refusal = "secure-field"; return null; }
            if ((Native.GetWindowLong(window, GWL_STYLE) & ES_READONLY) != 0) { refusal = "not-editable"; return null; }
            long length = box.Length();
            if (length < 0) { refusal = "target-unverifiable"; return null; }
            if (length >= MaxLength) { refusal = "typing-unsupported"; return null; }
            if (box.SelectionLength() < 0) { refusal = "target-unverifiable"; return null; }
            return box;
        }

        /// <summary>ES_MULTILINE: Enter adds a line break (two units, CR LF) instead of doing nothing.</summary>
        public bool Multiline { get { return (Native.GetWindowLong(Window, GWL_STYLE) & ES_MULTILINE) != 0; } }

        /// <summary>The control is a password box right now (a fresh GetWindowLong; no provider call).</summary>
        public bool Secure { get { return (Native.GetWindowLong(Window, GWL_STYLE) & ES_PASSWORD) != 0; } }

        /// <summary>The control's text length, answered by its UI thread; -1 when it does not answer in time.</summary>
        public long Length() { return Length(QueryTimeoutMs); }

        long Length(int timeoutMs)
        {
            IntPtr result;
            IntPtr ok = Native.SendMessageTimeout(Window, Native.WM_GETTEXTLENGTH, IntPtr.Zero, IntPtr.Zero,
                Native.SMTO_ABORTIFHUNG | Native.SMTO_BLOCK, (uint)timeoutMs, out result);
            return ok == IntPtr.Zero ? -1 : result.ToInt64();
        }

        /// <summary>Why the last selection read failed (diagnostics).</summary>
        public string LastSelectionError;

        /// <summary>The selection's length in UTF-16 units (0 for a caret); -1 when it cannot be read exactly.</summary>
        public int SelectionLength()
        {
            IntPtr result;
            IntPtr ok = Native.SendMessageTimeout(Window, Native.EM_GETSEL, IntPtr.Zero, IntPtr.Zero,
                Native.SMTO_ABORTIFHUNG | Native.SMTO_BLOCK, QueryTimeoutMs, out result);
            if (ok == IntPtr.Zero) { LastSelectionError = "no answer (" + System.Runtime.InteropServices.Marshal.GetLastWin32Error() + ")"; return -1; }
            long packed = result.ToInt64();
            int start = (int)(packed & 0xFFFF), end = (int)((packed >> 16) & 0xFFFF);
            // 0xFFFF in either half means the offset did not fit (or the control returned -1).
            if (start == 0xFFFF || end == 0xFFFF || end < start) { LastSelectionError = "unreadable 0x" + packed.ToString("x"); return -1; }
            return end - start;
        }

        /// <summary>
        /// After one key was sent with the length at `from`: true once the length reads exactly
        /// `expected`. False as soon as it reads anything else that is not `from` (the key did more or
        /// less than one key's worth: an autocomplete, an IME composition, a length limit), or when it
        /// has not moved within timeoutMs. `seen` is the last length read (-1: no answer).
        /// </summary>
        public bool WaitLength(long from, long expected, int timeoutMs, out long seen)
        {
            Stopwatch watch = Stopwatch.StartNew();
            while (true)
            {
                seen = Length(PollTimeoutMs);
                if (seen == expected) return true;
                if (seen >= 0 && seen != from) return false;
                if (watch.ElapsedMilliseconds >= timeoutMs) return false;
                Thread.Sleep(1);
            }
        }
    }
}
