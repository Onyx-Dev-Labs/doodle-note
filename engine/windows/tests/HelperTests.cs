using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;

namespace DoodleNote.DictationHelper.Tests
{
    /// <summary>
    /// Logic tests for the Windows dictation helper: no hooks, no clipboard, no audio.
    /// The hold-machine cases mirror engine/tests/dictation-helper-tests/HoldMachineTests.swift.
    /// Run: dictation-helper-tests.exe (exit code 0 = all passed).
    /// </summary>
    internal static class Runner
    {
        static int Main()
        {
            int passed = 0, failed = 0;
            foreach (MethodInfo test in typeof(Cases).GetMethods(BindingFlags.Static | BindingFlags.Public).OrderBy(m => m.Name))
            {
                try
                {
                    test.Invoke(null, null);
                    passed++;
                    Console.WriteLine("ok - " + test.Name);
                }
                catch (TargetInvocationException error)
                {
                    failed++;
                    Console.WriteLine("not ok - " + test.Name + ": " + error.InnerException.Message);
                }
            }
            Console.WriteLine("# pass " + passed);
            Console.WriteLine("# fail " + failed);
            return failed == 0 ? 0 : 1;
        }
    }

    internal static class Assert
    {
        public static void Equal(object expected, object actual, string what)
        {
            if (!object.Equals(expected, actual)) throw new Exception(what + ": expected " + expected + ", got " + actual);
        }
        public static void True(bool value, string what) { if (!value) throw new Exception(what); }
        public static void Outputs(List<HoldMachine.Output> actual, params string[] expected)
        {
            string got = string.Join(" ", actual.Select(o => o.ToString()));
            string want = string.Join(" ", expected);
            if (got != want) throw new Exception("expected [" + want + "], got [" + got + "]");
        }
    }

    public static class Cases
    {
        static HoldMachine.Input I(HoldMachine.Kind kind) { return HoldMachine.Input.Of(kind); }
        static HoldMachine.Input Btn(HoldMachine.Kind kind, int button) { return HoldMachine.Input.Press(kind, button); }
        static HoldMachine.Input St(HoldMachine.Kind kind, bool down) { return HoldMachine.Input.State(kind, down); }
        const string Cancel = "CancelAnnounce", Schedule = "ScheduleAnnounce";

        public static void HoldIsAnnouncedAfterTheDelayAndPairedOnRelease()
        {
            HoldMachine m = HoldMachine.ForKey(0);
            Assert.Outputs(m.Handle(I(HoldMachine.Kind.KeyDown)), Cancel, Schedule);
            Assert.Outputs(m.Handle(I(HoldMachine.Kind.AnnounceTimer)), "holdDown(1)");
            Assert.Outputs(m.Handle(I(HoldMachine.Kind.KeyUp)), Cancel, "holdUp(1,released)");
        }

        public static void ReleaseBeforeTheDelayIsATapAndNeverAHold()
        {
            HoldMachine m = HoldMachine.ForKey(0);
            m.Handle(I(HoldMachine.Kind.KeyDown));
            Assert.Outputs(m.Handle(I(HoldMachine.Kind.KeyUp)), Cancel, "Tap");
            Assert.Outputs(m.Handle(I(HoldMachine.Kind.AnnounceTimer)));
        }

        public static void TwoQuickTapsAreTwoTapEvents()
        {
            HoldMachine m = HoldMachine.ForKey(0);
            int taps = 0;
            for (int i = 0; i < 2; i++)
            {
                m.Handle(I(HoldMachine.Kind.KeyDown));
                taps += m.Handle(I(HoldMachine.Kind.KeyUp)).Count(o => o.Kind == HoldMachine.OutKind.Tap);
            }
            Assert.Equal(2, taps, "taps");
        }

        public static void AnotherKeyMakesItAChordNotATapOrHold()
        {
            HoldMachine m = HoldMachine.ForKey(0);
            m.Handle(I(HoldMachine.Kind.KeyDown));
            m.Handle(I(HoldMachine.Kind.OtherKeyDown));
            Assert.Outputs(m.Handle(I(HoldMachine.Kind.AnnounceTimer)));
            Assert.Outputs(m.Handle(I(HoldMachine.Kind.KeyUp)), Cancel);
        }

        public static void AKeyStruckDuringAnAnnouncedHoldDoesNotEndIt()
        {
            HoldMachine m = HoldMachine.ForKey(0);
            m.Handle(I(HoldMachine.Kind.KeyDown));
            m.Handle(I(HoldMachine.Kind.AnnounceTimer));
            Assert.Outputs(m.Handle(I(HoldMachine.Kind.OtherKeyDown)));
            Assert.Outputs(m.Handle(I(HoldMachine.Kind.KeyUp)), Cancel, "holdUp(1,released)");
        }

        public static void ALostKeyReleaseIsNoticedFromTheLiveKeyState()
        {
            HoldMachine m = HoldMachine.ForKey(0);
            m.Handle(I(HoldMachine.Kind.KeyDown));
            m.Handle(I(HoldMachine.Kind.AnnounceTimer));
            Assert.Outputs(m.Handle(St(HoldMachine.Kind.KeyState, true)));
            Assert.Outputs(m.Handle(St(HoldMachine.Kind.KeyState, false)), Cancel, "holdUp(1,released)");
            Assert.Outputs(m.Handle(I(HoldMachine.Kind.KeyUp)));
        }

        public static void AutoRepeatDoesNotRestartTheDelay()
        {
            HoldMachine m = HoldMachine.ForKey(0);
            m.Handle(I(HoldMachine.Kind.KeyDown));
            Assert.Outputs(m.Handle(I(HoldMachine.Kind.KeyDown)));
            Assert.Outputs(m.Handle(I(HoldMachine.Kind.AnnounceTimer)), "holdDown(1)");
            Assert.Outputs(m.Handle(I(HoldMachine.Kind.KeyDown)));
        }

        public static void TapDisabledEndsAnAnnouncedHold()
        {
            HoldMachine m = HoldMachine.ForKey(0);
            m.Handle(I(HoldMachine.Kind.KeyDown));
            m.Handle(I(HoldMachine.Kind.AnnounceTimer));
            Assert.Outputs(m.Handle(I(HoldMachine.Kind.TapDisabled)), "holdUp(1,tap-disabled)");
            Assert.True(!m.IsDown, "released");
        }

