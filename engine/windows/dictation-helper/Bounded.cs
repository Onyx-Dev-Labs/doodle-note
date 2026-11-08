using System;
using System.Collections.Concurrent;
using System.Threading;

namespace DoodleNote.DictationHelper
{
    /// <summary>
    /// Runs calls into other processes (UI Automation providers) with a real wall-clock bound. A UIA
    /// call cannot be cancelled, so each call runs on a dedicated MTA worker thread and the caller
    /// waits at most the timeout; a call that overruns is reported as a timeout (the caller treats
    /// that as "cannot observe" and stops), and its worker is abandoned and replaced. At most
    /// MaxAbandoned workers may be stuck at once; past that every call fails fast.
    /// </summary>
    internal static class Bounded
    {
        const int MaxAbandoned = 4;
        static readonly object gate = new object();
        static Worker current;
        static int abandoned;

        sealed class Job
        {
            public Func<object> Work;
            public object Result;
            public bool Failed;
            public readonly ManualResetEventSlim Done = new ManualResetEventSlim(false);
        }

        sealed class Worker
        {
            public readonly BlockingCollection<Job> Queue = new BlockingCollection<Job>();
            public Worker()
            {
                Thread thread = new Thread(Loop);
                thread.IsBackground = true;
                thread.Name = "dictation-uia";
                thread.SetApartmentState(ApartmentState.MTA);
                thread.Start();
            }
            void Loop()
            {
                foreach (Job job in Queue.GetConsumingEnumerable())
                {
                    try { job.Result = job.Work(); }
                    catch (Exception) { job.Failed = true; }
                    finally { job.Done.Set(); }
                }
            }
        }

        /// <summary>Time (ms) of the slowest call so far, and how many calls timed out (diagnostics).</summary>
        public static double SlowestMs;
        public static int Timeouts;

        /// <summary>
        /// Run work within timeoutMs. True with the result when it completed in time without throwing;
        /// false when it threw, timed out, or too many workers are already stuck.
        /// </summary>
        public static bool Run<T>(Func<T> work, int timeoutMs, out T result)
        {
            result = default(T);
            Worker worker;
            lock (gate)
            {
                if (abandoned >= MaxAbandoned) return false;
                if (current == null) current = new Worker();
                worker = current;
            }
            Job job = new Job();
            job.Work = delegate { return work(); };
            long start = System.Diagnostics.Stopwatch.GetTimestamp();
            worker.Queue.Add(job);
            bool done = job.Done.Wait(timeoutMs);
            double ms = (System.Diagnostics.Stopwatch.GetTimestamp() - start) * 1000.0 / System.Diagnostics.Stopwatch.Frequency;
            if (ms > SlowestMs) SlowestMs = ms;
            if (!done)
            {
                Interlocked.Increment(ref Timeouts);
                lock (gate)
                {
                    // The worker is stuck in a provider call: never queue behind it again.
                    if (current == worker) { current = null; abandoned++; }
                }
                ThreadPool.QueueUserWorkItem(delegate
                {
                    job.Done.Wait();
                    lock (gate) abandoned = Math.Max(0, abandoned - 1);
                });
                return false;
            }
            if (job.Failed) return false;
            result = (T)job.Result;
            return true;
        }
    }
}
