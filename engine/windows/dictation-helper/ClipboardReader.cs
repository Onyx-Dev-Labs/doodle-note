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
    /// finally) with its own wall-clock bound. Round 21: the reader opens the clipboard with its own message-only
    /// window (it opened with NULL before; then another app's OpenClipboard succeeded at once even while the reader
    /// waited in a render, which is also how the reader could lose its open). A read that overruns is abandoned and the save gives up: the reader is NOT killed,
    /// because ending it mid-render loses the format being rendered; it finishes the render, finds its
    /// stdin closed and exits (verified: the owner's "Embed Source" is still there after the render).
    /// At most MaxAbandoned readers may be waiting like that; reaching it asks for a helper restart
    /// through the safe path (between deliveries; the waiting readers are left to finish). A timer
    /// prunes them every few seconds; one is ended only if it is still waiting after AbandonedMaxMs
    /// (120 s) AND the owner it was waiting on when the read was sent is reported hung (IsHungAppWindow).
    /// The helper's own exit (quit or restart) closes their stdin and never kills one. Since
    /// other apps can write meanwhile, every read reports the clipboard sequence number taken after it,
    /// and any change since the list (or before the paste empties the clipboard) discards the save.
    /// The reader exits when its stdin closes, so it never outlives the helper.
    ///
    /// Reader protocol (round 21; one line each way per request, every reply framed and ending with " end", every
    /// request starting with an id the reply echoes, so a late reply or a fragment can never answer a request):
    ///   "&lt;id&gt; list"          → "&lt;id&gt; list &lt;seq before&gt; &lt;counted&gt; &lt;enumeration error&gt; &lt;seq after&gt; &lt;listed&gt; &lt;format&gt;:&lt;base64 name&gt; … end"
    ///                           (counted: CountClipboardFormats inside the reader's own open)
    ///   "&lt;id&gt; get &lt;f&gt; &lt;cap&gt;" → "&lt;id&gt; data|emf &lt;f&gt; &lt;seq&gt; &lt;length&gt; &lt;base64&gt; end" | "&lt;id&gt; oversize &lt;f&gt; &lt;seq&gt; &lt;size&gt; end"
    ///                           | "&lt;id&gt; none|unlocked|nosize &lt;f&gt; &lt;seq&gt; &lt;error&gt; end"
    ///   and "&lt;id&gt; lost end" (another opener took the clipboard over) or "&lt;id&gt; busy end".
    /// The reader opens the clipboard with its own message-only window and proves the hold before trusting any result
    /// (round 21: a NULL-window open can be taken over by another opener).
    /// </summary>
    internal static class ClipboardReader
    {
        public const string Argument = "--clipboard-reader";
        const uint CF_ENHMETAFILE = 14;

        /// <summary>
        /// Round 21: the reader's OWN message-only window. It opens the clipboard with it (never with a NULL window,
        /// which another opener can take over) and proves before trusting any result, and before it closes, that it
        /// still has the clipboard open (GetOpenClipboardWindow() == this window). A lost hold is a failed capture.
        /// </summary>
        static System.Windows.Forms.NativeWindow window;
        static IntPtr Window
        {
            get
            {
                if (window == null)
                {
                    try
                    {
#if DICTATION_TEST
                        if (TestMode.Env("DICTATION_HELPER_TEST_READER") == "no-window") return IntPtr.Zero; // test build only
#endif
                        System.Windows.Forms.CreateParams parameters = new System.Windows.Forms.CreateParams();
                        parameters.Parent = new IntPtr(-3); // HWND_MESSAGE
                        System.Windows.Forms.NativeWindow created = new System.Windows.Forms.NativeWindow();
                        created.CreateHandle(parameters);
                        if (created.Handle != IntPtr.Zero) window = created;
                    }
                    catch (Exception) { }
                }
                return window != null ? window.Handle : IntPtr.Zero;
            }
        }

        static bool Open()
        {
            IntPtr own = Window;
            if (own == IntPtr.Zero) return false; // round 22: never a NULL-window open (it can be taken over): busy, not established
            for (int attempt = 0; attempt < 12; attempt++)
            {
                if (Native.OpenClipboard(own)) return true;
                Thread.Sleep(15);
            }
            return false;
        }

        /// <summary>This reader still has the clipboard open (nobody took the open over).</summary>
        static bool Holds() { return Window != IntPtr.Zero && Native.GetOpenClipboardWindow() == Window; }

        /// <summary>The reader process's main loop. Its stderr is a separate handle (the NUL device), never the reply pipe.</summary>
        public static int Serve()
        {
            StreamReader input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
            Stream output = Console.OpenStandardOutput();
            string line;
            while ((line = input.ReadLine()) != null)
            {
                string trimmed = line.Trim();
                int space = trimmed.IndexOf(' ');
                string id = space > 0 ? trimmed.Substring(0, space) : trimmed;
                string reply;
                try { reply = id + " " + AnswerRequest(space > 0 ? trimmed.Substring(space + 1) : ""); }
                catch (Exception) { reply = id + " busy end"; }
#if DICTATION_TEST
                string hook = TestMode.Env("DICTATION_HELPER_TEST_READER") ?? "";
                // Test build only: a stray line before the reply (a late reply), or a fragment and then the end (EOF).
                if (hook == "stray-line") reply = "0 list 1 0 0 0 0 1 0 end\n" + reply;
                if (hook == "fragment-list" && reply.Contains(" list ")) { WriteRaw(output, reply.Substring(0, reply.Length / 2)); return 3; }
#endif
                if (!WriteRaw(output, reply + "\n")) return 0;
            }
            return 0;
        }

        static bool WriteRaw(Stream output, string text)
        {
            byte[] bytes = new UTF8Encoding(false).GetBytes(text);
            // The helper may have exited while this reader finished a render: nobody is listening.
            try
            {
                output.Write(bytes, 0, bytes.Length);
                output.Flush();
                return true;
            }
            catch (IOException) { return false; }
        }

        /// <summary>
        /// One request (without its id). Every reply is framed and ends with " end": "list ...", "data/emf f seq len
        /// base64", "oversize f seq size", "none|unlocked|nosize f seq error", "lost", "busy". Every result is taken
        /// only while this reader provably still has the clipboard open.
        /// </summary>
        static string AnswerRequest(string request)
        {
            string[] parts = request.Split(' ');
#if DICTATION_TEST
            string hook = TestMode.Env("DICTATION_HELPER_TEST_READER") ?? "";
#else
            string hook = "";
#endif
            if (parts[0] == "list")
            {
                if (!Open()) return "busy end";
                try
                {
                    uint before = Native.GetClipboardSequenceNumber();
                    int counted = Native.CountClipboardFormats(); // inside THIS open
                    // Enumerating renders nothing; names are looked up without the clipboard. A 0 is the end only with
                    // ERROR_SUCCESS (cleared right before each step, captured right after it).
                    StringBuilder entries = new StringBuilder();
                    int listed = 0;
                    uint format = 0;
                    int error;
                    for (;;)
                    {
                        Native.ClearLastError(0);
                        format = Native.EnumClipboardFormats(format);
                        if (format == 0) { error = Marshal.GetLastWin32Error(); break; }
                        listed++;
                        entries.Append(' ').Append(format).Append(':').Append(Convert.ToBase64String(Encoding.UTF8.GetBytes(SavedClipboard.FormatName(format))));
                        if (hook == "enum-error-mid") { error = 1418; break; } // test build only: the enumeration stops after one
                    }
                    uint after = Native.GetClipboardSequenceNumber();
                    if (hook == "enum-error") { error = 1418; entries.Length = 0; listed = 0; } // test build only
                    if (hook == "list-empty") { entries.Length = 0; listed = 0; }                 // test build only
                    if (hook == "no-name") entries.Replace(":" + Convert.ToBase64String(Encoding.UTF8.GetBytes("DoodleNote.CI.Extra")), ":"); // test build only
                    if (hook == "no-colon") entries.Replace(":", "");                               // test build only
                    if (hook == "lose-hold-list") Native.CloseClipboard();                         // test build only: the open is gone
                    if (!Holds()) return "lost end";
                    return "list " + before + " " + counted + " " + error + " " + after + " " + listed + entries + " end";
                }
                finally { if (Holds()) Native.CloseClipboard(); }
            }
            if (parts[0] == "get" && parts.Length == 3)
            {
                uint format = uint.Parse(parts[1]);
                long cap = long.Parse(parts[2]);
                int delay = TestMode.Int("DICTATION_HELPER_TEST_CAPTURE_DELAY_MS", 0);
                if (hook == "die-mid-reply") { Stream raw = Console.OpenStandardOutput(); raw.Write(new byte[] { 100, 97, 116 }, 0, 3); raw.Flush(); Environment.Exit(3); } // test build only: "dat", then gone
                if (!Open()) return "busy end";
                try
                {
                    // Test build only: a slow read inside the open clipboard, like a slow renderer.
                    if (delay > 0) Thread.Sleep(delay);
                    Native.ClearLastError(0);
                    IntPtr data = hook == "get-none" ? IntPtr.Zero : Native.GetClipboardData(format);
                    int error = Marshal.GetLastWin32Error();
                    if (hook == "lose-hold-get") Native.CloseClipboard(); // test build only: the open is gone
                    // The sequence number is read AFTER the read: a render does not move it, but anyone writing
                    // meanwhile does, and the helper then discards the whole save.
                    uint seq = Native.GetClipboardSequenceNumber();
                    if (!Holds()) return "lost end";
                    if (data == IntPtr.Zero) return "none " + format + " " + seq + " " + error + " end";
                    if (format == CF_ENHMETAFILE)
                    {
                        uint size = Native.GetEnhMetaFileBits(data, 0, null);
                        if (size == 0) return "nosize " + format + " " + seq + " " + Marshal.GetLastWin32Error() + " end";
                        if (size > cap) return "oversize " + format + " " + seq + " " + size + " end";
                        byte[] bits = new byte[size];
                        if (Native.GetEnhMetaFileBits(data, size, bits) != size) return "unlocked " + format + " " + seq + " 0 end";
                        if (!Holds()) return "lost end";
                        return "emf " + format + " " + seq + " " + size + " " + Convert.ToBase64String(bits) + " end";
                    }
                    Native.ClearLastError(0);
                    long length = hook == "size-zero" ? 0 : (long)Native.GlobalSize(data).ToUInt64();
                    if (length <= 0) return "nosize " + format + " " + seq + " " + Marshal.GetLastWin32Error() + " end"; // zero is not a size
                    if (length > cap) return "oversize " + format + " " + seq + " " + length + " end";
                    Native.ClearLastError(0);
                    IntPtr source = Native.GlobalLock(data);
                    if (source == IntPtr.Zero) return "unlocked " + format + " " + seq + " " + Marshal.GetLastWin32Error() + " end";
                    byte[] bytes = new byte[(int)length];
                    try { Marshal.Copy(source, bytes, 0, (int)length); }
                    finally { Native.GlobalUnlock(data); }
                    if (!Holds()) return "lost end";
                    return "data " + format + " " + seq + " " + length + " " + Convert.ToBase64String(bytes) + " end";
                }
                finally { if (Holds()) Native.CloseClipboard(); }
            }
            return "busy end";
        }
    }

    /// <summary>The helper's side of the reader process: started on demand; on an overrun it is ABANDONED (left to finish a render, never killed), and a generation whose capture was not established is retired.</summary>
    internal sealed class ClipboardReaderClient
    {
        static readonly object gate = new object();
        static ClipboardReaderClient shared;
        /// <summary>Readers given up on while they wait in an owner's render (they exit when it returns).</summary>
        static readonly List<ClipboardReaderClient> abandoned = new List<ClipboardReaderClient>();
        public const int MaxAbandoned = 2;
        /// <summary>A waiting reader may be ended only past this AND with its owner hung (a hung owner can still finish later).</summary>
        const int AbandonedMaxMs = 120000;
        /// <summary>How long an exit waits for the idle shared reader to leave once its stdin is closed.</summary>
        public const int IdleExitWaitMs = 500;
        /// <summary>The clipboard owner when the current request was sent (the render it may wait on).</summary>
        IntPtr requestOwner;
        readonly Stopwatch age = new Stopwatch();
        /// <summary>The clipboard owner whose render this reader was waiting on when it was abandoned.</summary>
        IntPtr waitedOwner;
        /// <summary>Prunes abandoned readers on its own, not only when the next save asks.</summary>
        static Timer pruneTimer;
        /// <summary>
        /// Raised (once) when MaxAbandoned readers are waiting: the helper could no longer save the
        /// clipboard at all, so it asks for a restart through the safe path (Program).
        /// </summary>
        public static event Action Exhausted;
        static int exhaustedRaised;

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
                    Wire.Log("clipboard readers are still waiting on a slow owner; not saving the clipboard (asking for a restart)");
                    Action handler = Exhausted;
                    if (handler != null && Interlocked.Exchange(ref exhaustedRaised, 1) == 0) ThreadPool.QueueUserWorkItem(delegate { handler(); });
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

        int nextId;

        /// <summary>A reader whose capture was not established is retired: never asked again (a fresh one next time).</summary>
        public void Retire() { End(); } // it answered (it is not waiting in a render): ending it loses nothing

        /// <summary>
        /// One request; null when the reader did not answer within timeoutMs (it is then abandoned) or ended. Every
        /// request carries an id the reply must echo (round 20): a line with another id (a late reply, a stray line)
        /// is never taken as this request's answer; it ends this reader and answers "out-of-order" (not established).
        /// </summary>
        public string Request(string request, int timeoutMs)
        {
            string answer;
            string id = (++nextId).ToString();
            requestOwner = Native.GetClipboardOwner();
            try
            {
                process.StandardInput.WriteLine(id + " " + request);
                process.StandardInput.Flush();
            }
            catch (Exception)
            {
                End();
                return null;
            }
            if (!lines.TryTake(out answer, Math.Max(1, timeoutMs)))
            {
                if (lines.IsCompleted) { End(); return null; } // the reader ended (killed, or died mid-reply)
                Abandon();
                return null;
            }
            // A complete framed reply: this request's id first, " end" last (a fragment at EOF has no end).
            if (answer.StartsWith(id + " ", StringComparison.Ordinal) && answer.EndsWith(" end", StringComparison.Ordinal))
                return answer.Substring(id.Length + 1, answer.Length - id.Length - 1 - 4);
            Wire.Log("clipboard reader: a reply out of order or malformed (" + Math.Min(answer.Length, 40) + " chars, not this request's id); this reader is ended");
            End();
            return "out-of-order";
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
                // The owner sampled when the blocking read was sent, not now.
                waitedOwner = requestOwner;
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
                else if (reader.MayEnd) { abandoned.RemoveAt(i); reader.End(); }
            }
            if (abandoned.Count == 0 && pruneTimer != null) { pruneTimer.Dispose(); pruneTimer = null; }
        }

        /// <summary>
        /// Waiting past AbandonedMaxMs (120 s) on an owner reported hung (the one it was waiting on when
        /// the read was sent, not whoever owns the clipboard now). Only the prune timer ends such a
        /// reader, so that a stuck owner cannot hold readers forever; an exit never does.
        /// </summary>
        bool MayEnd
        {
            get
            {
                IntPtr owner = waitedOwner;
                return age.ElapsedMilliseconds > AbandonedMaxMs && owner != IntPtr.Zero
                    && Native.IsWindow(owner) && Native.IsHungAppWindow(owner);
            }
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

        /// <summary>
        /// Helper exit (quit, or a restart): every reader's stdin is closed, so an idle one exits at once
        /// and one still waiting in a render exits when that render returns (the owner's format stays
        /// whole). None is killed on exit.
        /// </summary>
        public static void Shutdown()
        {
            List<ClipboardReaderClient> waiting;
            ClipboardReaderClient idle;
            lock (gate)
            {
                waiting = new List<ClipboardReaderClient>(abandoned);
                idle = shared;
                shared = null;
                abandoned.Clear();
                if (pruneTimer != null) { pruneTimer.Dispose(); pruneTimer = null; }
            }
            // The shared reader is idle between saves (no delivery runs now): its stdin closing ends it.
            if (idle != null)
            {
                try { idle.process.StandardInput.Close(); } catch (Exception) { }
                try { idle.process.WaitForExit(IdleExitWaitMs); } catch (Exception) { }
            }
            // Never killed on exit: a reader still waiting in a render finishes it (and the owner's
            // format with it) and leaves on its own; "hung" is no proof the render will not come.
            int left = 0;
            foreach (ClipboardReaderClient reader in waiting)
            {
                try { reader.process.StandardInput.Close(); } catch (Exception) { }
                if (!reader.Exited) left++;
            }
            if (left > 0) Wire.Log(left + " abandoned clipboard reader(s) still waiting on a render are left to finish on their own");
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
        static extern IntPtr CreateFileW(string name, uint access, uint share, ref SECURITY_ATTRIBUTES sa, uint disposition, uint flags, IntPtr template);
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
            // Round 21: the reader's stderr is its own handle (the NUL device), never the reply pipe: any line it wrote
            // there would otherwise be taken as a reply.
            IntPtr errWrite = CreateFileW("NUL", 0x40000000 /* GENERIC_WRITE */, 3 /* share read|write */, ref sa, 3 /* OPEN_EXISTING */, 0, IntPtr.Zero);
            if (errWrite == new IntPtr(-1)) { Native.CloseHandle(inRead); Native.CloseHandle(inWrite); Native.CloseHandle(outRead); Native.CloseHandle(outWrite); return null; }
            // Our ends stay here.
            Native.SetHandleInformation(inWrite, Native.HANDLE_FLAG_INHERIT, 0);
            Native.SetHandleInformation(outRead, Native.HANDLE_FLAG_INHERIT, 0);
            IntPtr size = IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
            IntPtr list = Marshal.AllocHGlobal(size);
            IntPtr handles = Marshal.AllocHGlobal(IntPtr.Size * 3);
            try
            {
                if (!InitializeProcThreadAttributeList(list, 1, 0, ref size)) { Native.CloseHandle(inWrite); Native.CloseHandle(outRead); return null; }
                Marshal.WriteIntPtr(handles, 0, inRead);
                Marshal.WriteIntPtr(handles, IntPtr.Size, outWrite);
                Marshal.WriteIntPtr(handles, IntPtr.Size * 2, errWrite);
                if (!UpdateProcThreadAttribute(list, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, handles, (IntPtr)(IntPtr.Size * 3), IntPtr.Zero, IntPtr.Zero))
                { DeleteProcThreadAttributeList(list); Native.CloseHandle(inWrite); Native.CloseHandle(outRead); return null; }
                STARTUPINFOEX si = new STARTUPINFOEX();
                si.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
                si.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
                si.StartupInfo.hStdInput = inRead;
                si.StartupInfo.hStdOutput = outWrite;
                si.StartupInfo.hStdError = errWrite;
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
                Native.CloseHandle(errWrite);
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
