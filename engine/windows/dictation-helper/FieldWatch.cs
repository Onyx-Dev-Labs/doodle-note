using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Windows.Automation;

namespace DoodleNote.DictationHelper
{
    /// <summary>
    /// The field the last dictation was typed into, kept so the host can read it back
    /// for a few minutes and notice a correction. Only the element handle and the
    /// process id live here; the helper stores no text, and a secure field is never
    /// watched. At most one field is watched at a time. Port of FieldWatch.swift.
    /// </summary>
    internal sealed class FieldWatches
    {
        internal sealed class Watch
        {
            public string Id;
            public uint Pid;
            public AutomationElement Element;
            public DateTime Expires;
        }

        /// <summary>Long enough to edit and send a message; short enough that a forgotten handle does not linger.</summary>
        public static readonly TimeSpan Lifetime = TimeSpan.FromSeconds(300);
        readonly object gate = new object();
        Watch current;

        public void Start(string id, uint pid, AutomationElement element)
        {
            lock (gate)
            {
                current = new Watch { Id = id, Pid = pid, Element = element, Expires = DateTime.UtcNow + Lifetime };
            }
        }

        public Watch Get(string id)
        {
            lock (gate)
            {
                if (current == null || current.Id != id || current.Expires <= DateTime.UtcNow) return null;
                return current;
            }
        }

        public void Stop(string id)
        {
            lock (gate) { if (current != null && current.Id == id) current = null; }
        }
    }

    internal static class FieldRead
    {
        /// <summary>Longest field text the host is sent; a longer field is not read at all.</summary>
        public const int MaxCharacters = 20000;

        static bool Running(uint pid)
        {
            try { using (Process process = Process.GetProcessById((int)pid)) return !process.HasExited; }
            catch (ArgumentException) { return false; }
            catch (InvalidOperationException) { return false; }
            catch (System.ComponentModel.Win32Exception) { return true; }
        }

        /// <summary>
        /// ok: the text, and whether the field still has focus. gone: the field or its app no
        /// longer exists. secure: it became a password field. unreadable: the control does not
        /// expose its text. too-long: past MaxCharacters.
        /// </summary>
        public static Dictionary<string, object> Read(FieldWatches.Watch watch)
        {
            if (!Running(watch.Pid)) return Wire.Fields("state", "gone");
            string text;
            try
            {
                if (watch.Element.Current.IsPassword) return Wire.Fields("state", "secure");
                text = UIA.ReadValue(watch.Element, MaxCharacters);
            }
            catch (ElementNotAvailableException) { return Wire.Fields("state", "gone"); }
            if (text == null) return Wire.Fields("state", "unreadable");
            if (text.Length > MaxCharacters) return Wire.Fields("state", "too-long");
            IntPtr window;
            uint pid, thread;
            bool focused = Target.Foreground(out window, out pid, out thread) && pid == watch.Pid
                && UIA.Same(Target.FocusedIn(pid), watch.Element);
            return Wire.Fields("state", "ok", "value", text, "focused", focused);
        }
    }
}