        public static void ResetEndsAnAnnouncedHoldOnce()
        {
            HoldMachine m = HoldMachine.ForKey(0);
            m.Handle(I(HoldMachine.Kind.KeyDown));
            m.Handle(I(HoldMachine.Kind.AnnounceTimer));
            Assert.Outputs(m.Handle(I(HoldMachine.Kind.Reset)), Cancel, "holdUp(1,stopped)");
            Assert.Outputs(m.Handle(I(HoldMachine.Kind.Reset)), Cancel);
        }

        public static void HoldIdsKeepCountingAcrossRestarts()
        {
            HoldMachine m = HoldMachine.ForKey(4);
            m.Handle(I(HoldMachine.Kind.KeyDown));
            Assert.Outputs(m.Handle(I(HoldMachine.Kind.AnnounceTimer)), "holdDown(5)");
        }

        public static void KeyMachineIgnoresMouseInputsAndMouseMachineIgnoresKeys()
        {
            HoldMachine key = HoldMachine.ForKey(0);
            Assert.Outputs(key.Handle(Btn(HoldMachine.Kind.ButtonDown, 2)));
            HoldMachine mouse = HoldMachine.ForMouse(3, false, 0);
            Assert.Outputs(mouse.Handle(I(HoldMachine.Kind.KeyDown)));
            Assert.Outputs(mouse.Handle(St(HoldMachine.Kind.KeyState, false)));
        }

        public static void MouseHoldIsAnnouncedAndPairedOnRelease()
        {
            HoldMachine m = HoldMachine.ForMouse(3, false, 0);
            Assert.Outputs(m.Handle(Btn(HoldMachine.Kind.ButtonDown, 3)), Cancel, Schedule);
            Assert.Outputs(m.Handle(I(HoldMachine.Kind.AnnounceTimer)), "holdDown(1)");
            Assert.Outputs(m.Handle(Btn(HoldMachine.Kind.ButtonUp, 3)), Cancel, "holdUp(1,released)");
        }

        public static void OnlyTheConfiguredButtonCounts()
        {
            HoldMachine m = HoldMachine.ForMouse(3, false, 0);
            Assert.Outputs(m.Handle(Btn(HoldMachine.Kind.ButtonDown, 4)));
            Assert.Outputs(m.Handle(Btn(HoldMachine.Kind.ButtonUp, 4)));
        }

        public static void OtherKeysNeverSpoilAMouseHold()
        {
            HoldMachine m = HoldMachine.ForMouse(2, false, 0);
            m.Handle(Btn(HoldMachine.Kind.ButtonDown, 2));
            m.Handle(I(HoldMachine.Kind.OtherKeyDown));
            Assert.Outputs(m.Handle(I(HoldMachine.Kind.AnnounceTimer)), "holdDown(1)");
        }

        public static void ALostButtonReleaseIsNoticedFromTheLiveButtonState()
        {
            HoldMachine m = HoldMachine.ForMouse(2, false, 0);
            m.Handle(Btn(HoldMachine.Kind.ButtonDown, 2));
            m.Handle(I(HoldMachine.Kind.AnnounceTimer));
            Assert.Outputs(m.Handle(St(HoldMachine.Kind.ButtonState, false)), Cancel, "holdUp(1,released)");
        }

        public static void ClickModeReportsEveryPressAsOneClick()
        {
            HoldMachine m = HoldMachine.ForMouse(4, true, 0);
            Assert.Outputs(m.Handle(Btn(HoldMachine.Kind.ButtonDown, 4)), "Click");
            Assert.Outputs(m.Handle(I(HoldMachine.Kind.AnnounceTimer)));
            Assert.Outputs(m.Handle(Btn(HoldMachine.Kind.ButtonUp, 4)));
            Assert.Outputs(m.Handle(Btn(HoldMachine.Kind.ButtonDown, 3)));
            Assert.Outputs(m.Handle(St(HoldMachine.Kind.ButtonState, false)));
        }

        public static void TheFirstSourceHeldOwnsTheSession()
        {
            HoldArbiter arbiter = new HoldArbiter();
            HoldMachine.Output down = new HoldMachine.Output { Kind = HoldMachine.OutKind.HoldDown, Id = 1 };
            HoldMachine.Output up = new HoldMachine.Output { Kind = HoldMachine.OutKind.HoldUp, Id = 1, Reason = "released" };
            HoldMachine.Output tap = new HoldMachine.Output { Kind = HoldMachine.OutKind.Tap };
            Assert.True(arbiter.Allow(down, HoldArbiter.Source.Key), "key owns");
            Assert.True(!arbiter.Allow(down, HoldArbiter.Source.Mouse), "mouse ignored");
            Assert.True(!arbiter.Allow(tap, HoldArbiter.Source.Mouse), "tap ignored while held");
            Assert.True(!arbiter.Allow(up, HoldArbiter.Source.Mouse), "orphan release dropped");
            Assert.True(arbiter.Allow(up, HoldArbiter.Source.Key), "owner releases");
            Assert.True(arbiter.Allow(tap, HoldArbiter.Source.Mouse), "free again");
        }

        public static void KeyNamesMapToWindowsKeys()
        {
            Assert.Equal(0xA5, HoldKeySpec.Named("rightOption").Vk, "Right Alt");
            Assert.True(HoldKeySpec.Named("rightOption").NeedsMask, "Right Alt is masked");
            Assert.Equal(0xA3, HoldKeySpec.Named("rightControl").Vk, "Right Ctrl");
            Assert.True(!HoldKeySpec.Named("rightControl").NeedsMask, "Right Ctrl needs no mask");
            Assert.Equal(0x5C, HoldKeySpec.Named("rightCommand").Vk, "Right Windows key");
            Assert.True(HoldKeySpec.Named("fn") == null, "no Fn on Windows");
            Assert.True(HoldKeySpec.Named("") == null, "unknown");
        }

        public static void OnlyMiddleBackAndForwardButtonsAreTriggers()
        {
            for (int b = -1; b <= 6; b++) Assert.Equal(b >= 2 && b <= 4, HoldWatcher.AllowedButton(b), "button " + b);
        }

