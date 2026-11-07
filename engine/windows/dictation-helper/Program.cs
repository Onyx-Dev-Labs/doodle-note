using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace DoodleNote.DictationHelper
{
    /// <summary>
    /// DoodleNote dictation helper for Windows: reads one JSON request per stdin line and
    /// answers on stdout, with the same operations and replies as the macOS helper
    /// (engine/Sources/dictation-helper/main.swift). Exits when stdin closes, so it can
    /// never outlive the app. It holds no credentials and never sees provider keys.
    /// </summary>
    internal static class Program
    {
        static readonly SnapshotStore snapshots = new SnapshotStore();
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
            Wire.Start();
            Ui.Install();
            work = new WorkQueue("dictation.work");
            audio = new WorkQueue("dictation.audio");
            audio.Async(OutputAudio.RecoverLeftover);

            // Being asked to quit must never leave the user's sound muted.
            ctrlHandler = delegate(int type) { Shutdown(); return true; };
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
            // The app is gone. Make sure no hold stays "down" and no sound stays muted, then leave.
            Shutdown();
        }

        static void Shutdown()
        {
            if (Interlocked.Exchange(ref exiting, 1) == 1) return;
            Ui.Invoke(delegate { HoldWatcher.Shared.StopAll(); MouseCapture.Shared.Cancel("stopped"); return true; }, 1000, false);
            audio.Sync(delegate { OutputAudio.Restore(); }, 2000);
            Wire.Drain(500);
            Environment.Exit(0);
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
                            DeliveryResult result = Delivery.Deliver(snapshot, text, guards, deadlineMs, queuedMs);
                            // A snapshot is single-use: a second deliver can never re-insert.
                            snapshots.Drop(snapshotId);
                            // Keep the field for read-backs only when asked, only after a confirmed
                            // insertion, and never a secure field.
                            if (watch && result.Outcome == DeliveryOutcome.Delivered && snapshot.Element != null
                                && !(snapshot.Facts != null && snapshot.Facts.Secure))
                                watches.Start(snapshotId, snapshot.Pid, snapshot.Element);
                            Wire.Reply(id, true, result.Fields());
                        });
                    }
                    break;
                case "watch-read":
                    {
                        string watchId = Wire.Str(request, "watchId") ?? "";
                        work.Async(id, delegate
                        {
                            FieldWatches.Watch watch = watches.Get(watchId);
                            Wire.Reply(id, true, watch == null ? Wire.Fields("state", "gone") : FieldRead.Read(watch));
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
                            System.Windows.Automation.AutomationElement current;
                            if (!Target.StillFocused(snapshot, out current))
                            {
                                Wire.Reply(id, false, Wire.Fields("reason", "focus-changed"));
                                return;
                            }
                            ElementFacts facts = ElementFacts.Of(current, Target.CurrentGui());
                            if (facts.Secure || (snapshot.Facts != null && snapshot.Facts.Secure))
                            {
                                Wire.Reply(id, false, Wire.Fields("reason", "secure-field"));
                                return;
                            }
                            Wire.Reply(id, true, Wire.Fields("text", UIA.Selection(current) ?? ""));
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
                case "__throw":
                    if (Environment.GetEnvironmentVariable("DICTATION_HELPER_TEST") != null)
                        work.Async(id, delegate { throw new InvalidOperationException("boom"); });
                    else Wire.Reply(id, false, Wire.Fields("reason", "unknown-op"));
                    break;
                case "__drop-hooks":
                    if (Environment.GetEnvironmentVariable("DICTATION_HELPER_TEST") != null)
                        Ui.Post(id, delegate { HoldWatcher.Shared.DropKeyHookForTest(); Wire.Reply(id); });
                    else Wire.Reply(id, false, Wire.Fields("reason", "unknown-op"));
                    break;
                case "__watchdog-tick":
                    if (Environment.GetEnvironmentVariable("DICTATION_HELPER_TEST") != null)
                        Ui.Post(id, delegate { HoldWatcher.Shared.WatchdogTick(); Wire.Reply(id); });
                    else Wire.Reply(id, false, Wire.Fields("reason", "unknown-op"));
                    break;
                default:
                    Wire.Reply(id, false, Wire.Fields("reason", "unknown-op"));
                    break;
            }
        }
    }
}
