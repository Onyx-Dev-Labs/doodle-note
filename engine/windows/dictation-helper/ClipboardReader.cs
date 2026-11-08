using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace DoodleNote.DictationHelper
{
    /// <summary>
    /// Reading the user's clipboard before a paste, without the helper ever waiting on a blocking
    /// render. Reading a format the owner renders on demand (OLE "Embed Source" and the like) blocks
    /// inside GetClipboardData until the owner answers, and a thread blocked there cannot be
    /// interrupted. So the reads run in a separate reader process (this same executable, started with
    /// --clipboard-reader, only from the helper's own held image, and inheriting only its own pipes):
    /// one request per format, each OpenClipboard → GetClipboardData → copy → CloseClipboard (in a
    /// finally) with its own wall-clock bound. The reader opens the clipboard without an owner window,
    /// and measured on Dev04, another app's OpenClipboard succeeds at once even while the reader waits
    /// in a render. A read that overruns is abandoned and the save gives up: the reader is NOT killed,
    /// because ending it mid-render loses the format being rendered; it finishes the render, finds its
    /// stdin closed and exits (verified: the owner's "Embed Source" is still there after the render).
    /// At most MaxAbandoned readers may be waiting like that (past that, no save is attempted). A timer
    /// prunes them every few seconds; one is ended only if it is still waiting after AbandonedMaxMs AND
    /// the clipboard's owner is confirmed hung (IsHungAppWindow), when that render is not coming. Since
    /// other apps can write meanwhile, every read reports the clipboard sequence number taken after it,
    /// and any change since the list (or before the paste empties the clipboard) discards the save.
    /// The reader exits when its stdin closes, so it never outlives the helper.
    ///
    /// Reader protocol (one line each way per request):
    ///   "list"            → "list &lt;seq&gt; &lt;hasDib 0|1&gt; &lt;hasEmf 0|1&gt; &lt;format&gt;:&lt;base64 name&gt; …"   (or "busy")
    ///   "get &lt;f&gt; &lt;cap&gt;"    → "data &lt;f&gt; &lt;seq&gt; &lt;base64&gt;" | "emf &lt;f&gt; &lt;seq&gt; &lt;base64&gt;" | "none|oversize|unlocked &lt;f&gt; &lt;seq&gt;" | "busy"
    /// </summary>
    internal static class ClipboardReader
    {
        public const string Argument = "--clipboard-reader";
        const uint CF_DIB = 8, CF_DIBV5 = 17, CF_ENHMETAFILE = 14;

        static bool Open()
        {
            for (int attempt = 0; attempt < 12; attempt++)
            {
                if (Native.OpenClipboard(IntPtr.Zero)) return true;
                Thread.Sleep(15);
            }
            return false;
        }

        /// <summary>The reader process's main loop.</summary>
        public static int Serve()
        {
            StreamReader input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
            Stream output = Console.OpenStandardOutput();
            string line;
            while ((line = input.ReadLine()) != null)
            {
                string reply;
                try { reply = Answer(line.Trim()); }
                catch (Exception) { reply = "busy"; }
                byte[] bytes = new UTF8Encoding(false).GetBytes(reply + "\n");
                output.Write(bytes, 0, bytes.Length);
                output.Flush();
            }
            return 0;
        }

        static string Answer(string request)
        {
            string[] parts = request.Split(' ');
            if (parts[0] == "list")
            {
                if (!Open()) return "busy";
                try
                {
                    StringBuilder reply = new StringBuilder("list ");
                    reply.Append(Native.GetClipboardSequenceNumber()).Append(' ');
                    reply.Append(Native.IsClipboardFormatAvailable(CF_DIB) || Native.IsClipboardFormatAvailable(CF_DIBV5) ? "1 " : "0 ");
                    reply.Append(Native.IsClipboardFormatAvailable(CF_ENHMETAFILE) ? "1" : "0");
                    // Enumerating renders nothing; names are looked up without the clipboard.
                    for (uint format = Native.EnumClipboardFormats(0); format != 0; format = Native.EnumClipboardFormats(format))
                        reply.Append(' ').Append(format).Append(':').Append(Convert.ToBase64String(Encoding.UTF8.GetBytes(SavedClipboard.FormatName(format))));
                    return reply.ToString();
                }
                finally { Native.CloseClipboard(); }
            }
            if (parts[0] == "get" && parts.Length == 3)
            {
                uint format = uint.Parse(parts[1]);
                long cap = long.Parse(parts[2]);
                int delay = TestMode.Int("DICTATION_HELPER_TEST_CAPTURE_DELAY_MS", 0);
                if (!Open()) return "busy";
                try
                {
                    // Test build only: a slow read inside the open clipboard, like a slow renderer.
                    if (delay > 0) Thread.Sleep(delay);
                    IntPtr data = Native.GetClipboardData(format);
                    // The sequence number is read AFTER the read: a render does not move it, but anyone
                    // writing meanwhile does, and the helper then discards the whole save.
                    if (data == IntPtr.Zero) return "none " + format + " " + Native.GetClipboardSequenceNumber();
                    if (format == CF_ENHMETAFILE)
                    {
                        uint size = Native.GetEnhMetaFileBits(data, 0, null);
                        if (size == 0 || size > cap) return "oversize " + format + " " + Native.GetClipboardSequenceNumber();
                        byte[] bits = new byte[size];
                        if (Native.GetEnhMetaFileBits(data, size, bits) != size) return "unlocked " + format + " " + Native.GetClipboardSequenceNumber();
                        return "emf " + format + " " + Native.GetClipboardSequenceNumber() + " " + Convert.ToBase64String(bits);
                    }
                    long length = (long)Native.GlobalSize(data).ToUInt64();
                    if (length <= 0 || length > cap) return "oversize " + format + " " + Native.GetClipboardSequenceNumber();
                    IntPtr source = Native.GlobalLock(data);
                    if (source == IntPtr.Zero) return "unlocked " + format + " " + Native.GetClipboardSequenceNumber();
                    byte[] bytes = new byte[(int)length];
                    try { Marshal.Copy(source, bytes, 0, (int)length); }
                    finally { Native.GlobalUnlock(data); }
                    return "data " + format + " " + Native.GetClipboardSequenceNumber() + " " + Convert.ToBase64String(bytes);
                }
                finally { Native.CloseClipboard(); }
            }
            return "busy";
        }
    }

    /// <summary>The helper's side of the reader process: started on demand, ended on any overrun.</summary>
    internal sealed class ClipboardReaderClient
    {
        static readonly object gate = new object();
        static ClipboardReaderClient shared;
        /// <summary>Readers given up on while they wait in an owner's render (they exit when it returns).</summary>
        static readonly List<ClipboardReaderClient> abandoned = new List<ClipboardReaderClient>();
        public const int MaxAbandoned = 2;
        const int AbandonedMaxMs = 30000;
        readonly Stopwatch age = new Stopwatch();
        /// <summary>Prunes abandoned readers on its own, not only when the next save asks.</summary>
        static Timer pruneTimer;

        readonly ReaderProcess process;
        readonly BlockingCollection<string> lines = new BlockingCollection<string>();

        ClipboardReaderClient(ReaderProcess process)
        {
            this.process = process;
            Thread thread = new Thread(delegate ()
            {
                try
                {
                    string line;
                    while ((line = process.StandardOutput.ReadLine()) != null) lines.Add(line);
                }
                catch (Exception) { }
                finally { lines.CompleteAdding(); }
            });
            thread.IsBackground = true;
            thread.Name = "clipboard-reader-out";
            thread.Start();
        }

        /// <summary>The running reader, started if needed; null when it cannot be started.</summary>
        public static ClipboardReaderClient Get()
        {
            lock (gate)
            {
                if (shared != null && !shared.Exited) return shared;
                shared = null;
                Prune();
                if (!SelfImage.Held)
                {
                    Wire.Log("the helper image is not held; not starting a clipboard reader (no save, no paste)");
                    return null;
                }
                if (abandoned.Count >= MaxAbandoned)
                {
                    Wire.Log("clipboard readers are still waiting on a slow owner; not saving the clipboard");
                    return null;
                }
                try
                {
                    ReaderProcess process = ReaderProcess.Start(SelfImage.Path, ClipboardReader.Argument);
                    if (process == null) return null;
                    shared = new ClipboardReaderClient(process);
                    return shared;
                }
                catch (Exception error)
                {
                    Wire.Log("clipboard reader did not start: " + error.Message);
                    return null;
                }
            }
        }

        bool Exited
        {
            get
            {
                try { return process.HasExited(); }
                catch (Exception) { return true; }
            }
        }

        /// <summary>One request; null when the reader did not answer within timeoutMs (it is then abandoned).</summary>
        public string Request(string request, int timeoutMs)
        {
            string answer;
            try
            {
                process.StandardInput.WriteLine(request);
                process.StandardInput.Flush();
            }
            catch (Exception)
            {
                End();
                return null;
            }
            if (lines.TryTake(out answer, Math.Max(1, timeoutMs))) return answer;
            Abandon();
            return null;
        }

        /// <summary>
        /// Give up on a reader that is waiting in a render: no new requests, its stdin closed so it exits
        /// once the render returns (the owner's content stays whole).
        /// </summary>
        void Abandon()
        {
            lock (gate)
            {
                if (shared == this) shared = null;
                age.Restart();
                abandoned.Add(this);
                if (pruneTimer == null) pruneTimer = new Timer(delegate { lock (gate) Prune(); }, null, 5000, 5000);
            }
            try { process.StandardInput.Close(); } catch (Exception) { }
            Wire.Log("clipboard reader abandoned while its owner renders (" + AbandonedCount + " waiting)");
        }

        /// <summary>
        /// Forget readers that exited. End one only if it has waited past AbandonedMaxMs and the
        /// clipboard's owner is confirmed hung (its render is not coming). Under gate.
        /// </summary>
        static void Prune()
        {
            for (int i = abandoned.Count - 1; i >= 0; i--)
            {
                ClipboardReaderClient reader = abandoned[i];
                if (reader.Exited) { abandoned.RemoveAt(i); try { reader.process.Dispose(); } catch (Exception) { } }
                else if (reader.age.ElapsedMilliseconds > AbandonedMaxMs && OwnerHung()) { abandoned.RemoveAt(i); reader.End(); }
            }
            if (abandoned.Count == 0 && pruneTimer != null) { pruneTimer.Dispose(); pruneTimer = null; }
        }

        static bool OwnerHung()
        {
            IntPtr owner = Native.GetClipboardOwner();
            return owner != IntPtr.Zero && Native.IsHungAppWindow(owner);
        }

        public static int AbandonedCount { get { lock (gate) { Prune(); return abandoned.Count; } } }

        /// <summary>End the reader now: a read blocked in a render releases the clipboard with it.</summary>
        void End()
        {
            lock (gate) { if (shared == this) shared = null; }
            Stopwatch watch = Stopwatch.StartNew();
            try { process.Kill(); } catch (Exception) { }
            bool exited = false;
            try { exited = process.WaitForExit(1000); } catch (Exception) { }
            Wire.Log("clipboard reader ended (" + (exited ? "exited" : "still exiting") + " after " + watch.ElapsedMilliseconds + " ms)");
            try { process.Dispose(); } catch (Exception) { }
        }

        /// <summary>End the shared reader, if any (helper shutdown).</summary>
        public static void Shutdown()
        {
            ClipboardReaderClient current;
            List<ClipboardReaderClient> waiting;
            lock (gate)
            {
                current = shared;
                shared = null;
                waiting = new List<ClipboardReaderClient>(abandoned);
                abandoned.Clear();
            }
            if (current != null)
            {
                try { current.process.StandardInput.Close(); } catch (Exception) { }
                current.End();
            }
            foreach (ClipboardReaderClient reader in waiting) reader.End();
        }
    }

    /// <summary>
    /// The reader process, created with an EXPLICIT inheritance list (PROC_THREAD_ATTRIBUTE_HANDLE_LIST)
    /// holding only its own three pipe ends, so it can never inherit any other handle of the helper (in
    /// particular the app's pipes: a reader still waiting in a render would otherwise keep the app from
    /// seeing the helper's output close when the helper ends).
    /// </summary>
    internal sealed class ReaderProcess : IDisposable
    {
        [StructLayout(LayoutKind.Sequential)] struct SECURITY_ATTRIBUTES { public int nLength; public IntPtr lpSecurityDescriptor; public int bInheritHandle; }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct STARTUPINFO
        {
            public int cb; public string lpReserved, lpDesktop, lpTitle; public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
            public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
        }
        [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }
        [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool CreatePipe(out IntPtr read, out IntPtr write, ref SECURITY_ATTRIBUTES sa, int size);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, int flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returnSize);
        [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern bool CreateProcess(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, int flags, IntPtr env, string dir, ref STARTUPINFOEX si, out PROCESS_INFORMATION pi);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr process, uint code);
        [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint ms);
        const int EXTENDED_STARTUPINFO_PRESENT = 0x80000, CREATE_NO_WINDOW = 0x08000000, STARTF_USESTDHANDLES = 0x100;
        static readonly IntPtr PROC_THREAD_ATTRIBUTE_HANDLE_LIST = (IntPtr)0x20002;

        IntPtr handle;
        public StreamWriter StandardInput { get; private set; }
        public StreamReader StandardOutput { get; private set; }

        public static ReaderProcess Start(string path, string argument)
        {
            SECURITY_ATTRIBUTES sa = new SECURITY_ATTRIBUTES { nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)), bInheritHandle = 1 };
            IntPtr inRead, inWrite, outRead, outWrite;
            if (!CreatePipe(out inRead, out inWrite, ref sa, 0)) return null;
            if (!CreatePipe(out outRead, out outWrite, ref sa, 0)) { Native.CloseHandle(inRead); Native.CloseHandle(inWrite); return null; }
            // Our ends stay here.
            Native.SetHandleInformation(inWrite, Native.HANDLE_FLAG_INHERIT, 0);
            Native.SetHandleInformation(outRead, Native.HANDLE_FLAG_INHERIT, 0);
            IntPtr size = IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
            IntPtr list = Marshal.AllocHGlobal(size);
            IntPtr handles = Marshal.AllocHGlobal(IntPtr.Size * 2);
            try
            {
                if (!InitializeProcThreadAttributeList(list, 1, 0, ref size)) { Native.CloseHandle(inWrite); Native.CloseHandle(outRead); return null; }
                Marshal.WriteIntPtr(handles, 0, inRead);
                Marshal.WriteIntPtr(handles, IntPtr.Size, outWrite);
                if (!UpdateProcThreadAttribute(list, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, handles, (IntPtr)(IntPtr.Size * 2), IntPtr.Zero, IntPtr.Zero))
                { DeleteProcThreadAttributeList(list); Native.CloseHandle(inWrite); Native.CloseHandle(outRead); return null; }
                STARTUPINFOEX si = new STARTUPINFOEX();
                si.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
                si.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
                si.StartupInfo.hStdInput = inRead;
                si.StartupInfo.hStdOutput = outWrite;
                si.StartupInfo.hStdError = outWrite; // it writes nothing there
                si.lpAttributeList = list;
                PROCESS_INFORMATION pi;
                StringBuilder command = new StringBuilder("\"" + path + "\" " + argument);
                bool ok = CreateProcess(path, command, IntPtr.Zero, IntPtr.Zero, true, EXTENDED_STARTUPINFO_PRESENT | CREATE_NO_WINDOW, IntPtr.Zero, null, ref si, out pi);
                DeleteProcThreadAttributeList(list);
                if (!ok)
                {
                    Wire.Log("clipboard reader did not start (" + Marshal.GetLastWin32Error() + ")");
                    Native.CloseHandle(inWrite); Native.CloseHandle(outRead);
                    return null;
                }
                Native.CloseHandle(pi.hThread);
                ReaderProcess process = new ReaderProcess();
                process.handle = pi.hProcess;
                process.StandardInput = new StreamWriter(new FileStream(new Microsoft.Win32.SafeHandles.SafeFileHandle(inWrite, true), FileAccess.Write), new UTF8Encoding(false));
                process.StandardOutput = new StreamReader(new FileStream(new Microsoft.Win32.SafeHandles.SafeFileHandle(outRead, true), FileAccess.Read), new UTF8Encoding(false));
                return process;
            }
            finally
            {
                // The child's ends belong to the child now (or to nobody, on failure).
                Native.CloseHandle(inRead);
                Native.CloseHandle(outWrite);
                Marshal.FreeHGlobal(handles);
                Marshal.FreeHGlobal(list);
            }
        }

        public bool HasExited() { return handle == IntPtr.Zero || WaitForSingleObject(handle, 0) == 0; }
        public void Kill() { if (handle != IntPtr.Zero) TerminateProcess(handle, 1); }
        public bool WaitForExit(int ms) { return handle == IntPtr.Zero || WaitForSingleObject(handle, (uint)ms) == 0; }

        public void Dispose()
        {
            try { StandardInput.Dispose(); } catch (Exception) { }
            try { StandardOutput.Dispose(); } catch (Exception) { }
            if (handle != IntPtr.Zero) { Native.CloseHandle(handle); handle = IntPtr.Zero; }
        }
    }

    /// <summary>
    /// The helper's own executable, held open with writing, renaming and deleting denied for the
    /// helper's lifetime, so the clipboard reader it starts from that path runs the same verified bytes
    /// the app started.
    /// </summary>
    internal static class SelfImage
    {
        static FileStream held;
        public static readonly string Path = System.Windows.Forms.Application.ExecutablePath;

        public static void Hold()
        {
            try { held = new FileStream(Path, FileMode.Open, FileAccess.Read, FileShare.Read); }
            catch (Exception error) { Wire.Log("could not hold the helper image: " + error.Message); }
        }

        /// <summary>Whether the image is held (the reader may only be started from a held image).</summary>
        public static bool Held { get { return held != null; } }
    }
}