        public static void AUniqueMatchIsFoundInUtf16Units()
        {
            Assert.Equal(6, TextLocator.UniqueIndex("world", "hello world"), "plain");
            Assert.Equal(3, TextLocator.UniqueIndex("café", "😀 café"), "emoji counts two units");
            Assert.Equal(-1, TextLocator.UniqueIndex("aa", "aaa"), "overlapping copies count as two");
            Assert.Equal(-1, TextLocator.UniqueIndex("x", "x x"), "two copies");
            Assert.Equal(-1, TextLocator.UniqueIndex("", "abc"), "empty");
            Assert.Equal(-1, TextLocator.UniqueIndex("z", "abc"), "missing");
        }

        public static void DeliveryResultFieldsMatchTheProtocol()
        {
            DeliveryResult result = new DeliveryResult(DeliveryOutcome.Uncertain, "insertion-unverifiable");
            result.Method = "paste";
            result.Clipboard = "restored";
            result.Timings = new DeliveryTimings { ValidateMs = 1, InsertMs = 2, ConfirmMs = 3, SettleMs = 600 };
            string json = Wire.Serialize(result.Fields());
            Dictionary<string, object> back = Wire.Parse(json);
            Assert.Equal("uncertain", back["outcome"], "outcome");
            Assert.Equal("insertion-unverifiable", back["reason"], "reason");
            Assert.Equal("paste", back["method"], "method");
            Assert.Equal(false, back["verified"], "verified");
            Assert.Equal("restored", back["clipboard"], "clipboard");
            Dictionary<string, object> timings = (Dictionary<string, object>)back["timings"];
            Assert.Equal(600, timings["settleMs"], "settle");
            Assert.Equal(false, timings["skippedAx"], "skippedAx");
            Assert.True(!back.ContainsKey("charsDelivered") && !back.ContainsKey("charsUnconfirmed"), "no typing counts for a paste");
            DeliveryResult stopped = new DeliveryResult(DeliveryOutcome.Uncertain, "secure-field");
            stopped.Method = "type";
            stopped.CharsDelivered = 7;
            stopped.CharsUnconfirmed = 1;
            stopped.Clipboard = "unrestored";
            stopped.ClipboardHolds = "foreign";
            Dictionary<string, object> typed = Wire.Parse(Wire.Serialize(stopped.Fields()));
            Assert.Equal("secure-field", typed["reason"], "the specific abort reason is kept");
            Assert.Equal(7, typed["charsDelivered"], "confirmed characters");
            Assert.Equal(1, typed["charsUnconfirmed"], "the unconfirmed key is reported separately");
            Assert.Equal("foreign", typed["clipboardHolds"], "what the clipboard holds");
            Assert.Equal("delivered", new DeliveryResult(DeliveryOutcome.Delivered, null).Fields()["outcome"], "delivered");
            Assert.True(!new DeliveryResult(DeliveryOutcome.Delivered, null).Fields().ContainsKey("reason"), "no reason");
        }

        public static void RequestsAreReadTolerantly()
        {
            Dictionary<string, object> r = Wire.Parse("{\"op\":\"mouse-start\",\"id\":\"a\",\"button\":3,\"swallow\":true,\"minHoldMs\":150.0,\"bundleIds\":[\"slack.exe\",4,\"zoom.exe\"],\"text\":\"caf\\u00e9 \\ud83d\\ude00\\n\"}");
            Assert.Equal("mouse-start", Wire.Str(r, "op"), "op");
            Assert.Equal(3.0, Wire.Num(r, "button"), "button");
            Assert.Equal(150.0, Wire.Num(r, "minHoldMs"), "decimal number");
            Assert.Equal(true, Wire.Bool(r, "swallow"), "bool");
            Assert.Equal(null, Wire.Bool(r, "missing"), "missing bool");
            Assert.Equal(null, Wire.Str(r, "button"), "number is not a string");
            Assert.Equal("slack.exe,zoom.exe", string.Join(",", Wire.Strings(r, "bundleIds")), "string list skips junk");
            Assert.Equal("café 😀\n", Wire.Str(r, "text"), "unicode text");
            Assert.True(Wire.Parse("not json") == null, "junk line");
            Assert.True(Wire.Parse("[1,2]") == null, "not an object");
        }

        public static void RepliesCarryEventIdAndOk()
        {
            Dictionary<string, object> fields = Wire.Fields("trusted", true);
            Dictionary<string, object> payload = new Dictionary<string, object>(fields);
            payload["event"] = "reply";
            payload["id"] = "x";
            payload["ok"] = true;
            string json = Wire.Serialize(payload);
            Assert.True(json.Contains("\"event\":\"reply\"") && json.Contains("\"id\":\"x\"") && json.Contains("\"ok\":true"), json);
            Assert.True(!json.Contains("\n"), "one line");
        }

        sealed class FakeOutput : IOutputDeviceControl
        {
            public string Device = "speakers";
            public bool Present = true;
            public bool? Muted = false;
            public float? Level = 0.5f;
            public int Writes;
            public string DefaultDevice() { return Device; }
            public bool Exists(string device) { return Present && device == Device; }
            public bool? MuteSwitch(string device) { return Muted; }
            public bool SetMuteSwitch(string device, bool muted) { if (!Muted.HasValue) return false; Muted = muted; Writes++; return true; }
            public float? Volume(string device) { return Level; }
            public bool SetVolume(string device, float value) { Level = value; Writes++; return true; }
        }

        public static void MutesWithTheSwitchAndGivesTheSoundBack()
        {
            FakeOutput device = new FakeOutput();
            OutputMuter muter = new OutputMuter(device);
            Assert.Equal("muted", muter.Mute(), "mute");
            Assert.Equal(true, device.Muted, "muted now");
            Assert.Equal("already-held", muter.Mute(), "second mute");
            Assert.Equal("restored", muter.Restore(), "restore");
            Assert.Equal(false, device.Muted, "unmuted");
            Assert.Equal("nothing", muter.Restore(), "second restore");
            Assert.Equal(2, device.Writes, "two writes");
        }

        public static void AnOutputAlreadySilentIsNeverTouched()
        {
            FakeOutput device = new FakeOutput { Muted = true };
            OutputMuter muter = new OutputMuter(device);
            Assert.Equal("already-silent", muter.Mute(), "muted already");
            Assert.Equal("nothing", muter.Restore(), "nothing held");
            Assert.Equal(true, device.Muted, "still muted");
            FakeOutput quiet = new FakeOutput { Muted = null, Level = 0 };
            Assert.Equal("already-silent", new OutputMuter(quiet).Mute(), "zero volume");
            Assert.Equal(0, device.Writes + quiet.Writes, "no writes");
        }

