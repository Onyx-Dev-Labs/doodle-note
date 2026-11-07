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
        /// <summary>untouched | restored | user-changed | partial</summary>
        public string Clipboard = "untouched";
        public DeliveryTimings Timings;

        public DeliveryResult(DeliveryOutcome outcome, string reason) { Outcome = outcome; Reason = reason; }

        public Dictionary<string, object> Fields()
        {
            Dictionary<string, object> output = Wire.Fields("outcome", Outcome.ToString().ToLowerInvariant(), "verified", Verified, "clipboard", Clipboard);
            if (Reason != null) output["reason"] = Reason;
            if (Method != null) output["method"] = Method;
            if (Timings != null) output["timings"] = Timings.Fields();
            return output;
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
        public static DeliveryResult Deliver(TargetSnapshot snapshot, string text, DeliveryGuards guards, int deadlineMs = 0)
        {
            DeliveryTimings timings = new DeliveryTimings();
            DeliveryResult result = DeliverInner(snapshot, text, guards, timings, deadlineMs);
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
            // Per-character 8 ms + 70 ms at each word boundary (Delivery typing), plus confirm and settle.
            return normalized.Length * 16 + boundaries * 70 + 3000;
        }

        static DeliveryResult DeliverInner(TargetSnapshot snapshot, string text, DeliveryGuards guards, DeliveryTimings timings, int deadlineMs)
        {
            Stopwatch began = Stopwatch.StartNew();
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
            // when the clipboard cannot be opened. DICTATION_HELPER_STRATEGY=type is a test
            // switch for the fallback.
            bool forceType = Environment.GetEnvironmentVariable("DICTATION_HELPER_STRATEGY") == "type";
            // The client sized its wait from the text length; never begin an insertion it has
            // already given up on, or doubled text could land after the user pastes from the card.
            if (deadlineMs > 0 && !forceType && began.ElapsedMilliseconds + PasteEstimateMs > deadlineMs
                && began.ElapsedMilliseconds + TypeEstimateMs(text) > deadlineMs)
                return new DeliveryResult(DeliveryOutcome.Refused, "deadline-exceeded");
            if (!forceType)
            {
                if (deadlineMs == 0 || began.ElapsedMilliseconds + PasteEstimateMs <= deadlineMs)
                {
                    DeliveryResult pasted = Paste(text, current, snapshot, before, timings);
                    if (pasted != null) return pasted;
                }
            }
            if (deadlineMs > 0 && began.ElapsedMilliseconds + TypeEstimateMs(text) > deadlineMs)
                return new DeliveryResult(DeliveryOutcome.Refused, "deadline-exceeded");
            return TypeText(text, current, snapshot, before, timings);
        }

        /// <summary>Null when the clipboard could not be opened (nothing was attempted).</summary>
        static DeliveryResult Paste(string text, AutomationElement element, TargetSnapshot snapshot, ControlState before, DeliveryTimings timings)
        {
            Stopwatch insert = Stopwatch.StartNew();
            SavedClipboard saved = SavedClipboard.Capture();
            if (saved == null) return null;
            uint ours;
            if (!ClipboardText.Write(text, out ours))
            {
                saved.Restore(null);
                return null;
            }
            if (!ReleaseModifiers() || !StillOurs(snapshot))
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
            string clipboard = saved.Restore(ours);
            DeliveryResult result = verified
                ? new DeliveryResult(DeliveryOutcome.Delivered, null)
                : new DeliveryResult(DeliveryOutcome.Uncertain, "insertion-unverifiable");
            result.Method = "paste";
            result.Verified = verified;
            result.Clipboard = clipboard;
            return result;
        }

        static DeliveryResult TypeText(string text, AutomationElement element, TargetSnapshot snapshot, ControlState before, DeliveryTimings timings)
        {
            Stopwatch insert = Stopwatch.StartNew();
            if (!ReleaseModifiers() || !StillOurs(snapshot))
            {
                DeliveryResult moved = new DeliveryResult(DeliveryOutcome.Refused, "focus-changed");
                moved.Method = "type";
                return moved;
            }
            // One character per call with a short gap: text controls built on XAML and the
            // Text Services Framework drop Unicode keystrokes that arrive in a burst.
            string normalized = text.Replace("\r\n", "\n");
            int expected = 0;
            uint sent = 0;
            for (int i = 0; i < normalized.Length; i++)
            {
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
                // Word boundaries are where editors run spelling and suggestions; keystrokes
                // that arrive meanwhile were seen to be dropped (Windows 11 Notepad).
                Thread.Sleep(char.IsWhiteSpace(unit) || char.IsPunctuation(unit) ? 70 : 8);
            }
            timings.InsertMs += Ms(insert);
            if (sent == 0)
            {
                DeliveryResult failed = new DeliveryResult(DeliveryOutcome.Failed, "keystroke-unavailable");
                failed.Method = "type";
                return failed;
            }
            if (sent != expected)
            {
                DeliveryResult partial = new DeliveryResult(DeliveryOutcome.Uncertain, "insertion-unverifiable");
                partial.Method = "type";
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
            return result;
        }

        /// <summary>The foreground app and control are still the snapshot's, right before the keystroke.</summary>
        static bool StillOurs(TargetSnapshot snapshot)
        {
            AutomationElement ignored;
            return Target.StillFocused(snapshot, out ignored);
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
                if (Native.OpenClipboard(IntPtr.Zero)) return true;
                Thread.Sleep(15);
            }
            return false;
        }

        /// <summary>Put text on the clipboard, marked so clipboard history and sync skip it.</summary>
        public static bool Write(string text, out uint sequence)
        {
            sequence = 0;
            if (!Open()) return false;
            try
            {
                if (!Native.EmptyClipboard()) return false;
                if (!SetBytes(CF_UNICODETEXT, System.Text.Encoding.Unicode.GetBytes(text + "\0"))) return false;
                // Windows' own clipboard history and cloud clipboard, and clipboard
                // managers that honor it, leave entries with these formats alone.
                SetBytes(Native.RegisterClipboardFormat("ExcludeClipboardContentFromMonitorProcessing"), new byte[] { 0 });
                SetBytes(Native.RegisterClipboardFormat("CanIncludeInClipboardHistory"), BitConverter.GetBytes(0));
                SetBytes(Native.RegisterClipboardFormat("CanUploadToCloudClipboard"), BitConverter.GetBytes(0));
            }
            finally { Native.CloseClipboard(); }
            sequence = Native.GetClipboardSequenceNumber();
            return true;
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
    /// The user's clipboard, saved before a paste and put back afterwards. Only well-known,
    /// safe formats are copied (text, HTML, RTF, bitmaps, a file list, PNG); OLE private data
    /// and anything unknown is skipped, so nothing opaque is re-rendered as raw bytes. Total
    /// bytes and the time spent copying are capped, so a huge Excel or Photoshop clipboard
    /// cannot stall a delivery. When anything is skipped the restore reports it.
    /// </summary>
    internal sealed class SavedClipboard
    {
        const uint CF_TEXT = 1, CF_BITMAP = 2, CF_OEMTEXT = 7, CF_DIB = 8, CF_PALETTE = 9,
            CF_ENHMETAFILE = 14, CF_HDROP = 15, CF_LOCALE = 16, CF_UNICODETEXT = 13, CF_DIBV5 = 17;
        /// <summary>At most this many bytes are copied across all formats.</summary>
        const int MaxBytes = 16 * 1024 * 1024;
        /// <summary>At most this long is spent copying the clipboard.</summary>
        const int MaxMs = 300;
        readonly List<KeyValuePair<uint, byte[]>> items = new List<KeyValuePair<uint, byte[]>>();
        IntPtr metafile = IntPtr.Zero;
        bool complete = true;
        bool skipped;

        /// <summary>Standard formats worth saving by number.</summary>
        static readonly HashSet<uint> SafeStandard = new HashSet<uint>
        {
            CF_UNICODETEXT, CF_TEXT, CF_OEMTEXT, CF_DIB, CF_DIBV5, CF_HDROP, CF_LOCALE
        };
        /// <summary>Registered formats worth saving, by name (lower case).</summary>
        static readonly HashSet<string> SafeRegistered = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "html format", "rich text format", "png", "image/png", "jfif", "gif",
            "filenamew", "filename", "preferred dropeffect", "filegroupdescriptorw", "filegroupdescriptor"
        };
        /// <summary>Opaque OLE formats that must never be put back as raw bytes.</summary>
        static readonly HashSet<string> Unsafe = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "dataobject", "ole private data", "object descriptor", "embed source", "embedded object",
            "link source", "native", "ownerlink", "objectlink"
        };

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
                    if (watch.ElapsedMilliseconds > MaxMs) { saved.skipped = true; break; }
                    if (format == CF_BITMAP || format == CF_PALETTE)
                    {
                        // Windows rebuilds these from the device-independent bitmap.
                        if (!hasDib) saved.complete = false;
                        continue;
                    }
                    if (format == CF_ENHMETAFILE)
                    {
                        IntPtr handle = Native.GetClipboardData(format);
                        saved.metafile = handle != IntPtr.Zero ? Native.CopyEnhMetaFile(handle, IntPtr.Zero) : IntPtr.Zero;
                        if (saved.metafile == IntPtr.Zero) saved.complete = false;
                        continue;
                    }
                    bool safe;
                    if (format < 0xC000) safe = SafeStandard.Contains(format);
                    else
                    {
                        string name = FormatName(format);
                        if (Unsafe.Contains(name)) { saved.skipped = true; continue; }
                        safe = SafeRegistered.Contains(name);
                    }
                    if (!safe) { saved.skipped = true; continue; }
                    IntPtr data = Native.GetClipboardData(format);
                    if (data == IntPtr.Zero)
                    {
                        saved.complete = false; // promised data the owner did not render
                        continue;
                    }
                    int size = (int)Native.GlobalSize(data).ToUInt64();
                    if (size < 0 || total + size > MaxBytes) { saved.skipped = true; continue; }
                    IntPtr source = Native.GlobalLock(data);
                    if (source == IntPtr.Zero)
                    {
                        saved.complete = false;
                        continue;
                    }
                    byte[] bytes = new byte[size];
                    Marshal.Copy(source, bytes, 0, size);
                    Native.GlobalUnlock(data);
                    total += size;
                    saved.items.Add(new KeyValuePair<uint, byte[]>(format, bytes));
                }
            }
            finally { Native.CloseClipboard(); }
            return saved;
        }

        public int Count { get { return items.Count; } }
        public bool AnythingSkipped { get { return skipped; } }

        /// <summary>
        /// Restores only if nobody else wrote to the clipboard since `expecting`.
        /// restored: the clipboard is back as it was. skipped: some content was too large or
        /// not safe to hold, so part of the clipboard is gone. partial: some promised content
        /// could not be re-rendered. user-changed: someone else wrote to it meanwhile.
        /// </summary>
        public string Restore(uint? expecting)
        {
            if (expecting.HasValue && Native.GetClipboardSequenceNumber() != expecting.Value) return "user-changed";
            if (!ClipboardText.Open()) return "partial";
            bool ok = true;
            try
            {
                Native.EmptyClipboard();
                foreach (KeyValuePair<uint, byte[]> item in items)
                    if (!ClipboardText.SetBytes(item.Key, item.Value)) ok = false;
                if (metafile != IntPtr.Zero)
                {
                    if (Native.SetClipboardData(CF_ENHMETAFILE, metafile) == IntPtr.Zero) ok = false;
                    metafile = IntPtr.Zero;
                }
            }
            finally { Native.CloseClipboard(); }
            if (skipped) return "skipped";
            return ok && complete ? "restored" : "partial";
        }
    }
}
