using System;
using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace DoodleNote.DictationHelper
{
    /// <summary>
    /// The only kind of control the typing fallback types into: a classic Win32 text box (Edit or
    /// RichEdit). For these, whether each key landed and whether the field is secure are answered by the
    /// control's own UI thread, per keystroke, with no accessibility provider in between:
    ///  - WM_GETTEXTLENGTH (sent with SendMessageTimeout) is answered between messages, after the
    ///    previous key was handled, so the length moving by exactly the units the key adds (minus a
    ///    replaced selection, read with EM_GETSEL) proves that key, and only that key, was processed;
    ///  - ES_PASSWORD / ES_READONLY are window styles (GetWindowLong), and EM_GETPASSWORDCHAR covers a
    ///    RichEdit put in password mode by message alone.
    /// The control is recognized by an exact class allowlist (or a superclass whose real class is Edit,
    /// or that answers like a RichEdit) AND a positive capability probe; anything ambiguous is refused.
    /// Every other target (browsers, Electron, WebView2/CEF, Firefox, Java, Qt, XAML/UWP, Office) is
    /// reachable only through UI Automation; typing is refused there and paste is the only way in.
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
        const uint WM_GETTEXT = 0x000D, EM_GETLIMITTEXT = 0x00D5, EM_GETPASSWORDCHAR = 0x00D2, EM_GETTEXTMODE = 0x045A;

        public readonly IntPtr Window;
        public readonly string ClassName;
        /// <summary>A RichEdit (it answers EM_GETTEXTMODE); positions in EM_GETSEL count a paragraph break as 1.</summary>
        public readonly bool RichEdit;

        ClassicTextBox(IntPtr window, string className, bool richEdit)
        {
            Window = window;
            ClassName = className;
            RichEdit = richEdit;
        }

        public enum ClassKind { None, Edit, RichEdit }

        static readonly Regex WinForms = new Regex(@"^WindowsForms10\.(EDIT|RichEdit20W|RICHEDIT50W)\.app\.[0-9]+\.[0-9a-f]+(_r[0-9]+_ad[0-9]+)?$",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

        /// <summary>
        /// The exact allowlist by class name: Edit; RichEdit20W, RichEdit20A, RICHEDIT50W, RichEditD2DPT
        /// (Windows 11 Notepad); WinForms' EDIT / RichEdit20W / RICHEDIT50W classes. A superclassed Edit is
        /// recognized by RealGetWindowClass. Nothing else by name (a "RichEditor" is not a RichEdit).
        /// </summary>
        public static ClassKind Classify(string name, string realClass)
        {
            if (string.IsNullOrEmpty(name)) return ClassKind.None;
            if (string.Equals(name, "Edit", StringComparison.OrdinalIgnoreCase)) return ClassKind.Edit;
            foreach (string rich in new[] { "RichEdit20W", "RichEdit20A", "RICHEDIT50W", "RichEditD2DPT" })
                if (string.Equals(name, rich, StringComparison.OrdinalIgnoreCase)) return ClassKind.RichEdit;
            Match winForms = WinForms.Match(name);
            if (winForms.Success)
                return string.Equals(winForms.Groups[1].Value, "EDIT", StringComparison.OrdinalIgnoreCase) ? ClassKind.Edit : ClassKind.RichEdit;
            if (string.Equals(realClass, "Edit", StringComparison.OrdinalIgnoreCase)) return ClassKind.Edit;
            return ClassKind.None;
        }

        /// <summary>Kept for the class tests: whether a name (and real class) is on the allowlist.</summary>
        public static bool IsClassicClass(string name, string realClass) { return Classify(name, realClass) != ClassKind.None; }

        static string RealClass(IntPtr window)
        {
            StringBuilder name = new StringBuilder(256);
            uint length = Native.RealGetWindowClass(window, name, (uint)name.Capacity);
            return length > 0 ? name.ToString(0, (int)length) : "";
        }

        static long Query(IntPtr window, uint message, int timeoutMs)
        {
            IntPtr result;
            IntPtr ok = Native.SendMessageTimeout(window, message, IntPtr.Zero, IntPtr.Zero,
                Native.SMTO_ABORTIFHUNG | Native.SMTO_BLOCK, (uint)timeoutMs, out result);
            return ok == IntPtr.Zero ? -1 : result.ToInt64();
        }

        /// <summary>
        /// Everything checked before the first key, with nothing sent. The class must be on the allowlist
        /// (or be a superclass that answers like a RichEdit) and pass a positive capability probe:
        /// EM_GETLIMITTEXT answers a positive limit (Edit and RichEdit do; a lookalike window answers 0),
        /// EM_GETTEXTMODE answers non-zero exactly for a RichEdit, and EM_GETSEL returns a sane range. The
        /// box must also be editable, not secure, answer within the timeout, and be shorter than 65,535.
        /// </summary>
        public static ClassicTextBox Probe(IntPtr window, out string refusal)
        {
            refusal = null;
            if (window == IntPtr.Zero || !Native.IsWindow(window)) { refusal = "target-unverifiable"; return null; }
            string name = Native.ClassOf(window);
            ClassKind kind = Classify(name, RealClass(window));
            long limit = Query(window, EM_GETLIMITTEXT, QueryTimeoutMs);
            long textMode = Query(window, EM_GETTEXTMODE, QueryTimeoutMs);
            if (limit < 0 || textMode < 0) { refusal = "target-unverifiable"; return null; }
            bool answersLikeRichEdit = textMode > 0;
            if (kind == ClassKind.None && answersLikeRichEdit) kind = ClassKind.RichEdit; // a custom-named RichEdit superclass
            bool capable = limit > 0 && (kind == ClassKind.RichEdit ? answersLikeRichEdit : kind == ClassKind.Edit && !answersLikeRichEdit);
            if (kind == ClassKind.None || !capable) { refusal = "typing-unsupported"; return null; }
            ClassicTextBox box = new ClassicTextBox(window, name, kind == ClassKind.RichEdit);
            if (box.StyleSecure) { refusal = "secure-field"; return null; }
            if (box.StyleReadOnly) { refusal = "not-editable"; return null; }
            bool? password = box.PasswordCharSet();
            if (password == null) { refusal = "target-unverifiable"; return null; }
            if (password.Value) { refusal = "secure-field"; return null; }
            long length = box.Length();
            if (length < 0) { refusal = "target-unverifiable"; return null; }
            if (length >= MaxLength) { refusal = "typing-unsupported"; return null; }
            int start, end;
            if (!box.Selection(out start, out end) || end > length) { refusal = "target-unverifiable"; return null; }
            return box;
        }

        /// <summary>ES_MULTILINE: a line break can go in (as a Unicode CR, never a Return key).</summary>
        public bool Multiline { get { return (Native.GetWindowLong(Window, GWL_STYLE) & ES_MULTILINE) != 0; } }

        /// <summary>ES_WANTRETURN: the control asks for the Return key itself (a dialog does not turn it into OK).</summary>
        public bool WantReturn { get { return (Native.GetWindowLong(Window, GWL_STYLE) & 0x1000) != 0; } }

        /// <summary>A WinForms text box class (WindowsForms10.EDIT...): it takes a Unicode CR as a line break.</summary>
        public bool WinFormsClass { get { return ClassName.StartsWith("WindowsForms10.", StringComparison.OrdinalIgnoreCase); } }

        /// <summary>
        /// Whether the box's top-level window has a default push button a Return key could press: a
        /// dialog that answers DM_GETDEFID, or any button (Win32 or WinForms) with BS_DEFPUSHBUTTON.
        /// </summary>
        public bool TopLevelHasDefaultButton()
        {
            IntPtr top = Native.GetAncestor(Window, 2); // GA_ROOT
            if (top == IntPtr.Zero) return true; // cannot tell: assume it has one
            long defId = Query(top, 0x0400, QueryTimeoutMs); // DM_GETDEFID
            if (defId < 0 || ((defId >> 16) & 0xFFFF) == 0x534B) return true; // no answer, or DC_HASDEFID
            bool found = false;
            Native.EnumChildWindows(top, delegate (IntPtr child, IntPtr l)
            {
                if (Native.ClassOf(child).IndexOf("BUTTON", StringComparison.OrdinalIgnoreCase) >= 0
                    && (Native.GetWindowLong(child, GWL_STYLE) & 0x0F) == 1) { found = true; return false; } // BS_DEFPUSHBUTTON
                return true;
            }, IntPtr.Zero);
            return found;
        }

        /// <summary>The control has the password style right now (a fresh GetWindowLong; no message).</summary>
        public bool StyleSecure { get { return (Native.GetWindowLong(Window, GWL_STYLE) & ES_PASSWORD) != 0; } }

        /// <summary>The control is read-only right now (a fresh GetWindowLong; no message).</summary>
        public bool StyleReadOnly { get { return (Native.GetWindowLong(Window, GWL_STYLE) & ES_READONLY) != 0; } }

        /// <summary>
        /// EM_GETPASSWORDCHAR: true when the control masks its text (a RichEdit can be put in password
        /// mode by this message alone, without the style bit); null when it does not answer in time.
        /// </summary>
        public bool? PasswordCharSet()
        {
            long reply = Query(Window, EM_GETPASSWORDCHAR, QueryTimeoutMs);
            return reply < 0 ? (bool?)null : reply != 0;
        }

        /// <summary>The control's text length, answered by its UI thread; -1 when it does not answer in time.</summary>
        public long Length() { return Query(Window, Native.WM_GETTEXTLENGTH, QueryTimeoutMs); }

        /// <summary>Why the last selection read failed (diagnostics).</summary>
        public string LastSelectionError;

        /// <summary>The selection in the control's own positions; false when it cannot be read exactly.</summary>
        public bool Selection(out int start, out int end)
        {
            start = end = 0;
            long packed = Query(Window, Native.EM_GETSEL, QueryTimeoutMs);
            if (packed < 0) { LastSelectionError = "no answer"; return false; }
            start = (int)(packed & 0xFFFF);
            end = (int)((packed >> 16) & 0xFFFF);
            // 0xFFFF in either half means the offset did not fit (or the control returned -1).
            if (start == 0xFFFF || end == 0xFFFF || end < start) { LastSelectionError = "unreadable 0x" + packed.ToString("x"); return false; }
            return true;
        }

        /// <summary>The selection's length (0 for a caret); -1 when it cannot be read exactly.</summary>
        public int SelectionLength()
        {
            int start, end;
            return Selection(out start, out end) ? end - start : -1;
        }

        /// <summary>
        /// The control's whole text (WM_GETTEXT, answered by its UI thread; at most MaxLength units), kept
        /// in memory only to compare what was typed. Null when it does not answer in time.
        /// </summary>
        public string Text()
        {
            StringBuilder buffer = new StringBuilder(MaxLength + 1);
            IntPtr result;
            IntPtr ok = Native.SendMessageTimeout(Window, WM_GETTEXT, (IntPtr)(MaxLength + 1), buffer,
                Native.SMTO_ABORTIFHUNG | Native.SMTO_BLOCK, (uint)QueryTimeoutMs, out result);
            if (ok == IntPtr.Zero) return null;
            int length = (int)Math.Min(result.ToInt64(), buffer.Length);
            return buffer.ToString(0, Math.Max(0, length));
        }

        /// <summary>
        /// A position in the control's own units converted to an offset in Text(): a RichEdit counts a
        /// paragraph break as one position, WM_GETTEXT returns it as CR LF. -1 when out of range.
        /// </summary>
        public int OffsetInText(string text, int position)
        {
            if (!RichEdit) return position <= text.Length ? position : -1;
            int offset = 0;
            for (int p = 0; p < position; p++)
            {
                if (offset >= text.Length) return -1;
                offset += offset + 1 < text.Length && text[offset] == '\r' && text[offset + 1] == '\n' ? 2 : 1;
            }
            return offset;
        }

        /// <summary>
        /// After one key was sent with the length at `from`: true once the length reads exactly
        /// `expected`. False as soon as it reads anything else that is not `from` (the key did more or
        /// less than one key's worth: an autocomplete, an IME composition, a length limit), or when it
        /// has not moved within timeoutMs. With allowStep (a surrogate pair, delivered as two characters)
        /// the half-way length from + 1 is accepted on the way. `seen` is the last length read (-1: no answer).
        /// </summary>
        public bool WaitLength(long from, long expected, int timeoutMs, bool allowStep, out long seen)
        {
            Stopwatch watch = Stopwatch.StartNew();
            while (true)
            {
                seen = Query(Window, Native.WM_GETTEXTLENGTH, PollTimeoutMs);
                if (seen == expected) return true;
                bool halfway = allowStep && seen == from + 1 && expected == from + 2;
                if (seen >= 0 && seen != from && !halfway) return false;
                if (watch.ElapsedMilliseconds >= timeoutMs) return false;
                Thread.Sleep(1);
            }
        }
    }
}