        public static void FallsBackToTheVolumeAndRestoresItsLevel()
        {
            FakeOutput device = new FakeOutput { Muted = null, Level = 0.42f };
            OutputMuter muter = new OutputMuter(device);
            Assert.Equal("muted", muter.Mute(), "mute by volume");
            Assert.Equal(0f, device.Level, "volume zero");
            Assert.Equal("restored", muter.Restore(), "restore");
            Assert.Equal(0.42f, device.Level, "level back");
        }

        public static void ASoundTheUserChangedMeanwhileIsLeftAlone()
        {
            FakeOutput device = new FakeOutput();
            OutputMuter muter = new OutputMuter(device);
            muter.Mute();
            device.Muted = false; // the user unmuted
            Assert.Equal("user-changed", muter.Restore(), "user took over");
            FakeOutput byVolume = new FakeOutput { Muted = null, Level = 0.3f };
            OutputMuter second = new OutputMuter(byVolume);
            second.Mute();
            byVolume.Level = 0.8f;
            Assert.Equal("user-changed", second.Restore(), "volume raised");
            Assert.Equal(0.8f, byVolume.Level, "kept");
        }

        public static void NoDeviceUnsupportedAndAVanishedDevice()
        {
            Assert.Equal("no-device", new OutputMuter(new FakeOutput { Device = null }).Mute(), "none");
            Assert.Equal("unsupported", new OutputMuter(new FakeOutput { Muted = null, Level = null }).Mute(), "unsupported");
            FakeOutput gone = new FakeOutput();
            OutputMuter muter = new OutputMuter(gone);
            muter.Mute();
            gone.Present = false;
            Assert.Equal("gone", muter.Restore(), "gone");
        }

        public static void MicNameMatchingStripsOnlyTheChromiumHardwareSuffix()
        {
            // The Chromium "(vid:pid)" tail is dropped; device-name parentheses are kept, so two
            // microphones that differ only by their "(USB A)/(USB B)" tail stay distinct.
            Assert.Equal("microphone", CoreAudio.Normalize("Microphone (1234:5678)"), "hardware suffix stripped");
            Assert.Equal("microphone", CoreAudio.Normalize("  Microphone  "), "trimmed, lower-cased");
            Assert.True(CoreAudio.Normalize("Microphone (USB A)") != CoreAudio.Normalize("Microphone (USB B)"), "device-name parentheses kept distinct");
            Assert.Equal("microphone (usb a)", CoreAudio.Normalize("Microphone (USB A) (0a1b:2c3d)"), "name kept, hardware tail removed");
            Assert.Equal("", CoreAudio.Normalize(null), "null is empty");
        }

        public static void ALeftoverSilenceIsAdoptedAndGivenBack()
        {
            FakeOutput device = new FakeOutput { Muted = true };
            OutputMuter muter = new OutputMuter(device);
            muter.Adopt("speakers", null);
            Assert.Equal("restored", muter.Restore(), "given back");
            Assert.Equal(false, device.Muted, "unmuted");
        }

        public static void KeyboardLossIsOneSuspectTickAndAnyCallbackClearsIt()
        {
            HookLossDetector key = new HookLossDetector(1);
            Assert.Equal(false, key.Observe(false, false, false), "quiet tick: nothing");
            Assert.Equal(false, key.Observe(false, true, false), "a callback: alive");
            Assert.Equal(true, key.Observe(true, false, false), "the armed key moved with no callback: lost");
            Assert.Equal(false, key.Observe(true, true, false), "a callback in the same tick is not suspect evidence");
        }

        public static void MouseLossNeedsTwoSuspectTicksEvenWithQuietTicksBetween()
        {
            HookLossDetector mouse = new HookLossDetector(2, false);
            Assert.Equal(false, mouse.Observe(true, false, false), "one cursor move without a callback (an app moving it) is not a loss");
            Assert.Equal(false, mouse.Observe(false, false, false), "a quiet tick does not clear the evidence");
            Assert.Equal(false, mouse.Observe(false, false, false), "nor does another");
            Assert.Equal(true, mouse.Observe(true, false, false), "a second suspect tick, however far apart: lost");
            Assert.Equal(false, mouse.Observe(true, false, false), "evidence is cleared once a loss is declared");
            Assert.Equal(false, mouse.Observe(false, true, false), "a callback proves it alive and clears the evidence");
            Assert.Equal(false, mouse.Observe(true, false, false), "so the count starts again");
            HookLossDetector key = new HookLossDetector(2, true);
            key.Observe(true, false, false);
            key.Observe(false, false, false);
            Assert.Equal(false, key.Observe(true, false, false), "the consecutive rule still resets on a quiet tick");
        }

        public static void AHigherIntegrityForegroundOnlyCountsEvidenceThenNeedsTwoTicksAfter()
        {
            HookLossDetector key = new HookLossDetector(1);
            Assert.Equal(false, key.Observe(true, false, true), "above us: counted, never acted on");
            Assert.Equal(false, key.Observe(true, false, true), "still above us");
            Assert.Equal(2, key.EvidenceWhileAbove, "evidence kept while above");
            Assert.Equal(false, key.Observe(true, false, false), "back from it: one suspect tick is not enough");
            Assert.Equal(true, key.Observe(true, false, false), "two consecutive suspect ticks after it: lost");
            // A callback after returning proves the hook alive and resets the stricter rule.
            HookLossDetector alive = new HookLossDetector(1);
            alive.Observe(true, false, true);
            Assert.Equal(false, alive.Observe(false, true, false), "callbacks resumed: alive");
            Assert.Equal(true, alive.Observe(true, false, false), "later, the normal one-tick rule applies again");
        }

        public static void TheHookRetryAttemptsAtFourEightSixteenAndThirtySeconds()
        {
            // A 2 s watchdog tick; every attempt fails. Record the elapsed time of each attempt.
            RetryClock clock = new RetryClock(2000);
            List<int> attempts = new List<int>();
            for (int tick = 0; tick <= 60; tick++)
            {
                if (!clock.Tick()) continue;
                attempts.Add(tick * 2000);
                clock.Failed();
            }
            // Gaps between attempts: 4, 8, 16, 30, 30 ... seconds (not one tick later).
            int[] gaps = { 4000, 8000, 16000, 30000, 30000 };
            Assert.Equal(0, attempts[0], "first attempt at once");
            for (int i = 0; i < gaps.Length; i++) Assert.Equal(gaps[i], attempts[i + 1] - attempts[i], "gap " + i);
            clock.Succeeded();
            Assert.Equal(true, clock.Tick(), "after a success the next loss is retried at once");
        }

