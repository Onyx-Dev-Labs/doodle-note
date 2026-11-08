using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace DoodleNote.DictationHelper
{
    /// <summary>
    /// The user's saved clipboard, written down for the moment between our clipboard write and its
    /// restore, so a helper that ends in that moment (killed, crashed, or quitting without the restore)
    /// does not lose it: the next helper of the same identity puts it back. The record is encrypted
    /// for the current user (DPAPI), lives in the per-user %TEMP% under the identity's name, and is
    /// deleted as soon as the restore ran. It is put back only while the clipboard still provably holds
    /// our dictated text: its owner window is gone (the helper that wrote it ended) and its text hashes
    /// to the dictated text. Anything else means someone copied since, and their copy is left alone.
    /// </summary>
    internal static class PendingClipboard
    {
        const uint CF_UNICODETEXT = 13;
        static readonly byte[] Entropy = Encoding.UTF8.GetBytes("DoodleNote-Bark-clipboard-v1");
        static readonly object gate = new object();

        static string FilePath
        {
            get { return Path.Combine(Path.GetTempPath(), HelperIdentity.ClipboardStateFileName(HelperIdentity.Sanitized)); }
        }

        static byte[] Hash(string text)
        {
            using (SHA256 sha = SHA256.Create()) return sha.ComputeHash(Encoding.Unicode.GetBytes(text));
        }

        /// <summary>Write the record before our write empties the clipboard. False when it could not be written.</summary>
        public static bool Write(SavedClipboard saved, string dictated)
        {
            try
            {
                MemoryStream plain = new MemoryStream();
                using (BinaryWriter writer = new BinaryWriter(plain, Encoding.UTF8, true))
                {
                    writer.Write("DNCB1");
                    writer.Write(Process.GetCurrentProcess().Id);
                    writer.Write(Hash(dictated));
                    saved.WriteTo(writer);
                }
                byte[] sealedBytes = ProtectedData.Protect(plain.ToArray(), Entropy, DataProtectionScope.CurrentUser);
                lock (gate) File.WriteAllBytes(FilePath, sealedBytes);
                return true;
            }
            catch (Exception error)
            {
                Wire.Log("the saved clipboard could not be written down: " + error.GetType().Name);
                return false;
            }
        }

        /// <summary>The restore ran (whatever its outcome): the record is no longer needed.</summary>
        public static void Clear()
        {
            try { lock (gate) if (File.Exists(FilePath)) File.Delete(FilePath); }
            catch (Exception) { }
        }

        /// <summary>At start: a clipboard left holding an earlier helper's dictated text gets the user's content back.</summary>
        public static void RecoverLeftover()
        {
            byte[] plain;
            try
            {
                lock (gate)
                {
                    if (!File.Exists(FilePath)) return;
                    plain = ProtectedData.Unprotect(File.ReadAllBytes(FilePath), Entropy, DataProtectionScope.CurrentUser);
                }
            }
            catch (Exception)
            {
                Clear();
                return;
            }
            try
            {
                using (BinaryReader reader = new BinaryReader(new MemoryStream(plain), Encoding.UTF8))
                {
                    if (reader.ReadString() != "DNCB1") { Clear(); return; }
                    int pid = reader.ReadInt32();
                    byte[] hash = reader.ReadBytes(32);
                    // A helper of this identity that is still running owns the record: leave it alone.
                    if (pid != Process.GetCurrentProcess().Id && HelperRunning(pid)) return;
                    SavedClipboard saved = SavedClipboard.ReadFrom(reader);
                    Wire.Log("clipboard left by an earlier helper: " + PutBack(saved, hash));
                }
            }
            catch (Exception error) { Wire.Log("the saved clipboard record could not be read: " + error.GetType().Name); }
            Clear();
        }

        static bool HelperRunning(int pid)
        {
            try
            {
                using (Process other = Process.GetProcessById(pid))
                    return !other.HasExited && other.ProcessName.IndexOf("dictation-helper", StringComparison.OrdinalIgnoreCase) >= 0;
            }
            catch (Exception) { return false; }
        }

        static string PutBack(SavedClipboard saved, byte[] hash)
        {
            if (!ClipboardText.Open()) return "the clipboard could not be opened; left as it is";
            try
            {
                // Our dead helper's window owned our write; a live owner means someone copied since
                // (and reading their data could make them render). Leave theirs alone.
                IntPtr owner = Native.GetClipboardOwner();
                if (owner != IntPtr.Zero && Native.IsWindow(owner)) return "someone copied since; left as it is";
                string text = ReadText();
                if (text == null || !SameHash(Hash(text), hash)) return "it no longer holds the dictated text; left as it is";
                if (!Native.EmptyClipboard()) return "it could not be emptied; left as it is";
                return saved.PutBackOpen() ? "put back" : "put back in part";
            }
            finally { Native.CloseClipboard(); }
        }

        static string ReadText()
        {
            IntPtr data = Native.GetClipboardData(CF_UNICODETEXT);
            if (data == IntPtr.Zero) return null;
            long size = (long)Native.GlobalSize(data).ToUInt64();
            if (size <= 0 || size > 64 * 1024 * 1024) return null;
            IntPtr source = Native.GlobalLock(data);
            if (source == IntPtr.Zero) return null;
            try
            {
                string text = System.Runtime.InteropServices.Marshal.PtrToStringUni(source, (int)(size / 2));
                int nul = text.IndexOf('\0');
                return nul >= 0 ? text.Substring(0, nul) : text;
            }
            finally { Native.GlobalUnlock(data); }
        }

        static bool SameHash(byte[] a, byte[] b)
        {
            if (a == null || b == null || a.Length != b.Length) return false;
            int diff = 0;
            for (int i = 0; i < a.Length; i++) diff |= a[i] ^ b[i];
            return diff == 0;
        }
    }
}
