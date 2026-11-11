using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace DoodleNote.DictationHelper
{
#if DICTATION_TEST
    /// <summary>Test build only (round 21): who keeps the clipboard when two processes open it, with NULL or a window.</summary>
    internal static class ClipboardExperiment
    {
        static string Enumerate()
        {
            int listed = 0, error;
            for (uint f = 0; ;)
            {
                Native.ClearLastError(0);
                f = Native.EnumClipboardFormats(f);
                if (f == 0) { error = System.Runtime.InteropServices.Marshal.GetLastWin32Error(); break; }
                listed++;
            }
            return "listed " + listed + " error " + error + " counted " + Native.CountClipboardFormats();
        }

        public static System.Collections.Generic.Dictionary<string, object> Run(bool hold, string owner, int waitMs, int holdMs)
        {
            System.Windows.Forms.NativeWindow window = null;
            IntPtr own = IntPtr.Zero;
            if (owner == "window")
            {
                System.Windows.Forms.CreateParams parameters = new System.Windows.Forms.CreateParams();
                parameters.Parent = new IntPtr(-3);
                window = new System.Windows.Forms.NativeWindow();
                window.CreateHandle(parameters);
                own = window.Handle;
            }
            bool opened = false;
            int openError = 0;
            for (int attempt = 0; attempt < (hold ? 12 : 1) && !opened; attempt++)
            {
                opened = Native.OpenClipboard(own);
                if (!opened) { openError = System.Runtime.InteropServices.Marshal.GetLastWin32Error(); System.Threading.Thread.Sleep(15); }
            }
            string first = opened ? Enumerate() : "";
            string openWindow1 = Native.GetOpenClipboardWindow().ToInt64().ToString("x");
            string second = "", openWindow2 = "";
            // Round 30: the harness acts once this side holds the clipboard, and releases it (gates), never on a timed guess.
            if (opened) TestMode.Trace(hold ? "clip-hold opened" : "clip-probe opened");
            if (opened && !(waitMs > 0 && TestMode.Gate(hold ? "CLIPHOLD" : "CLIPPROBE"))) System.Threading.Thread.Sleep(waitMs);
            if (opened && hold) { second = Enumerate(); openWindow2 = Native.GetOpenClipboardWindow().ToInt64().ToString("x"); }
            if (opened) System.Threading.Thread.Sleep(holdMs);
            bool closed = false;
            int closeError = 0;
            if (opened) { closed = Native.CloseClipboard(); closeError = System.Runtime.InteropServices.Marshal.GetLastWin32Error(); }
            if (window != null) window.DestroyHandle();
            return Wire.Fields("owner", owner, "ownWindow", own.ToInt64().ToString("x"), "opened", opened, "openError", openError,
                "first", first, "openWindowFirst", openWindow1, "second", second, "openWindowSecond", openWindow2, "closed", closed, "closeError", closeError);
        }
    }
#endif

    /// <summary>
    /// DoodleNote dictation helper for Windows: reads one JSON request per stdin line and
    /// answers on stdout, with the same operations and replies as the macOS helper
    /// (engine/Sources/dictation-helper/main.swift). Exits when stdin closes, so it can
    /// never outlive the app. It holds no credentials and never sees provider keys.
    /// </summary>
    internal static class Program
    {
        static readonly SnapshotStore snapshots = new SnapshotStore();
        /// <summary>Wall-clock bounds for reading a watched field and a selection through the app's provider.</summary>
        const int WatchReadBudgetMs = 1500, SelectionBudgetMs = 1500;
        static readonly FieldWatches watches = new FieldWatches();
        // UI Automation calls can block on an unresponsive app; keep them off the main
        // thread, which services the hooks.
        static WorkQueue work;
        // Core Audio reads never queue behind a slow automation call, or the other way round.
        static WorkQueue audio;
        static Native.ConsoleCtrl ctrlHandler;
        static int exiting;

        [STAThread]
        static int Main(string[] args)
        {
            // The clipboard reader (see ClipboardReader): no hooks and no UI; its only window is the message-only one it
            // opens the clipboard with (round 21), and its only protocol is the framed reader protocol.
            if (args.Length == 1 && args[0] == ClipboardReader.Argument) return ClipboardReader.Serve();
            // The app's pipes are this helper's alone: a clipboard reader it starts must not inherit
            // them, or a reader still waiting in a render would keep the app from seeing them close.
            foreach (int which in new[] { -10, -11, -12 }) // STD_INPUT / STD_OUTPUT / STD_ERROR_HANDLE
                Native.SetHandleInformation(Native.GetStdHandle(which), Native.HANDLE_FLAG_INHERIT, 0);
            // An unhandled exception anywhere runs the same bounded shutdown (delivery, rollback, sound).
            // Set before any window exists (WinForms refuses it later).
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.ThrowException);
            AppDomain.CurrentDomain.UnhandledException += delegate (object sender, UnhandledExceptionEventArgs e)
            {
                Wire.Log("ERROR: unhandled " + (e.ExceptionObject is Exception ? e.ExceptionObject.GetType().Name : "exception") + "; leaving");
                // A terminal request: an exit already under way (a restart's long wait) is shortened, and
                // this thread waits for it to finish its bounded steps instead of ending the process now.
                DeliveriesInFlight.Shorten(QuitWaitMs);
                if (!TryOwnShutdown()) { shutdownDone.WaitOne(QuitWaitMs + HooksStopMs + ClipboardReaderClient.IdleExitWaitMs + AudioRestoreMs + DrainMs + 1000); return; }
                RunShutdown(ExitCrash, null, QuitWaitMs);
            };
            Wire.Start();
            SelfImage.Hold();
            // Provider calls stuck past the cap never come back: leave with ExitBusy so the app restarts
            // a fresh helper (its replies "helper-busy" have gone out first).
            Bounded.Saturated += delegate { Restart("helper-busy", "provider calls are stuck past the cap"); };
            // Clipboard readers stuck on owners that never render: no clipboard save is possible any more.
            ClipboardReaderClient.Exhausted += delegate { Restart("clipboard-readers", "clipboard readers are waiting on owners that do not render"); };
            // Round 39: a late clipboard write that never ends (deliveries and Restores wait for it: round 38).
            ClipboardText.LateWriteStuck += delegate (int ms) { Restart("clipboard-write-stuck", "a late clipboard write has not ended in " + ms + " ms"); };
            Ui.Install();
            // A clipboard transaction an earlier helper could not finish (it ended before its restore).
            PendingClipboard.RecoverLeftover("start");
            work = new WorkQueue("dictation.work");
            audio = new WorkQueue("dictation.audio");
            audio.Async(OutputAudio.RecoverLeftover);

            // Being asked to quit must never leave the user's sound muted.
            // A close or logoff event: Windows ends a console process about 5 s after it, and at once when this
            // handler returns. So the whole exit fits in ConsoleHandlerWaitMs: the wait for a delivery is
            // shortened to ConsoleCloseWaitMs, and whichever thread owns the shutdown (this one, or one that
            // started first) runs it while this handler waits for its completion signal.
            ctrlHandler = delegate(int type)
            {
                DeliveriesInFlight.Shorten(ConsoleCloseWaitMs);
                if (TryOwnShutdown()) RunShutdown(0, null, ConsoleCloseWaitMs); // never returns (Environment.Exit)
                shutdownDone.WaitOne(ConsoleHandlerWaitMs);
                return true;
            };
            Native.SetConsoleCtrlHandler(ctrlHandler, true);

            Thread reader = new Thread(ReadLoop);
            reader.IsBackground = true;
            reader.Name = "stdin";
            reader.Start();

            Wire.Send(Wire.Fields("event", "ready", "pid", Process.GetCurrentProcess().Id, "platform", "win32"));
            Application.Run(new ApplicationContext());
            return 0;
        }

        static void ReadLoop()
        {
            Stream input = Console.OpenStandardInput();
            StreamReader reader = new StreamReader(input, new UTF8Encoding(false));
            try
            {
                string line;
                while ((line = reader.ReadLine()) != null)
                {
                    if (line.Trim().Length == 0) continue;
                    Dictionary<string, object> request = Wire.Parse(line);
                    if (request != null)
                    {
                        request["__receiptTick"] = Environment.TickCount;
                        Handle(request);
                    }
                    else Wire.Send(Wire.Fields("event", "parse-error"));
                }
            }
            catch (IOException) { }
            // The app is gone (closing stdin is how the app asks the helper to quit; there is no quit
            // op). If a restart is already waiting for a delivery, it now waits only the quit grace.
            DeliveriesInFlight.Shorten(QuitWaitMs);
            // Make sure no hold stays "down" and no sound stays muted, then leave.
            Shutdown();
        }

        /// <summary>Exit code when the helper leaves to be replaced (stuck provider calls or clipboard readers; the app restarts it).</summary>
        public const int ExitBusy = 3;
        /// <summary>
        /// How long an exit waits for a delivery in progress to finish its clipboard restore and reply:
        /// a quit (the app is going) briefly; a restart (nothing is waiting on us) up to the longest
        /// delivery the app allows, so a typing fallback is never cut off half-way.
        /// </summary>
        public const int QuitWaitMs = 3000, RestartWaitMs = 60000;
        /// <summary>
        /// The clean-up after that wait, each bounded: stopping the hooks, giving back muted sound,
        /// draining the last replies. QuitWaitMs plus these (plus the clipboard readers' idle exit wait,
        /// ClipboardReaderClient.IdleExitWaitMs) stays below the app's WINDOWS_EXIT_GRACE_MS (a test reads
        /// these constants).
        /// </summary>
        public const int HooksStopMs = 1000, AudioRestoreMs = 2000, DrainMs = 500;
        /// <summary>Exit code after an unhandled exception (the same bounded shutdown ran first).</summary>
        public const int ExitCrash = 4;

        static void Shutdown() { Shutdown(0, null, QuitWaitMs); }

        /// <summary>
        /// A console close or logoff event: the wait for a delivery in progress, so that it plus the bounded clean-up
        /// (hooks 1000, readers 500, sound 2000, drain 500 ms: 4250 ms in all) fits in ConsoleHandlerWaitMs with a
        /// 250 ms margin, below the ~5 s Windows allows.
        /// </summary>
        public const int ConsoleCloseWaitMs = 250, ConsoleHandlerWaitMs = 4500;

        /// <summary>Set when the shutdown's steps are done (right before Environment.Exit).</summary>
        static readonly ManualResetEvent shutdownDone = new ManualResetEvent(false);

        /// <summary>One atomic step decides which thread runs the shutdown; every other starter waits for it.</summary>
        static bool TryOwnShutdown() { return Interlocked.CompareExchange(ref exiting, 1, 0) == 0; }

        /// <summary>Leave to be replaced: only between deliveries (the running one finishes first).</summary>
        static void Restart(string reason, string why)
        {
            ThreadPool.QueueUserWorkItem(delegate
            {
                Wire.Log(why + "; restarting once the delivery in progress (if any) is done");
                Shutdown(ExitBusy, reason, RestartWaitMs);
            });
        }

        static void Shutdown(int exitCode, string restartReason, int waitMs)
        {
            if (!TryOwnShutdown()) return;
            RunShutdown(exitCode, restartReason, waitMs);
        }

        /// <summary>The shutdown's steps; only the thread that won TryOwnShutdown runs them.</summary>
        static void RunShutdown(int exitCode, string restartReason, int waitMs)
        {
            // Every exit path: no new delivery starts, the running one finishes its restore and reply,
            // and an abandoned clipboard write finishes its rollback, all within the one wait (which
            // stdin closing shortens to QuitWaitMs). Past it, the transaction's record (PendingClipboard)
            // is how the next helper finishes the job.
            Stopwatch wait = Stopwatch.StartNew();
            bool idle = DeliveriesInFlight.CloseAndWait(waitMs);
            // Round 33: the journal's queued steps (a restored record's "settled" and its deletion above all) run before the
            // exit, inside the SAME wait (what is left of it: the console handler's budget below is unchanged); past it, a
            // record left behind is judged by content at the next start (already there: deleted; else offered).
            int journalLeft = Math.Max(0, waitMs - (int)wait.ElapsedMilliseconds);
            if (!PendingClipboard.DrainJournal(journalLeft)) Wire.Log("leaving with clipboard journal steps still queued (waited " + wait.ElapsedMilliseconds + " ms in all)");
            Wire.Log((idle ? "leaving with no delivery or clipboard write in progress" : "leaving with " + DeliveriesInFlight.Pending + " still in progress")
                + " (waited " + wait.ElapsedMilliseconds + " ms)"
                + (idle ? "" : "; the transaction record lets the next helper put the clipboard back"));
            if (restartReason != null) Wire.Send(Wire.Fields("event", "restarting", "reason", restartReason));
            Ui.Invoke(delegate { HoldWatcher.Shared.StopAll(); MouseCapture.Shared.Cancel("stopped"); return true; }, HooksStopMs, false);
            ClipboardReaderClient.Shutdown();
            if (audio != null) audio.Sync(delegate { OutputAudio.Restore(); }, AudioRestoreMs);
            Wire.Drain(DrainMs);
            shutdownDone.Set();
            Environment.Exit(exitCode);
        }

        static void DeliverOne(string id, string snapshotId, string text, DeliveryGuards guards, bool watch, int deadlineMs, int receiptTick)
        {
            if (text.Length == 0)
            {
                Wire.Reply(id, true, new DeliveryResult(DeliveryOutcome.Failed, "empty-text").Fields());
                return;
            }
            TargetSnapshot snapshot = snapshots.Get(snapshotId);
            if (snapshot == null)
            {
                Wire.Reply(id, true, new DeliveryResult(DeliveryOutcome.Refused, "no-target").Fields());
                return;
            }
            int queuedMs = unchecked(Environment.TickCount - receiptTick);
            Delivery.CurrentRequestId = id;
            DeliveryResult result;
            try { result = Delivery.Deliver(snapshot, text, guards, deadlineMs, queuedMs); }
            finally { Delivery.CurrentRequestId = null; }
            // A snapshot is single-use: a second deliver can never re-insert.
            snapshots.Drop(snapshotId);
            // Keep the field for read-backs only when asked, only after a confirmed
            // insertion, and never a secure field.
            if (watch && result.Outcome == DeliveryOutcome.Delivered && snapshot.Element != null
                && !(snapshot.Facts != null && snapshot.Facts.Secure))
                watches.Start(snapshotId, snapshot.Pid, snapshot.Element);
            Wire.Reply(id, true, result.Fields());
        }

        static void Handle(Dictionary<string, object> request)
        {
            string op = Wire.Str(request, "op");
            string id = Wire.Str(request, "id");
            if (op == null || id == null) return;
            switch (op)
            {
                case "status":
                    work.Async(id, delegate
                    {
                        bool hooks = Ui.Invoke(delegate { return HoldWatcher.Shared.HooksAllowed(); }, 1000, false);
                        bool holdActive = Ui.Invoke(delegate { return HoldWatcher.Shared.Active; }, 500, false);
                        bool mouseActive = Ui.Invoke(delegate { return HoldWatcher.Shared.MouseActive; }, 500, false);
                        bool hooksLive = Ui.Invoke(delegate { return HoldWatcher.Shared.HooksLive; }, 500, true);
                        Wire.Reply(id, true, Wire.Fields(
                            // Windows has no Accessibility permission: UI Automation and synthetic input need none.
                            "accessibility", true,
                            // The counterpart of Input Monitoring: may this process hook the keyboard and mouse?
                            "inputMonitoring", hooks,
                            "inputMonitoringAccess", hooks ? "granted" : "denied",
                            "secureInput", false,
                            "conflicts", Target.ConflictingDictationApps(),
                            "holdActive", holdActive,
                            "mouseActive", mouseActive,
                            "hooksLive", hooksLive,
                            "platform", "win32"));
                    });
                    break;
                case "request-accessibility":
                    // Nothing to ask for on Windows.
                    Wire.Reply(id, true, Wire.Fields("trusted", true));
                    break;
                case "request-input-monitoring":
                    Ui.Post(id, delegate
                    {
                        bool granted = HoldWatcher.Shared.HooksAllowed();
                        Wire.Reply(id, true, Wire.Fields("granted", granted, "state", granted ? "granted" : "denied"));
                    });
                    break;
                case "input-state":
                    {
                        string uid = Wire.Str(request, "uid");
                        audio.Async(id, delegate
                        {
                            IMMDevice device = Microphone.Device(uid);
                            if (device == null) Wire.Reply(id, false, Wire.Fields("reason", "no-input-device"));
                            else Wire.Reply(id, true, Microphone.State(device));
                        });
                    }
                    break;
                case "mute-output":
                    // Serial with restore-output on the audio queue, so the two can never cross.
                    audio.Async(id, delegate { Wire.Reply(id, true, Wire.Fields("outcome", OutputAudio.Mute())); });
                    break;
                case "restore-output":
                    audio.Async(id, delegate { Wire.Reply(id, true, Wire.Fields("outcome", OutputAudio.Restore())); });
                    break;
                case "app-icon":
                    {
                        string path = Wire.Str(request, "path") ?? "";
                        work.Async(id, delegate
                        {
                            byte[] png = AppInfo.Png(path, 64);
                            if (png == null) Wire.Reply(id, false, Wire.Fields("reason", "no-icon"));
                            else Wire.Reply(id, true, Wire.Fields("png", Convert.ToBase64String(png)));
                        });
                    }
                    break;
                case "app-info":
                    {
                        List<string> ids = Wire.Strings(request, "bundleIds");
                        if (ids.Count > AppInfo.MaxBatch) ids = ids.GetRange(0, AppInfo.MaxBatch);
                        work.Async(id, delegate
                        {
                            Dictionary<string, string> known = AppInfo.InstalledPrograms(ids.ConvertAll(x => x.ToLowerInvariant()));
                            List<object> apps = ids.ConvertAll(x => (object)AppInfo.Lookup(x, known));
                            Wire.Reply(id, true, Wire.Fields("apps", apps));
                        });
                    }
                    break;
                case "snapshot":
                    {
                        string snapshotId = Wire.Str(request, "snapshotId") ?? id;
                        work.Async(id, delegate
                        {
                            TargetSnapshot snapshot = Target.Capture(snapshotId);
                            if (snapshot == null)
                            {
                                Wire.Reply(id, false, Wire.Fields("reason", "no-frontmost-app"));
                                return;
                            }
                            snapshots.Put(snapshot);
                            Wire.Reply(id, true, Target.Describe(snapshot));
                        });
                    }
                    break;
                case "deliver":
                    {
                        string snapshotId = Wire.Str(request, "snapshotId") ?? "";
                        string text = Wire.Str(request, "text") ?? "";
                        DeliveryGuards guards = new DeliveryGuards(Wire.Str(request, "expectSelection"), Wire.Str(request, "replace"));
                        bool watch = Wire.Bool(request, "watch") == true;
                        // Elapsed-ms budget measured from when the request was received (below).
                        int deadlineMs = (int)(Wire.Num(request, "deadlineMs") ?? 0);
                        int receiptTick = (int)(Wire.Num(request, "__receiptTick") ?? Environment.TickCount);
                        work.Async(id, delegate
                        {
                            // The helper is leaving (quit or restart): never start a delivery it might not finish.
                            if (!DeliveriesInFlight.Begin())
                            {
                                Wire.Reply(id, true, new DeliveryResult(DeliveryOutcome.Refused, "helper-busy").Fields());
                                return;
                            }
                            try { DeliverOne(id, snapshotId, text, guards, watch, deadlineMs, receiptTick); }
                            finally { DeliveriesInFlight.End(); }
                        });
                    }
                    break;
                case "watch-read":
                    {
                        string watchId = Wire.Str(request, "watchId") ?? "";
                        work.Async(id, delegate
                        {
                            FieldWatches.Watch watch = watches.Get(watchId);
                            if (watch == null) { Wire.Reply(id, true, Wire.Fields("state", "gone")); return; }
                            // The read goes through the watched app's provider: bounded, so a hung app
                            // reads as unreadable instead of stalling every later request.
                            Dictionary<string, object> read;
                            Bounded.Outcome outcome = Bounded.Call(token => FieldRead.Read(watch), WatchReadBudgetMs, out read);
                            Wire.Reply(id, true, outcome == Bounded.Outcome.Ok ? read
                                : Wire.Fields("state", "unreadable", "busy", outcome == Bounded.Outcome.Busy));
                        });
                    }
                    break;
                case "watch-stop":
                    {
                        string watchId = Wire.Str(request, "watchId");
                        if (watchId != null) watches.Stop(watchId);
                        Wire.Reply(id);
                    }
                    break;
                case "selection":
                    {
                        // The text selected in the snapshot's field, so a transform can work on it.
                        // Never read from a secure field.
                        string snapshotId = Wire.Str(request, "snapshotId") ?? "";
                        work.Async(id, delegate
                        {
                            TargetSnapshot snapshot = snapshots.Get(snapshotId);
                            if (snapshot == null || snapshot.Element == null)
                            {
                                Wire.Reply(id, false, Wire.Fields("reason", "no-target"));
                                return;
                            }
                            string reason = null, selected = null;
                            Bounded.Outcome outcome = Bounded.Call(delegate (CallToken token)
                            {
                                System.Windows.Automation.AutomationElement current;
                                if (!Target.StillFocused(snapshot, out current)) return "focus-changed";
                                ElementFacts facts = ElementFacts.Of(current, Target.CurrentGui());
                                if (!facts.Readable) return "unavailable";
                                if (facts.Secure || (snapshot.Facts != null && snapshot.Facts.Secure)) return "secure-field";
                                selected = UIA.Selection(current) ?? "";
                                return null;
                            }, SelectionBudgetMs, out reason);
                            if (outcome != Bounded.Outcome.Ok) reason = "unavailable";
                            if (reason != null) Wire.Reply(id, false, Wire.Fields("reason", reason, "busy", outcome == Bounded.Outcome.Busy));
                            else Wire.Reply(id, true, Wire.Fields("text", selected));
                        });
                    }
                    break;
                case "release":
                    {
                        string snapshotId = Wire.Str(request, "snapshotId");
                        if (snapshotId != null) snapshots.Drop(snapshotId);
                        Wire.Reply(id);
                    }
                    break;
                case "hold-start":
                    {
                        string key = Wire.Str(request, "key") ?? "";
                        int minHold = (int)(Wire.Num(request, "minHoldMs") ?? 150);
                        Ui.Post(id, delegate
                        {
                            string failure = HoldWatcher.Shared.Start(key, minHold);
                            if (failure != null) Wire.Reply(id, false, Wire.Fields("reason", failure));
                            else Wire.Reply(id);
                        });
                    }
                    break;
                case "hold-stop":
                    Ui.Post(id, delegate { HoldWatcher.Shared.Stop(); Wire.Reply(id); });
                    break;
                case "mouse-start":
                    {
                        long button = (long)(Wire.Num(request, "button") ?? -1);
                        bool swallow = Wire.Bool(request, "swallow") == true;
                        int minHold = (int)(Wire.Num(request, "minHoldMs") ?? 150);
                        bool click = Wire.Str(request, "mode") == "click";
                        Ui.Post(id, delegate
                        {
                            string failure = HoldWatcher.Shared.StartMouse(button, swallow, minHold, click);
                            if (failure != null) Wire.Reply(id, false, Wire.Fields("reason", failure));
                            else Wire.Reply(id, true, Wire.Fields("swallowing", HoldWatcher.Shared.MouseSwallowing));
                        });
                    }
                    break;
                case "mouse-stop":
                    Ui.Post(id, delegate { HoldWatcher.Shared.StopMouse(); Wire.Reply(id); });
                    break;
                case "mouse-capture":
                    {
                        double seconds = Wire.Num(request, "seconds") ?? 10;
                        Ui.Post(id, delegate
                        {
                            // The watched button must not be swallowed while the user picks a new one.
                            HoldWatcher.Shared.SetMousePaused(true);
                            MouseCapture.Shared.Begin(Math.Max(1, Math.Min(seconds, 30)), delegate(Dictionary<string, object> fields, string reason)
                            {
                                HoldWatcher.Shared.SetMousePaused(false);
                                if (fields != null) Wire.Reply(id, true, fields);
                                else Wire.Reply(id, false, Wire.Fields("reason", reason ?? "failed"));
                            });
                        });
                    }
                    break;
                // Production ops (compiled into the shipped helper; a desktop test checks that no production op
                // sits inside the DICTATION_TEST region and that every test op does).
                case "clipboard-offers":
                    // Kept clipboard transactions the user may restore (formats and size only, never content).
                    work.Async(id, delegate { Wire.Reply(id, true, Wire.Fields("offers", PendingClipboard.Offers())); });
                    break;
                case "clipboard-restore":
                    {
                        // The user's Restore of an offer: runs only while the clipboard is as it was when offered.
                        string record = Wire.Str(request, "record") ?? "";
                        uint expect = (uint)(Wire.Num(request, "sequence") ?? 0);
                        // Round 22 (S3): the app showed the user what an incomplete record is missing.
                        bool acceptIncomplete = Wire.Bool(request, "acceptIncomplete") == true;
                        work.Async(id, delegate
                        {
                            if (!DeliveriesInFlight.Begin()) { Wire.Reply(id, true, Wire.Fields("result", "helper-busy")); return; }
                            try { Wire.Reply(id, true, PendingClipboard.RestoreOffer(record, expect, acceptIncomplete)); }
                            finally { DeliveriesInFlight.End(); }
                        });
                    }
                    break;
                case "clipboard-dismiss":
                    {
                        string record = Wire.Str(request, "record") ?? "";
                        work.Async(id, delegate { Wire.Reply(id, true, Wire.Fields("dismissed", PendingClipboard.DismissOffer(record))); });
                    }
                    break;
#if DICTATION_TEST
                // Test-build-only ops (compiled with /define:DICTATION_TEST and enabled only with
                // DICTATION_HELPER_TEST=1). The shipped helper has none of these: they answer unknown-op.
                case "__boundary-table":
                    if (!TestMode.On) { Wire.Reply(id, false, Wire.Fields("reason", "unknown-op")); break; }
                    {
                        byte[] bits = new byte[8192]; // 65536 bits
                        for (int cp = 0; cp <= 0xFFFF; cp++)
                        {
                            char c = (char)cp;
                            if (char.IsWhiteSpace(c) || char.IsPunctuation(c)) bits[cp >> 3] |= (byte)(1 << (cp & 7));
                        }
                        Wire.Reply(id, true, Wire.Fields("bitsBase64", Convert.ToBase64String(bits)));
                    }
                    break;
                case "__clipboard-txn":
                    // Test build only: a clipboard transaction without a target (Delivery.TestTransaction).
                    if (!TestMode.On) { Wire.Reply(id, false, Wire.Fields("reason", "unknown-op")); break; }
#if DICTATION_TEST
                    {
                        string txnText = Wire.Str(request, "text") ?? "dictated";
                        int holdMs = (int)(Wire.Num(request, "holdMs") ?? 0);
                        int txnDeadlineMs = (int)(Wire.Num(request, "deadlineMs") ?? 0);
                        work.Async(id, delegate
                        {
                            // Counted like a delivery: an exit waits for it, and none starts once the helper is leaving.
                            if (!DeliveriesInFlight.Begin()) { Wire.Reply(id, true, Wire.Fields("result", "helper-busy")); return; }
                            try
                            {
                                Delivery.CurrentRequestId = id;
                                Wire.Reply(id, true, Wire.Fields("result", Delivery.TestTransaction(txnText, holdMs, txnDeadlineMs)));
                            }
                            finally { DeliveriesInFlight.End(); }
                        });
                    }
#endif
                    break;
                case "__retention-sweep":
                    // Test build only (round 37): the 30-minute retention check, run now (the timer's own function), on a pool
                    // thread like the timer's: NOT on the request queue, which a held delivery occupies (CI run 42918694530).
                    if (!TestMode.On) { Wire.Reply(id, false, Wire.Fields("reason", "unknown-op")); break; }
#if DICTATION_TEST
                    ThreadPool.QueueUserWorkItem(delegate
                    {
                        try { PendingClipboard.ExpireSweep(); Wire.Reply(id, true, Wire.Fields("result", "swept")); }
                        catch (Exception error) { Wire.Reply(id, false, Wire.Fields("reason", error.GetType().Name)); }
                    });
#endif
                    break;
                case "__text-forms":
                    // Test build only: the text forms this helper expects Windows to synthesize for a text under a locale
                    // (compared in CI with Windows' own synthesis), and what the last write's read-back inside its open found.
                    if (!TestMode.On) { Wire.Reply(id, false, Wire.Fields("reason", "unknown-op")); break; }
#if DICTATION_TEST
                    {
                        string formText = Wire.Str(request, "text") ?? "";
                        int formLocale = (int)(Wire.Num(request, "locale") ?? 0);
                        if (formLocale == 0) formLocale = ClipboardText.InputLocale();
                        byte[] ansi = ClipboardText.ExpectedTextForm(1, formText, formLocale), oem = ClipboardText.ExpectedTextForm(7, formText, formLocale);
                        Wire.Reply(id, true, Wire.Fields("locale", formLocale, "ansiCodePage", (double)ClipboardText.LocaleCodePage(formLocale, false),
                            "oemCodePage", (double)ClipboardText.LocaleCodePage(formLocale, true),
                            "ansi", ansi == null ? null : BitConverter.ToString(ansi).Replace("-", "").ToLowerInvariant(),
                            "oem", oem == null ? null : BitConverter.ToString(oem).Replace("-", "").ToLowerInvariant(),
                            "inputLocale", ClipboardText.InputLocale(), "lastWriteLocale", ClipboardText.LastWriteLocale));
                    }
#endif
                    break;
                case "__seed":
                    // Test build only (round 22): this helper's window seeds the clipboard (formats with data, and formats
                    // offered for delayed rendering that it never renders). See Delivery.TestSeed.
                    if (!TestMode.On) { Wire.Reply(id, false, Wire.Fields("reason", "unknown-op")); break; }
#if DICTATION_TEST
                    {
                        List<string> seedItems = Wire.Strings(request, "items");
                        work.Async(id, delegate { Wire.Reply(id, true, Delivery.TestSeed(seedItems)); });
                    }
#endif
                    break;
                case "__save-only":
                    // Test build only: the delivery's save and nothing else (no write, no record): what it established.
                    if (!TestMode.On) { Wire.Reply(id, false, Wire.Fields("reason", "unknown-op")); break; }
#if DICTATION_TEST
                    work.Async(id, delegate
                    {
                        SavedClipboard only = SavedClipboard.CaptureBounded(1500);
                        Wire.Reply(id, true, Wire.Fields("established", only != null, "items", only != null ? only.Count : -1,
                            "bytes", only != null ? (double)only.ByteCount : -1.0, "shape", only != null ? only.Shape() : "",
                            "skipped", only != null && only.ReportedSkip, "line", SavedClipboard.LastSaveLine));
                    });
#endif
                    break;
                case "__clip-hold":
                case "__clip-probe":
                    // Test build only (round 21): the NULL-window open experiment. "__clip-hold" opens the clipboard (with
                    // NULL or its own message-only window), enumerates, waits while another process probes, enumerates
                    // again, holds, closes. "__clip-probe" opens with NULL once, enumerates, and closes or holds.
                    if (!TestMode.On) { Wire.Reply(id, false, Wire.Fields("reason", "unknown-op")); break; }
#if DICTATION_TEST
                    {
                        string op2 = op;
                        string owner = Wire.Str(request, "owner") ?? "null";
                        int waitMs = (int)(Wire.Num(request, "waitMs") ?? 1500), holdMs = (int)(Wire.Num(request, "holdMs") ?? 1500);
                        work.Async(id, delegate { Wire.Reply(id, true, ClipboardExperiment.Run(op2 == "__clip-hold", owner, waitMs, holdMs)); });
                    }
#endif
                    break;
                case "__saturate":
                    // Test build only: act as if the bounded-call cap had just been hit (the busy restart).
                    if (!TestMode.On) { Wire.Reply(id, false, Wire.Fields("reason", "unknown-op")); break; }
                    Wire.Reply(id, true, Wire.Fields());
                    Bounded.TestSaturate();
                    break;
                case "__throw":
                    if (!TestMode.On) { Wire.Reply(id, false, Wire.Fields("reason", "unknown-op")); break; }
                    work.Async(id, delegate { throw new InvalidOperationException("boom"); });
                    break;
                case "__drop-hooks":
                    if (!TestMode.On) { Wire.Reply(id, false, Wire.Fields("reason", "unknown-op")); break; }
                    Ui.Post(id, delegate { HoldWatcher.Shared.DropKeyHookForTest(); Wire.Reply(id); });
                    break;
                case "__drop-mouse-hook":
                    if (!TestMode.On) { Wire.Reply(id, false, Wire.Fields("reason", "unknown-op")); break; }
                    Ui.Post(id, delegate { HoldWatcher.Shared.DropMouseHookForTest(); Wire.Reply(id); });
                    break;
                case "__hooks-state":
                    if (!TestMode.On) { Wire.Reply(id, false, Wire.Fields("reason", "unknown-op")); break; }
                    Ui.Post(id, delegate
                    {
                        Wire.Reply(id, true, Wire.Fields("live", HoldWatcher.Shared.HooksLive,
                            "key", HoldWatcher.Shared.KeyHookInstalled, "mouse", HoldWatcher.Shared.MouseHookInstalled));
                    });
                    break;
                case "__watchdog-tick":
                    if (!TestMode.On) { Wire.Reply(id, false, Wire.Fields("reason", "unknown-op")); break; }
                    Ui.Post(id, delegate { HoldWatcher.Shared.WatchdogTick(); Wire.Reply(id); });
                    break;
                case "__runs-above":
                    if (!TestMode.On) { Wire.Reply(id, false, Wire.Fields("reason", "unknown-op")); break; }
                    work.Async(id, delegate
                    {
                        uint pid = (uint)(Wire.Num(request, "pid") ?? 0);
                        Wire.Reply(id, true, Wire.Fields("pid", (double)pid, "above", Native.RunsAboveUs(pid)));
                    });
                    break;
                case "__foreground-above":
                    if (!TestMode.On) { Wire.Reply(id, false, Wire.Fields("reason", "unknown-op")); break; }
                    work.Async(id, delegate
                    {
                        IntPtr fg = Native.GetForegroundWindow();
                        uint pid = fg == IntPtr.Zero ? 0 : Native.WindowPid(fg);
                        Wire.Reply(id, true, Wire.Fields("foregroundPid", (double)pid, "above", pid != 0 && Native.RunsAboveUs(pid)));
                    });
                    break;
                case "__bounded-state":
                    if (!TestMode.On) { Wire.Reply(id, false, Wire.Fields("reason", "unknown-op")); break; }
                    {
                        int threads;
                        using (Process self = Process.GetCurrentProcess()) threads = self.Threads.Count;
                        Wire.Reply(id, true, Wire.Fields("abandoned", Bounded.Abandoned, "liveWorkers", Bounded.LiveThreads, "processThreads", threads));
                    }
                    break;
                case "__std-inherit":
                    if (!TestMode.On) { Wire.Reply(id, false, Wire.Fields("reason", "unknown-op")); break; }
                    {
                        List<object> handles = new List<object>();
                        foreach (int which in new[] { -10, -11, -12 })
                        {
                            IntPtr h = Native.GetStdHandle(which);
                            uint flags;
                            bool ok = Native.GetHandleInformation(h, out flags);
                            handles.Add(Wire.Fields("std", which, "handle", h.ToInt64(), "read", ok, "inherit", ok && (flags & Native.HANDLE_FLAG_INHERIT) != 0));
                        }
                        Wire.Reply(id, true, Wire.Fields("handles", handles));
                    }
                    break;
                case "__state-lock-probe":
                    if (!TestMode.On) { Wire.Reply(id, false, Wire.Fields("reason", "unknown-op")); break; }
                    work.Async(id, delegate
                    {
                        int t0 = Environment.TickCount;
                        bool ran = OutputAudio.ProbeStateLock();
                        Wire.Reply(id, true, Wire.Fields("ran", ran, "waitedMs", Environment.TickCount - t0));
                    });
                    break;
#endif
                default:
                    Wire.Reply(id, false, Wire.Fields("reason", "unknown-op"));
                    break;
            }
        }
    }
}