        public static void TestFacilitiesAreOffWithoutTheSwitch()
        {
            // The logic tests are a DICTATION_TEST build, but the facilities still need DICTATION_HELPER_TEST=1.
            if (Environment.GetEnvironmentVariable("DICTATION_HELPER_TEST") == "1") return;
            Assert.Equal(false, TestMode.On, "off without the switch");
            Assert.Equal(null, TestMode.Env("DICTATION_HELPER_STRATEGY"), "no test environment read");
            Assert.Equal(7, TestMode.Int("DICTATION_HELPER_WATCHDOG_MS", 7), "fallback used");
        }

        public static void TwoAppIdentitiesNeverShareTheMuteRecordOrItsLock()
        {
            Assert.Equal("com.doodlenote.desktop", HelperIdentity.Sanitize(null), "default identity");
            Assert.Equal("com.doodlenote.desktop", HelperIdentity.Sanitize("   "), "blank is the default");
            Assert.Equal("com.doodlenote.qa", HelperIdentity.Sanitize("com.doodlenote.qa"), "kept as is");
            Assert.Equal("a_b_c__d", HelperIdentity.Sanitize("a\\b/c:\\d"), "path and drive characters replaced");
            Assert.Equal(64, HelperIdentity.Sanitize(new string('x', 200)).Length, "length capped");
            string prod = HelperIdentity.Sanitize("com.doodlenote.desktop"), qa = HelperIdentity.Sanitize("com.doodlenote.desktop.qa");
            Assert.True(HelperIdentity.OutputMutexName(prod) != HelperIdentity.OutputMutexName(qa), "distinct mutexes");
            Assert.True(HelperIdentity.OutputStateFileName(prod) != HelperIdentity.OutputStateFileName(qa), "distinct state files");
            Assert.Equal("Local\\DoodleNote-Bark-output-com.doodlenote.desktop", HelperIdentity.OutputMutexName(prod), "mutex name");
            Assert.Equal("DoodleNote-Bark-output-com.doodlenote.desktop.json", HelperIdentity.OutputStateFileName(prod), "file name");
        }

        public static void MouseEvidenceOlderThanTheWindowExpires()
        {
            HookLossDetector mouse = new HookLossDetector(2, false, 5);
            Assert.Equal(false, mouse.Observe(true, false, false), "first suspect");
            for (int i = 0; i < 4; i++) Assert.Equal(false, mouse.Observe(false, false, false), "quiet tick " + i);
            Assert.Equal(false, mouse.Observe(true, false, false), "five ticks (10 s) later the first suspect has expired");
            Assert.Equal(true, mouse.Observe(true, false, false), "two suspects inside the window: lost");
            HookLossDetector near = new HookLossDetector(2, false, 5);
            near.Observe(true, false, false);
            near.Observe(false, false, false);
            near.Observe(false, false, false);
            Assert.Equal(true, near.Observe(true, false, false), "two suspects three ticks apart: lost");
        }

        public static void ClassicTextBoxesAreAnExactAllowlist()
        {
            string[] classic = { "Edit", "RICHEDIT50W", "RichEdit20W", "RichEditD2DPT",
                "WindowsForms10.EDIT.app.0.141b42a_r6_ad1", "WindowsForms10.RichEdit20W.app.0.141b42a_r6_ad1", "WindowsForms10.RICHEDIT50W.app.0.2bf8098_r6_ad1" };
            foreach (string name in classic) Assert.True(ClassicTextBox.IsClassicClass(name, ""), name + " is a classic text box");
            Assert.Equal(ClassicTextBox.ClassKind.RichEdit, ClassicTextBox.Classify("WindowsForms10.RICHEDIT50W.app.0.2bf8098_r6_ad1", ""), "WinForms RichEdit is a RichEdit");
            Assert.Equal(ClassicTextBox.ClassKind.Edit, ClassicTextBox.Classify("TMyMemo", "Edit"), "a superclassed Edit (RealGetWindowClass) counts");
            Assert.Equal(ClassicTextBox.ClassKind.RichEdit, ClassicTextBox.Classify("MyRich", "RICHEDIT50W"), "a superclass whose real class is RICHEDIT50W counts");
            Assert.Equal(ClassicTextBox.ClassKind.None, ClassicTextBox.Classify("MyRich", "MyRich"), "an unknown class is refused whatever it answers");
            Assert.Equal(ClassicTextBox.ClassKind.None, ClassicTextBox.Classify("RichEdit20A", "RichEdit20A"), "ANSI RichEdit is refused (DBCS lengths)");
            Assert.Equal(ClassicTextBox.ClassKind.None, ClassicTextBox.Classify("MyAnsiRich", "RichEdit20A"), "a superclass of ANSI RichEdit is refused");
            string[] lookalikes = { "RichEditor", "RichEdit", "RichEdit20WX", "RichEditD2D", "EDIT.Custom", "MyEdit", "WindowsForms10.EDITOR.app.0.1",
                "WindowsForms10.EDIT", "WindowsForms10.Window.8.app.0.141b42a_r6_ad1" };
            foreach (string name in lookalikes) Assert.True(!ClassicTextBox.IsClassicClass(name, name), name + " is not on the allowlist (only RealGetWindowClass can vouch for a superclass)");
            string[] uiaOnly = { "Chrome_RenderWidgetHostHWND", "Chrome_WidgetWin_1", "MozillaWindowClass", "Windows.UI.Core.CoreWindow",
                "Windows.UI.Input.InputSite.WindowClass", "SunAwtFrame", "SunAwtCanvas", "Qt5QWindowIcon", "Qt663QWindowIcon", "_WwG", "EXCEL7",
                "OpusApp", "Intermediate D3D Window", "CefBrowserWindow", "WebView2", "DirectUIHWND", "Scintilla", "" };
            foreach (string name in uiaOnly) Assert.True(!ClassicTextBox.IsClassicClass(name, name), name + " gets no typing fallback");
        }

