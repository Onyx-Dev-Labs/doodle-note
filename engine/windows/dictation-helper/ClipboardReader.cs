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
    /// Reading the user's clipboard before a paste, without ever holding it open across a blocking
    /// render. Reading a format the owner renders on demand (OLE "Embed Source" and the like) blocks
    /// inside GetClipboardData until the owner answers, and the reader holds the clipboard open
    /// meanwhile, so nobody else can open it; a thread blocked there cannot be interrupted. So the
    /// reads run in a separate reader process (this same executable, started with --clipboard-reader):
    /// one request per format, each OpenClipboard → GetClipboardData → copy → CloseClipboard (in a
    /// finally) with its own wall-clock bound. The reader opens the clipboard without an owner window,
    /// and measured on Dev04, another app's OpenClipboard succeeds at once even while the reader waits
    /// in a render. A read that overruns is abandoned and the save gives up: the reader is NOT killed,
    /// because ending it mid-render makes Windows drop the format being rendered from the user's
    /// clipboard (measured: an OLE "Embed Source" vanished); it finishes the render, finds its stdin
    /// closed and exits. At most MaxAbandoned readers may be waiting like that (past that, no save is
    /// attempted), and one still waiting after AbandonedMaxMs is ended (its owner is hung). Since
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

        readonly Process process;
        readonly BlockingCollection<string> lines = new BlockingCollection<string>();

        ClipboardReaderClient(Process process)
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
                if (abandoned.Count >= MaxAbandoned)
                {
                    Wire.Log("clipboard readers are still waiting on a slow owner; not saving the clipboard");
                    return null;
                }
                try
                {
                    ProcessStartInfo info = new ProcessStartInfo(SelfImage.Path, ClipboardReader.Argument);
                    info.UseShellExecute = false;
                    info.CreateNoWindow = true;
                    info.RedirectStandardInput = true;
                    info.RedirectStandardOutput = true;
                    info.StandardOutputEncoding = new UTF8Encoding(false);
                    Process process = Process.Start(info);
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
                try { return process.HasExited; }
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
            }
            try { process.StandardInput.Close(); } catch (Exception) { }
            Wire.Log("clipboard reader abandoned while its owner renders (" + AbandonedCount + " waiting)");
        }

        /// <summary>Forget readers that exited; end any that waited past AbandonedMaxMs (a hung owner). Under gate.</summary>
        static void Prune()
        {
            for (int i = abandoned.Count - 1; i >= 0; i--)
            {
                ClipboardReaderClient reader = abandoned[i];
                if (reader.Exited) { abandoned.RemoveAt(i); try { reader.process.Dispose(); } catch (Exception) { } }
                else if (reader.age.ElapsedMilliseconds > AbandonedMaxMs) { abandoned.RemoveAt(i); reader.End(); }
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
