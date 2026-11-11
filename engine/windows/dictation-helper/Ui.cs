using System;
using System.Threading;
using System.Windows.Forms;

namespace DoodleNote.DictationHelper
{
    /// <summary>
    /// The helper's main thread: a Windows message loop that services the low-level
    /// keyboard and mouse hooks (Windows calls them on the thread that installed them)
    /// and every hold timer. Nothing slow may run here, or Windows drops the hooks.
    /// </summary>
    internal static class Ui
    {
        static SynchronizationContext context;
        static int threadId;

        public static void Install()
        {
            WindowsFormsSynchronizationContext.AutoInstall = false;
            context = new WindowsFormsSynchronizationContext();
            SynchronizationContext.SetSynchronizationContext(context);
            threadId = Thread.CurrentThread.ManagedThreadId;
            try
            {
                // A message-only window on this (pumping) thread owns the clipboard while a paste is
                // in flight, so a restore can prove ownership with GetClipboardOwner (see ClipboardText).
                // Test build only: the window cannot be created (round 22: then nothing opens the clipboard at all).
                if (TestMode.Env("DICTATION_HELPER_TEST_NO_WINDOW") == "1") throw new InvalidOperationException("test: no window");
                CreateParams parameters = new CreateParams();
                parameters.Parent = new IntPtr(-3); // HWND_MESSAGE
                NativeWindow created = new NativeWindow();
                created.CreateHandle(parameters);
                clipboardWindow = created.Handle != IntPtr.Zero ? created : null;
            }
            catch (Exception) { clipboardWindow = null; }
        }

        static NativeWindow clipboardWindow;

        /// <summary>The helper's clipboard owner window, or IntPtr.Zero when it could not be created.</summary>
        public static IntPtr ClipboardWindow { get { return clipboardWindow != null ? clipboardWindow.Handle : IntPtr.Zero; } }

        public static bool OnUiThread { get { return Thread.CurrentThread.ManagedThreadId == threadId; } }

        public static void Post(Action action)
        {
            context.Post(delegate { Guard(action); }, null);
        }

        /// <summary>Run on the main thread; an unexpected throw still answers the request.</summary>
        public static void Post(string replyId, Action action)
        {
            context.Post(delegate { Guard(replyId, action); }, null);
        }

        /// <summary>Run on the main thread and wait for the answer (or the default after the timeout).</summary>
        public static T Invoke<T>(Func<T> work, int timeoutMs, T fallback)
        {
            if (OnUiThread) return work();
            T result = fallback;
            using (ManualResetEventSlim done = new ManualResetEventSlim(false))
            {
                context.Post(delegate
                {
                    try { result = work(); }
                    catch (Exception error) { Wire.Log("ui: " + error.Message); }
                    finally { done.Set(); }
                }, null);
                if (!done.Wait(timeoutMs)) return fallback;
            }
            return result;
        }

        /// <summary>A one-shot timer on the main thread. Must be called on the main thread.</summary>
        public static Cancelable After(int ms, Action action)
        {
            System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
            timer.Interval = Math.Max(1, ms);
            Cancelable handle = new Cancelable(timer);
            timer.Tick += delegate
            {
                handle.Cancel();
                Guard(action);
            };
            timer.Start();
            return handle;
        }

        /// <summary>
        /// A repeating coalescable timer (SetCoalescableTimer with a tolerance) on the main thread, so a
        /// frequent sampler lets Windows batch wake-ups. Must be called on the main thread.
        /// </summary>
        public static Cancelable EveryCoalesced(int ms, int toleranceMs, Action action)
        {
            CoalescedTimer timer = new CoalescedTimer(action);
            if (!timer.Start(ms, toleranceMs)) { timer.Stop(); return Every(ms, action); }
            return new Cancelable(timer);
        }

