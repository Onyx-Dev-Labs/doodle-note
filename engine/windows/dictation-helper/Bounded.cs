using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Threading;

namespace DoodleNote.DictationHelper
{
    /// <summary>
    /// Handed to a bounded call. A call that changes something in another process (selecting text,
    /// setting a value) must make that change through Commit(), which refuses once the caller has
    /// given up on the call: an abandoned call can never take effect after its caller moved on.
    /// </summary>
    internal sealed class CallToken
    {
        readonly object gate = new object();
        bool cancelled, committing, committed;

        /// <summary>The caller timed out and moved on.</summary>
        public bool Cancelled { get { lock (gate) return cancelled; } }

        /// <summary>
        /// Run a side effect only while the caller still waits. False (and nothing is done) once the
        /// call was cancelled. A cancel that arrives while the effect runs is reported to the caller as
        /// "may have applied" (MayHaveApplied), never hidden.
        /// </summary>
        public bool Commit(Action effect)
        {
            lock (gate)
            {
                if (cancelled) return false;
                committing = true;
            }
            try { effect(); }
            finally
            {
                lock (gate)
                {
                    committing = false;
                    committed = true;
                }
            }
            return true;
        }

        /// <summary>A side effect started or finished (whatever happened after it, it may have applied).</summary>
        internal bool Started { get { lock (gate) return committing || committed; } }

        /// <summary>Cancel; true when a side effect had started or finished (it may have applied).</summary>
        internal bool Cancel()
        {
            lock (gate)
            {
                cancelled = true;
                return committing || committed;
            }
        }
    }

    /// <summary>The slowest bounded call and the timeouts seen while one operation (a delivery) ran.</summary>
    internal sealed class BoundedStats
    {
        public double SlowestMs;
        public int Timeouts;
        public int Busy;
    }

    /// <summary>
    /// Runs calls into other processes (UI Automation providers) with a real wall-clock bound. A UIA
    /// call cannot be cancelled, so each call runs on a dedicated MTA worker thread and the caller
    /// waits at most the timeout. A call that overruns is reported as a timeout (the caller treats that
    /// as "cannot observe" and stops); its worker is retired: no new work is queued on it, its queue is
    /// completed so the thread ends as soon as the stuck call returns, and anything still queued behind
    /// it is dropped unrun (cancelled). Side effects go through CallToken.Commit, so they never happen
    /// after the caller gave up. At most MaxAbandoned retired workers may be alive at once (counted
    /// exactly: a worker leaves the count when its thread ends); past that every call is refused at
    /// once as Busy, which the helper reports as "helper-busy".
    /// </summary>
    internal static class Bounded
    {
        public enum Outcome { Ok, Failed, TimedOut, Busy }

        public const int MaxAbandoned = 4;
        static readonly object gate = new object();
        static Worker current;
        static int abandoned;
        static int liveThreads;

        [ThreadStatic] static BoundedStats tracking;

        sealed class Job
        {
            public Func<CallToken, object> Work;
            public readonly CallToken Token = new CallToken();
            public object Result;
            public bool Failed;
            public readonly ManualResetEventSlim Done = new ManualResetEventSlim(false);
        }

        sealed class Worker
        {
            public readonly BlockingCollection<Job> Queue = new BlockingCollection<Job>();
            public bool Retired;
            public Worker()
            {
                Thread thread = new Thread(Loop);
                thread.IsBackground = true;
                thread.Name = "dictation-uia";
                thread.SetApartmentState(ApartmentState.MTA);
                lock (gate) liveThreads++;
                thread.Start();
            }
            void Loop()
            {
                try
                {
                    foreach (Job job in Queue.GetConsumingEnumerable())
                    {
                        // Queued behind a stuck call and given up on meanwhile: never run it late.
                        if (job.Token.Cancelled) { job.Failed = true; job.Done.Set(); continue; }
                        try { job.Result = job.Work(job.Token); }
                        catch (Exception) { job.Failed = true; }
                        finally { job.Done.Set(); }
                    }
                }
                finally
                {
                    lock (gate)
                    {
                        liveThreads--;
                        if (Retired) abandoned--;
                    }
                }
            }
        }

