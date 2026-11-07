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
        }

        public static bool OnUiThread { get { return Thread.CurrentThread.ManagedThreadId == threadId; } }

        public static void Post(Action action)
        {
            context.Post(delegate { Guard(action); }, null);
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

        internal sealed class Cancelable
        {
            System.Windows.Forms.Timer timer;
            public Cancelable(System.Windows.Forms.Timer timer) { this.timer = timer; }
            public void Cancel()
            {
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