        static int BoundedIdle()
        {
            for (int i = 0; i < 200 && (Bounded.Abandoned > 0 || Bounded.LiveThreads > 1); i++) System.Threading.Thread.Sleep(10);
            return System.Diagnostics.Process.GetCurrentProcess().Threads.Count;
        }

        public static void TwentyOverrunsKeepTheThreadCountBoundedAndItReturnsToBaseline()
        {
            int warm;
            Bounded.Run(() => 1, 1000, out warm); // the one current worker exists before the baseline
            int baseline = BoundedIdle();
            System.Threading.ManualResetEventSlim stuck = new System.Threading.ManualResetEventSlim(false);
            int timedOut = 0, busy = 0, peakLive = 0, peakThreads = 0;
            for (int i = 0; i < 20; i++)
            {
                int result;
                Bounded.Outcome outcome = Bounded.Call(token => { stuck.Wait(); return 1; }, 20, out result);
                if (outcome == Bounded.Outcome.TimedOut) timedOut++;
                if (outcome == Bounded.Outcome.Busy) busy++;
                peakLive = Math.Max(peakLive, Bounded.LiveThreads);
                peakThreads = Math.Max(peakThreads, System.Diagnostics.Process.GetCurrentProcess().Threads.Count);
            }
            Assert.Equal(Bounded.MaxAbandoned, timedOut, "only the cap's worth of calls may be stuck");
            Assert.Equal(20 - Bounded.MaxAbandoned, busy, "past the cap every call is refused at once (helper busy)");
            Assert.Equal(Bounded.MaxAbandoned, Bounded.Abandoned, "the stuck workers are counted exactly");
            Assert.True(peakLive <= Bounded.MaxAbandoned + 1, "live worker threads stay bounded (" + peakLive + ")");
            Assert.True(peakThreads <= baseline + Bounded.MaxAbandoned + 2, "process threads stay bounded (" + baseline + " -> " + peakThreads + ")");
            stuck.Set();
            int after = BoundedIdle();
            Assert.Equal(0, Bounded.Abandoned, "every retired worker ended once its call returned");
            Assert.True(Bounded.LiveThreads <= 1, "back to at most the one current worker");
            Assert.True(after <= baseline + 1, "process threads back to baseline (" + baseline + " -> " + after + ")");
            int again;
            Assert.Equal(Bounded.Outcome.Ok, Bounded.Call(token => 5, 1000, out again), "calls work again");
            Assert.Equal(5, again, "with their result");
        }

        public static void ACallGivenUpOnNeverAppliesItsSideEffectLater()
        {
            System.Threading.ManualResetEventSlim gate = new System.Threading.ManualResetEventSlim(false);
            int applied = 0, queuedRan = 0, result;
            bool mayHaveApplied;
            Bounded.Outcome outcome = Bounded.Call(token =>
            {
                gate.Wait();
                token.Commit(delegate { applied++; });
                return 1;
            }, 20, out result, out mayHaveApplied);
            Assert.Equal(Bounded.Outcome.TimedOut, outcome, "the call overran");
            Assert.Equal(false, mayHaveApplied, "nothing had been applied when it was given up on");
            gate.Set();
            BoundedIdle();
            Assert.Equal(0, applied, "the late side effect was refused");
            Assert.Equal(0, queuedRan, "nothing ran late");
            // A side effect already under way when the caller gives up is reported, never hidden.
            System.Threading.ManualResetEventSlim inside = new System.Threading.ManualResetEventSlim(false);
            outcome = Bounded.Call(token =>
            {
                token.Commit(delegate { inside.Wait(); });
                return 1;
            }, 20, out result, out mayHaveApplied);
            Assert.Equal(Bounded.Outcome.TimedOut, outcome, "overran inside the side effect");
            Assert.Equal(true, mayHaveApplied, "reported as possibly applied");
            inside.Set();
            BoundedIdle();
            // A call that throws AFTER its side effect began is a failure that may have applied.
            outcome = Bounded.Call<int>(token =>
            {
                token.Commit(delegate { applied++; });
                throw new InvalidOperationException("after the commit");
            }, 1000, out result, out mayHaveApplied);
            Assert.Equal(Bounded.Outcome.Failed, outcome, "it threw");
            Assert.Equal(true, mayHaveApplied, "thrown after the commit: may have applied");
            outcome = Bounded.Call<int>(token => { throw new InvalidOperationException("before"); }, 1000, out result, out mayHaveApplied);
            Assert.Equal(false, mayHaveApplied, "thrown before any side effect: nothing applied");
        }

        public static void PrivacyMarkedClipboardsAreNeverWrittenDown()
        {
            string dir = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "dn-pending-test-" + Guid.NewGuid().ToString("N"));
            System.IO.Directory.CreateDirectory(dir);
            string old = PendingClipboard.Directory;
            PendingClipboard.Directory = dir;
            try
            {
                var items = new[] { new KeyValuePair<uint, byte[]>(13, System.Text.Encoding.Unicode.GetBytes("secret\0")) };
                PendingRecord marked = PendingClipboard.Begin(SavedClipboard.ForTest(items, true), "dictated");
                Assert.Equal(false, marked.Persisted, "content with a privacy marker stays in memory");
                Assert.Equal(0, System.IO.Directory.GetFiles(dir).Length, "no file is written for it");
                PendingClipboard.Finish(marked, "restored");
                PendingRecord plain = PendingClipboard.Begin(SavedClipboard.ForTest(items, false), "dictated");
                Assert.Equal(true, plain.Persisted, "unmarked content is written down");
                plain.PayloadWriter.Join(10000);
                Assert.Equal(true, PendingClipboard.OnDisk(plain.Id), "its record is on disk");
                Assert.Equal(2, System.IO.Directory.GetFiles(dir).Length, "a state file and an encrypted payload");
                PendingClipboard.Finish(plain, "restored");
                Assert.Equal(false, PendingClipboard.OnDisk(plain.Id), "deleted once the restore ran");
                PendingRecord failed = PendingClipboard.Begin(SavedClipboard.ForTest(items, false), "dictated");
                failed.PayloadWriter.Join(10000);
                PendingClipboard.Finish(failed, "unrestored");
                Assert.Equal(true, PendingClipboard.OnDisk(failed.Id), "kept after a restore that did not run");
                Assert.Equal(false, PendingClipboard.Settled("unrestored"), "unrestored keeps the record");
                foreach (string done in new[] { "restored", "partial", "skipped", "user-changed", "untouched" })
                    Assert.Equal(true, PendingClipboard.Settled(done), done + " deletes the record");
            }
            finally
            {
                PendingClipboard.Directory = old;
                try { System.IO.Directory.Delete(dir, true); } catch (Exception) { }
            }
        }