        /// <summary>Retired workers whose stuck call has not returned yet (their threads are alive).</summary>
        public static int Abandoned { get { lock (gate) return abandoned; } }
        /// <summary>All live bounded-call worker threads (the current one included).</summary>
        public static int LiveThreads { get { lock (gate) return liveThreads; } }

        /// <summary>Start collecting call statistics for this thread's operation; returns the collector.</summary>
        public static BoundedStats Track()
        {
            tracking = new BoundedStats();
            return tracking;
        }

        /// <summary>Stop collecting call statistics on this thread.</summary>
        public static void Untrack() { tracking = null; }

        /// <summary>True when the call completed in time without throwing (see Call for the detail).</summary>
        public static bool Run<T>(Func<T> work, int timeoutMs, out T result)
        {
            return Call(delegate (CallToken token) { return work(); }, timeoutMs, out result) == Outcome.Ok;
        }

        /// <summary>Like Run, with the call's token (for side effects through CallToken.Commit).</summary>
        public static bool Run<T>(Func<CallToken, T> work, int timeoutMs, out T result)
        {
            return Call(work, timeoutMs, out result) == Outcome.Ok;
        }

        /// <summary>
        /// Run work within timeoutMs. Ok with the result when it completed in time without throwing;
        /// Failed when it threw; TimedOut when it overran (its token is cancelled; mayHaveApplied says
        /// whether a committed side effect had begun); Busy when too many workers are already stuck.
        /// </summary>
        public static Outcome Call<T>(Func<CallToken, T> work, int timeoutMs, out T result)
        {
            bool ignored;
            return Call(work, timeoutMs, out result, out ignored);
        }

        public static Outcome Call<T>(Func<CallToken, T> work, int timeoutMs, out T result, out bool mayHaveApplied)
        {
            result = default(T);
            mayHaveApplied = false;
            Worker worker;
            lock (gate)
            {
                if (abandoned >= MaxAbandoned)
                {
                    if (tracking != null) tracking.Busy++;
                    RaiseSaturated();
                    return Outcome.Busy;
                }
                if (current == null) current = new Worker();
                worker = current;
            }
            Job job = new Job();
            job.Work = delegate (CallToken token) { return work(token); };
            long start = Stopwatch.GetTimestamp();
            try { worker.Queue.Add(job); }
            catch (InvalidOperationException) { return Outcome.Busy; } // retired between the lock and here
            bool done = job.Done.Wait(Math.Max(0, timeoutMs));
            double ms = (Stopwatch.GetTimestamp() - start) * 1000.0 / Stopwatch.Frequency;
            if (tracking != null && ms > tracking.SlowestMs) tracking.SlowestMs = ms;
            if (!done)
            {
                mayHaveApplied = job.Token.Cancel();
                // The call may have finished between the wait and the cancel: then its result stands.
                if (!job.Done.IsSet)
                {
                    if (tracking != null) tracking.Timeouts++;
                    Retire(worker);
                    return Outcome.TimedOut;
                }
            }
            // A call that threw AFTER its side effect began may still have applied it.
            if (job.Failed) { mayHaveApplied = job.Token.Started; return Outcome.Failed; }
            result = (T)job.Result;
            return Outcome.Ok;
        }

        /// <summary>
        /// Raised once when the cap is first hit: calls stuck in providers that never return do not come
        /// back, so the helper restarts itself (Program) instead of refusing every call until it is.
        /// </summary>
        public static event Action Saturated;
        static int saturatedRaised;

        /// <summary>Test build only (TestMode): act as if the cap had just been hit.</summary>
        public static void TestSaturate() { if (TestMode.On) RaiseSaturated(); }

        static void RaiseSaturated()
        {
            if (Interlocked.Exchange(ref saturatedRaised, 1) == 1) return;
            Action handler = Saturated;
            if (handler != null) ThreadPool.QueueUserWorkItem(delegate { handler(); });
        }

        static void Retire(Worker worker)
        {
            lock (gate)
            {
                if (worker.Retired) return;
                worker.Retired = true;
                abandoned++;
                if (current == worker) current = null;
            }
            // The thread ends as soon as its stuck call returns; nothing queued behind it runs.
            worker.Queue.CompleteAdding();
        }
    }
}