        sealed class CoalescedTimer : NativeWindow, IDisposable
        {
            const int WM_TIMER = 0x0113;
            readonly Action action;
            public CoalescedTimer(Action action)
            {
                this.action = action;
                CreateParams parameters = new CreateParams();
                parameters.Parent = new IntPtr(-3); // HWND_MESSAGE
                CreateHandle(parameters);
            }
            public bool Start(int ms, int toleranceMs)
            {
                return Native.SetCoalescableTimer(Handle, (UIntPtr)1, (uint)Math.Max(1, ms), IntPtr.Zero, (uint)Math.Max(0, toleranceMs)) != UIntPtr.Zero;
            }
            public void Stop()
            {
                if (Handle == IntPtr.Zero) return;
                Native.KillTimer(Handle, (UIntPtr)1);
                DestroyHandle();
            }
            public void Dispose() { Stop(); }
            protected override void WndProc(ref Message m)
            {
                if (m.Msg == WM_TIMER) { Guard(action); return; }
                base.WndProc(ref m);
            }
        }

        /// <summary>A repeating timer on the main thread. Must be called on the main thread.</summary>
        public static Cancelable Every(int ms, Action action)
        {
            System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
            timer.Interval = Math.Max(1, ms);
            timer.Tick += delegate { Guard(action); };
            timer.Start();
            return new Cancelable(timer);
        }

        static void Guard(Action action)
        {
            try { action(); }
            catch (Exception error) { Wire.Log("ui: " + error.GetType().Name + ": " + error.Message); }
        }

        static void Guard(string replyId, Action action)
        {
            try { action(); }
            catch (Exception error)
            {
                Wire.Log("ui op " + replyId + ": " + error.GetType().Name + ": " + error.Message);
                Wire.Reply(replyId, false, Wire.Fields("reason", "internal-error"));
            }
        }

        internal sealed class Cancelable
        {
            System.Windows.Forms.Timer timer;
            IDisposable other;
            public Cancelable(System.Windows.Forms.Timer timer) { this.timer = timer; }
            public Cancelable(IDisposable other) { this.other = other; }
            public void Cancel()
            {
                if (other != null) { other.Dispose(); other = null; }
                if (timer == null) return;
                timer.Stop();
                timer.Dispose();
                timer = null;
            }
        }
    }

    /// <summary>A background thread that runs queued work in order (the Swift helper's DispatchQueues).</summary>
    internal sealed class WorkQueue
    {
        readonly System.Collections.Concurrent.BlockingCollection<Action> items =
            new System.Collections.Concurrent.BlockingCollection<Action>();
        readonly Thread thread;

        public WorkQueue(string name)
        {
            thread = new Thread(Run);
            thread.Name = name;
            thread.IsBackground = true;
            // UI Automation and Core Audio clients are free-threaded; keep them out of an STA.
            thread.SetApartmentState(ApartmentState.MTA);
            thread.Start();
        }

        public void Async(Action action) { try { items.Add(action); } catch (InvalidOperationException) { } }

        /// <summary>Queue work for one request; an unexpected throw still answers it.</summary>
        public void Async(string replyId, Action action)
        {
            Async(delegate
            {
                try { action(); }
                catch (Exception error)
                {
                    Wire.Log(thread.Name + " op " + replyId + ": " + error.GetType().Name + ": " + error.Message);
                    Wire.Reply(replyId, false, Wire.Fields("reason", "internal-error"));
                }
            });
        }

        /// <summary>Run now on this queue and wait, up to the timeout.</summary>
        public void Sync(Action action, int timeoutMs)
        {
            using (ManualResetEventSlim done = new ManualResetEventSlim(false))
            {
                Async(delegate { try { action(); } finally { done.Set(); } });
                done.Wait(timeoutMs);
            }
        }

        void Run()
        {
            foreach (Action action in items.GetConsumingEnumerable())
            {
                try { action(); }
                catch (Exception error) { Wire.Log(thread.Name + ": " + error.GetType().Name + ": " + error.Message); }
            }
        }
    }
}