        public static void RecoveryRestoresOnlyOnTransactionEvidence()
        {
            Func<bool, bool, uint, bool, bool, int, bool, ClipboardView> view = (alive, us, seq, sentinel, markers, count, only) =>
                new ClipboardView { OwnerAlive = alive, OwnerIsUs = us, Sequence = seq, SentinelMatches = sentinel, MarkersPresent = markers, FormatCount = count, OnlySavedFormats = only };
            Func<string, uint, uint, RecordFacts> facts = (stage, atStage, afterWrite) => new RecordFacts { Stage = stage, SequenceAtStage = atStage, SequenceAfterWrite = afterWrite };
            Action<PendingClipboard.RecoveryVerdict, RecordFacts, ClipboardView, bool, string> expect = (want, f, v, same, why) => Assert.Equal(want, PendingClipboard.Decide(f, v, same), why);
            expect(PendingClipboard.RecoveryVerdict.Stale, facts("written", 7, 7), view(true, false, 7, true, true, 5, false), true, "a live foreign owner: someone copied since");
            expect(PendingClipboard.RecoveryVerdict.OursBySequence, facts("written", 7, 7), view(false, false, 7, false, false, 5, false), true, "the sequence right after our write, same boot and logon");
            expect(PendingClipboard.RecoveryVerdict.Stale, facts("written", 7, 7), view(false, false, 7, false, false, 5, false), false, "the same sequence in another boot or logon proves nothing");
            expect(PendingClipboard.RecoveryVerdict.OursBySentinel, facts("written", 7, 7), view(false, false, 9, true, true, 5, false), false, "our sentinel and markers prove it in any logon");
            expect(PendingClipboard.RecoveryVerdict.Stale, facts("written", 7, 7), view(false, false, 9, false, false, 1, false), true, "the same text without our sentinel is not ours");
            expect(PendingClipboard.RecoveryVerdict.Stale, facts("written", 7, 7), view(false, false, 9, true, false, 5, false), true, "a sentinel without our markers is not enough after a write");
            expect(PendingClipboard.RecoveryVerdict.InterruptedEmpty, facts("emptying", 3, 0), view(false, false, 4, false, false, 0, false), true, "emptied by us (exactly one step), then the helper ended");
            expect(PendingClipboard.RecoveryVerdict.Stale, facts("emptying", 3, 0), view(false, false, 5, false, false, 0, false), true, "emptied again by someone after us (a deliberate clear): stale");
            expect(PendingClipboard.RecoveryVerdict.Stale, facts("emptying", 3, 0), view(false, false, 4, false, false, 0, false), false, "another logon: no sequence verdict");
            expect(PendingClipboard.RecoveryVerdict.Stale, facts("emptying", 3, 0), view(false, false, 3, false, false, 2, false), true, "not emptied yet: the user's content is still there");
            expect(PendingClipboard.RecoveryVerdict.InterruptedEmpty, facts("emptied", 4, 0), view(false, false, 4, false, false, 0, false), true, "emptied stage, nothing since");
            expect(PendingClipboard.RecoveryVerdict.Stale, facts("emptied", 4, 0), view(false, false, 6, false, false, 0, false), true, "emptied stage, but changed since");
            expect(PendingClipboard.RecoveryVerdict.InterruptedEmpty, facts("restoring", 7, 7), view(false, false, 8, false, false, 0, false), true, "our restore emptied it, then the helper ended");
            expect(PendingClipboard.RecoveryVerdict.InterruptedRestore, facts("restoring", 7, 7), view(false, false, 11, true, false, 2, true), false, "our sentinel and only saved formats: a restore cut short");
            expect(PendingClipboard.RecoveryVerdict.Stale, facts("restoring", 7, 7), view(false, false, 11, false, false, 2, true), true, "saved formats without our sentinel: not provably ours");
            expect(PendingClipboard.RecoveryVerdict.InterruptedRestore, facts("restoring", 7, 7), view(false, false, 9, true, false, 1, false), false, "only our sentinel: the restore died right after setting it");
            expect(PendingClipboard.RecoveryVerdict.Stale, facts("restoring", 7, 7), view(false, false, 9, false, false, 1, false), true, "one foreign format and no sentinel: stale");
            expect(PendingClipboard.RecoveryVerdict.Stale, facts("restoring", 7, 7), view(false, false, 11, true, false, 2, false), true, "other content (a screenshot) after a restore: stale");
            expect(PendingClipboard.RecoveryVerdict.InterruptedEmpty, facts("recovering-emptying", 9, 7), view(false, false, 10, false, false, 0, false), true, "a recovery that died after emptying is itself recoverable");
            expect(PendingClipboard.RecoveryVerdict.InterruptedRestore, facts("recovering-restoring", 9, 7), view(false, false, 13, true, false, 1, true), true, "a recovery cut short is itself recoverable");
            expect(PendingClipboard.RecoveryVerdict.Stale, facts("written", 7, 7), view(false, false, 3, false, false, 0, true), true, "empty after a complete write: someone emptied it");
            expect(PendingClipboard.RecoveryVerdict.Stale, facts("saved", 7, 7), view(false, false, 7, true, true, 1, true), true, "nothing was emptied");
            RecordFacts here = new RecordFacts { Session = 1, Logon = "3e7", BootUtc = new DateTime(2026, 11, 8, 6, 0, 0, DateTimeKind.Utc) };
            Assert.Equal(true, here.SameLogon(1, "3e7", here.BootUtc.AddSeconds(20)), "same boot within clock adjustments");
            Assert.Equal(false, here.SameLogon(2, "3e7", here.BootUtc), "another session");
            Assert.Equal(false, here.SameLogon(1, "4a1", here.BootUtc), "another logon");
            Assert.Equal(false, here.SameLogon(1, "3e7", here.BootUtc.AddMinutes(10)), "another boot");
            Assert.Equal(false, new RecordFacts { Session = 1 }.SameLogon(1, "", DateTime.UtcNow), "unknown logon never matches");
        }

        public static void AnInterruptedRestoreHoldsOnlyWhatWeSaved()
        {
            var text = new KeyValuePair<uint, byte[]>(13, System.Text.Encoding.Unicode.GetBytes("old\0"));
            var mine = new KeyValuePair<uint, byte[]>(0xC123, new byte[] { 1, 2, 3 });
            var saved = new List<KeyValuePair<uint, byte[]>> { text, mine };
            Func<Dictionary<uint, byte[]>, Func<uint, int, byte[]>> reader = (now) => (f, cap) => now.ContainsKey(f) ? now[f] : null;
            Func<byte[]> noEmf = () => null;
            Assert.Equal(true, SavedClipboard.ExplainsPresent(new uint[] { 13, 1, 7, 16 }, reader(new Dictionary<uint, byte[]> { { 13, text.Value } }), saved, null, noEmf), "our text (and what Windows synthesizes from it)");
            Assert.Equal(true, SavedClipboard.ExplainsPresent(new uint[] { 0xC123 }, reader(new Dictionary<uint, byte[]> { { 0xC123, mine.Value } }), saved, null, noEmf), "a restore cut short after one format");
            Assert.Equal(false, SavedClipboard.ExplainsPresent(new uint[] { 8, 2, 17 }, reader(new Dictionary<uint, byte[]>()), saved, null, noEmf), "a screenshot (bitmap family we never saved)");
            Assert.Equal(false, SavedClipboard.ExplainsPresent(new uint[] { 13 }, reader(new Dictionary<uint, byte[]> { { 13, System.Text.Encoding.Unicode.GetBytes("new\0") } }), saved, null, noEmf), "same format, other content");
            Assert.Equal(false, SavedClipboard.ExplainsPresent(new uint[] { 15 }, reader(new Dictionary<uint, byte[]>()), saved, null, noEmf), "a file list we never saved");
            Assert.Equal(false, SavedClipboard.ExplainsPresent(new uint[] { 1, 7 }, reader(new Dictionary<uint, byte[]>()), saved, null, noEmf), "only synthesized formats: nothing compared");
            var bitmap = new KeyValuePair<uint, byte[]>(8, new byte[] { 9, 9, 9 });
            Assert.Equal(false, SavedClipboard.ExplainsPresent(new uint[] { 8, 2 }, reader(new Dictionary<uint, byte[]> { { 8, new byte[] { 7, 7, 7 } } }), new List<KeyValuePair<uint, byte[]>> { bitmap }, null, noEmf), "a different bitmap than the one we saved");
            Assert.Equal(true, SavedClipboard.ExplainsPresent(new uint[] { 8, 2 }, reader(new Dictionary<uint, byte[]> { { 8, bitmap.Value } }), new List<KeyValuePair<uint, byte[]>> { bitmap }, null, noEmf), "our bitmap back");
            Assert.Equal("unrestored", SavedClipboard.RestoreResult(false, true, false), "a format that could not be set back: failed, record kept");
            Assert.Equal("restored", SavedClipboard.RestoreResult(true, true, false), "complete");
            Assert.Equal("partial", SavedClipboard.RestoreResult(true, false, false), "what the save could not keep: settled");
            Assert.Equal("skipped", SavedClipboard.RestoreResult(true, true, true), "capped content: settled");
        }

        public static void ASettledTransactionIsNeverPublishedAndOrphansAreSwept()
        {
            string dir = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "dn-pending-race-" + Guid.NewGuid().ToString("N"));
            System.IO.Directory.CreateDirectory(dir);
            string old = PendingClipboard.Directory;
            int oldDelay = PendingClipboard.TestPayloadDelayMs;
            PendingClipboard.Directory = dir;
            try
            {
                var items = new[] { new KeyValuePair<uint, byte[]>(13, System.Text.Encoding.Unicode.GetBytes("user\0")) };
                // A slow payload writer (a busy disk, an AV scan) and a paste that settles at once.
                PendingClipboard.TestPayloadDelayMs = 600;
                PendingRecord record = PendingClipboard.Begin(SavedClipboard.ForTest(items, false), "dictated");
                PendingClipboard.Finish(record, "restored");
                record.PayloadWriter.Join(5000);
                Assert.Equal(false, PendingClipboard.OnDisk(record.Id), "the late writer did not publish a settled transaction (no payload, no .tmp, no state)");
                PendingClipboard.TestPayloadDelayMs = 0;
                // Leftovers without a state file, and a round-8 record: deleted, never restored from.
                string prefix = "DoodleNote-Bark-clipboard-" + HelperIdentity.Sanitized;
                System.IO.File.WriteAllBytes(System.IO.Path.Combine(dir, prefix + "-0123456789abcdef.bin"), new byte[] { 1 });
                System.IO.File.WriteAllBytes(System.IO.Path.Combine(dir, prefix + "-fedcba9876543210.bin.tmp"), new byte[] { 1 });
                System.IO.File.WriteAllBytes(System.IO.Path.Combine(dir, prefix + ".bin"), new byte[] { 1 });
                PendingClipboard.RecoverLeftover("test");
                Assert.Equal(0, System.IO.Directory.GetFiles(dir).Length, "orphans and the legacy record are gone");
            }
            finally
            {
                PendingClipboard.Directory = old;
                PendingClipboard.TestPayloadDelayMs = oldDelay;
                try { System.IO.Directory.Delete(dir, true); } catch (Exception) { }
            }
        }

        public static void TheSharedWatcherGetsItsRealTickAndEvidenceWindow()
        {
            // Static fields initialize in the order written: Shared must not be built before the tick
            // it reads (round 5 built it first, so its retry clocks ran on a 1 ms tick and the 30 s
            // cap became 30000 ticks).
            BindingFlags flags = BindingFlags.Instance | BindingFlags.NonPublic;
            HoldWatcher shared = HoldWatcher.Shared;
            RetryClock retry = (RetryClock)typeof(HoldWatcher).GetField("keyRetry", flags).GetValue(shared);
            Assert.Equal(2000, typeof(RetryClock).GetField("tickMs", flags).GetValue(retry), "the key retry clock ticks every 2 s");
            HookLossDetector mouse = (HookLossDetector)typeof(HoldWatcher).GetField("mouseDetector", flags).GetValue(shared);
            Assert.Equal(5, typeof(HookLossDetector).GetField("windowTicks", flags).GetValue(mouse), "the mouse evidence window is 10 s");
        }
    }
}
