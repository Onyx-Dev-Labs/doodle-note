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
                Assert.Equal(true, PendingClipboard.DrainJournal(10000), "the journal writer ran its queue");
                Assert.Equal(false, PendingClipboard.OnDisk(plain.Id), "deleted once the restore ran");
                PendingRecord failed = PendingClipboard.Begin(SavedClipboard.ForTest(items, false), "dictated");
                failed.PayloadWriter.Join(10000);
                PendingClipboard.Finish(failed, "unrestored");
                Assert.Equal(true, PendingClipboard.DrainJournal(10000), "the journal writer ran its queue");
                Assert.Equal(true, PendingClipboard.OnDisk(failed.Id), "kept after a restore that did not run");
                Assert.Equal(false, PendingClipboard.Settled("unrestored"), "unrestored keeps the record");
                Assert.Equal(false, PendingClipboard.Settled("user-changed"), "an owner change keeps the record (offered, never deleted on that guess)");
                foreach (string done in new[] { "restored", "partial", "skipped", "untouched" })
                    Assert.Equal(true, PendingClipboard.Settled(done), done + " deletes the record");
            }
            finally
            {
                PendingClipboard.DrainJournal(10000); // round 33: queued steps run before the directory changes back
                PendingClipboard.Directory = old;
                try { System.IO.Directory.Delete(dir, true); } catch (Exception) { }
            }
        }

        public static void RecoveryNeverWritesOnItsOwn()
        {
            // Round 18: a record read back from disk carries no authority to write. Every case that round 17 restored on
            // its own by proof (a) or (b) is now offered (Pending); only another session's (left alone) and an exact
            // saved copy already there (deleted, losing nothing) differ.
            Func<uint, OurWrite, int, bool, ClipboardView> view = (seq, write, count, only) =>
                new ClipboardView { Sequence = seq, OurWrite = write, FormatCount = count, OnlySavedFormats = only };
            Func<string, uint, RecordFacts> facts = (stage, atStage) => new RecordFacts { Stage = stage, SequenceAtStage = atStage, SequenceAfterWrite = 7 };
            Action<PendingClipboard.RecoveryVerdict, RecordFacts, ClipboardView, LogonMatch, string> expect = (want, f, v, logon, why) => Assert.Equal(want, PendingClipboard.Decide(f, v, logon), why);
            LogonMatch same = LogonMatch.Same, other = LogonMatch.Different, unknown = LogonMatch.Unknown;
            var pending = PendingClipboard.RecoveryVerdict.Pending;
            foreach (string stage in new[] { "emptied", "written", "restoring", "restore-emptied", "recovering", "recovering-emptied", "unknown" })
                expect(pending, facts(stage, 3), view(9, OurWrite.Complete, 8, false), same, stage + ": our complete write within our own operations (was proof a): offered, never written");
            expect(pending, facts("emptied", 4), view(4, OurWrite.None, 0, false), same, "empty at exactly M (was proof b): offered");
            expect(pending, new RecordFacts { Stage = "restore-emptied", SequenceAtStage = 8, SequenceClosed = 9 }, view(9, OurWrite.None, 0, false), same, "empty at the sequence confirmed after the close (was proof b): offered");
            expect(pending, new RecordFacts { Stage = "recovering", SequenceAtStage = 18, OriginStage = "restore-emptied", OriginSequenceAtStage = 18 }, view(18, OurWrite.None, 0, false), same, "a recovery's found origin (was proof b): offered");
            expect(pending, facts("emptying", 3), view(3, OurWrite.None, 2, false), same, "emptying with the sequence unchanged (was 'nothing emptied'): offered");
            expect(pending, facts("emptying", 0), view(0, OurWrite.None, 0, false), same, "a zero sequence deletes nothing");
            ClipboardView mine = view(12, OurWrite.None, 3, true); mine.OwnerIsUs = true; mine.OwnerAlive = true;
            expect(pending, facts("restore-emptied", 8), mine, same, "ownership: offered");
            ClipboardView foreign = view(9, OurWrite.None, 3, false); foreign.OwnerAlive = true;
            expect(pending, facts("restore-emptied", 8), foreign, same, "a live foreign owner: offered, not deleted");
            expect(pending, facts("restore-emptied", 8), view(8 + 40, OurWrite.None, 3, false), same, "far beyond any bound: offered, not deleted");
            expect(pending, facts("written", 7), view(7, OurWrite.Complete, 8, false), unknown, "an unknown logon: offered");
            expect(pending, facts("restore-emptied", 8), view(10, OurWrite.Complete, 8, false), other, "another boot: offered");
            ClipboardView exact = view(15, OurWrite.None, 5, true); exact.HoldsSavedExactly = true;
            foreach (LogonMatch logon in new[] { same, other, unknown })
                expect(PendingClipboard.RecoveryVerdict.Untouched, facts("restore-emptied", 8), exact, logon, "the saved content is already there exactly (" + logon + "): deleted, nothing written");
            expect(PendingClipboard.RecoveryVerdict.OtherSession, facts("restore-emptied", 8), view(10, OurWrite.Complete, 2, false), LogonMatch.OtherSession, "another session's record: left alone");
        }

        public static void TheLogonIdentityNeverUsesTheWallClock()
        {
            Func<string, string, LogonNow> now = (key, boot) => new LogonNow { Session = 1, Logon = "3e7", SessionKey = key, KeyCreatedTick = 1000, BootId = boot, Tick = 5000000 };
            RecordFacts here = new RecordFacts { Session = 1, Logon = "3e7", SessionKey = "a1", BootId = "14", Tick = 4000000 };
            Assert.Equal(LogonMatch.Same, here.Compare(now("a1", "14")), "same session, LUID, key and boot (a clock correction changes nothing)");
            Assert.Equal(LogonMatch.Different, here.Compare(now("a1", "15")), "another boot (Windows' boot counter): nothing proven; offered (see OfferBootStep)");
            Assert.Equal(LogonMatch.Different, new RecordFacts { Session = 1, Logon = "3e7", SessionKey = "a1", Tick = 9000000 }.Compare(now("a1", "")), "the tick count is below the record's: a new boot");
            Assert.Equal(LogonMatch.OtherSession, new RecordFacts { Session = 2, Logon = "3e7", SessionKey = "a1", BootId = "14", Tick = 4000000 }.Compare(now("a1", "14")), "another session of the same user (shared %TEMP%): left alone, not deleted");
            Assert.Equal(LogonMatch.Unknown, here.Compare(now("b2", "14")), "another key in the same boot (a cleaner, a replaced persistent key, a relogin): offered, never deleted");
            Assert.Equal(LogonMatch.Unknown, new RecordFacts { Session = 1, Logon = "4a1", SessionKey = "a1", BootId = "14", Tick = 4000000 }.Compare(now("a1", "14")), "another LUID in the same session (an elevated helper)");
            Assert.Equal(LogonMatch.Unknown, here.Compare(now("", "14")), "the key could not be read now");
        }

        public static void APersistentSessionKeyIsReplacedByAVolatileOne()
        {
            string path = @"Software\DoodleNote.Bark.Session.Test-" + Guid.NewGuid().ToString("N");
            try
            {
                // A normal (persistent) key of our name with a value, as an older build or a registry import would leave it.
                using (Microsoft.Win32.RegistryKey stale = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(path))
                    stale.SetValue("qa.test", "0123456789abcdef0123456789abcdef:42");
                SessionKeyInfo first = Native.LogonSessionKey("qa.test", path);
                Assert.Equal(true, first.ReplacedPersistent, "the persistent key was detected and replaced");
                Assert.Equal(true, first.CreatedHere, "a fresh key was created");
                Assert.Equal(false, first.Key == "0123456789abcdef0123456789abcdef", "the old value is gone");
                bool isVolatile;
                using (Microsoft.Win32.RegistryKey key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(path, true))
                {
                    try { using (key.CreateSubKey("probe")) { } key.DeleteSubKey("probe", false); isVolatile = false; }
                    catch (System.IO.IOException) { isVolatile = true; }
                }
                Assert.Equal(true, isVolatile, "the key is now volatile (gone at hive unload)");
                SessionKeyInfo second = Native.LogonSessionKey("qa.test", path);
                Assert.Equal(first.Key, second.Key, "the next helper agrees on it");
                Assert.Equal(false, second.CreatedHere || second.ReplacedPersistent, "and did not create or replace it");
            }
            finally { try { Microsoft.Win32.Registry.CurrentUser.DeleteSubKeyTree(path, false); } catch (Exception) { } }
        }

        public static void PendingRecordsExpireAfterTheRetention()
        {
            long day = 24L * 3600 * 1000;
            Func<long, string, LogonNow> now = (tick, boot) => new LogonNow { BootId = boot, Tick = tick };
            RecordFacts offered = new RecordFacts { OfferedTick = 1000, OfferedBoot = "14", CreatedUtc = DateTime.UtcNow };
            Assert.Equal(false, PendingClipboard.Expired(offered, now(1000 + day - 1, "14")), "within 24 h of the first offer: still offered");
            Assert.Equal(true, PendingClipboard.Expired(offered, now(1000 + day + 1, "14")), "24 h after the first offer, on the tick count: expired (a retention policy)");
            Assert.Equal(false, PendingClipboard.Expired(offered, now(1000 + 2 * day, "15")), "another boot: not by this rule (Compare deletes it as another boot)");
            RecordFacts jumped = new RecordFacts { OfferedTick = 1000, OfferedBoot = "14", CreatedUtc = DateTime.UtcNow.AddDays(-40) };
            Assert.Equal(false, PendingClipboard.Expired(jumped, now(5000, "14")), "a wall-clock jump alone never deletes (the tick count decides)");
            Assert.Equal(false, PendingClipboard.Expired(new RecordFacts { CreatedUtc = DateTime.UtcNow.AddDays(-2) }, now(5000, "14")), "never offered: not by this rule (the offer sets the tick first)");
            Assert.Equal(false, PendingClipboard.Expired(new RecordFacts { CreatedUtc = DateTime.UtcNow.AddDays(-400) }, now(5000, "14")), "no offer tick, however old by the wall clock: never on the wall clock");
        }

        public static void OurWriteIsRecognizedOnlyWhenExactlyOurs()
        {
            uint sentinel = Native.RegisterClipboardFormat(PendingClipboard.SentinelFormat);
            uint[] markers = ClipboardText.MarkerNames.Select(n => Native.RegisterClipboardFormat(n)).ToArray();
            string id = "0123456789abcdef0123456789abcdef", nonce = "fedcba9876543210fedcba9876543210";
            byte[] hash = PendingClipboard.Hash("dictated");
            // Our write: our text, markers and sentinel (which states the locale), and the text forms Windows synthesizes
            // from the text on that locale's code pages (round 17: we no longer write them ourselves).
            Func<uint, string, byte[]> form = (f, t) => ClipboardText.ExpectedTextForm(f, t, 1033).Concat(new byte[] { 0 }).ToArray();
            var ours = new Dictionary<uint, byte[]>
            {
                { 13, System.Text.Encoding.Unicode.GetBytes("dictated\0") },
                { 1, form(1, "dictated") }, { 7, form(7, "dictated") }, { 16, BitConverter.GetBytes(1033) },
                { markers[0], new byte[] { 0 } }, { markers[1], BitConverter.GetBytes(0) }, { markers[2], BitConverter.GetBytes(0) },
                { sentinel, System.Text.Encoding.UTF8.GetBytes(id + ":" + nonce + ":1033") }
            };
            Func<Dictionary<uint, byte[]>, Func<uint, int, byte[]>> reader = (now) => (f, cap) => now.ContainsKey(f) ? now[f].Take(Math.Min(cap, now[f].Length)).ToArray() : null;
            Func<Dictionary<uint, byte[]>, OurWrite> classify = (now) => ClipboardText.ClassifyOurWrite(now.Keys.ToList(), reader(now), id, nonce, hash);
            Assert.Equal(OurWrite.Complete, classify(ours), "every format ours or Windows' from our text, bytes compared");
            var padded = new Dictionary<uint, byte[]>(ours); padded[1] = form(1, "dictated").Concat(new byte[] { 0, 0, 0 }).ToArray();
            Assert.Equal(OurWrite.Complete, classify(padded), "an allocation larger than the text (Windows rounds up): the text up to its terminator decides");
            var noForms = new Dictionary<uint, byte[]>(ours); noForms.Remove(1); noForms.Remove(7); noForms.Remove(16);
            Assert.Equal(OurWrite.Complete, classify(noForms), "before Windows added its forms: still exactly our write");
            var noSentinel = new Dictionary<uint, byte[]>(ours); noSentinel.Remove(sentinel); noSentinel.Remove(16);
            Assert.Equal(OurWrite.Partial, classify(noSentinel), "cut short before the sentinel");
            Assert.Equal(OurWrite.None, ClipboardText.ClassifyOurWrite(ours.Keys.ToList(), reader(ours), id, "00000000000000000000000000000000", hash), "another nonce (a replayed older sentinel)");
            var otherText = new Dictionary<uint, byte[]>(ours); otherText[13] = System.Text.Encoding.Unicode.GetBytes("dictatee\0");
            Assert.Equal(OurWrite.None, classify(otherText), "other text with our sentinel");
            // P1-A (round 16), kept: the ANSI, OEM and locale forms are compared by their bytes too.
            var otherAnsi = new Dictionary<uint, byte[]>(ours); otherAnsi[1] = System.Text.Encoding.ASCII.GetBytes("replaced\0");
            Assert.Equal(OurWrite.None, classify(otherAnsi), "an ANSI form replaced (our Unicode text, markers and sentinel kept)");
            var otherOem = new Dictionary<uint, byte[]>(ours); otherOem[7] = System.Text.Encoding.ASCII.GetBytes("dictatee\0");
            Assert.Equal(OurWrite.None, classify(otherOem), "an OEM form replaced");
            var otherLocale = new Dictionary<uint, byte[]>(ours); otherLocale[16] = BitConverter.GetBytes(1031);
            Assert.Equal(OurWrite.None, classify(otherLocale), "a locale other than the one our sentinel states");
            var longerAnsi = new Dictionary<uint, byte[]>(ours); longerAnsi[1] = System.Text.Encoding.ASCII.GetBytes("dictatedA\0");
            Assert.Equal(OurWrite.None, classify(longerAnsi), "ANSI text that starts with ours but goes on");
            var unterminated = new Dictionary<uint, byte[]>(ours); unterminated[1] = System.Text.Encoding.ASCII.GetBytes("dictated");
            Assert.Equal(OurWrite.None, classify(unterminated), "an ANSI form without its terminator");
            Func<uint, int, byte[]> failing = (f, cap) => f == 1 ? null : reader(ours)(f, cap);
            Assert.Equal(OurWrite.None, ClipboardText.ClassifyOurWrite(ours.Keys.ToList(), failing, id, nonce, hash), "a text form that cannot be read now: not proof (round 17: the rejection is durable)");
            // Windows' conversion is on CF_LOCALE's code pages (CI compares this with Windows' own synthesis).
            Assert.Equal("c6", BitConverter.ToString(ClipboardText.ExpectedTextForm(1, "\u0416", 0x0419)).ToLowerInvariant(), "Russian locale: CP1251");
            Assert.Equal("86", BitConverter.ToString(ClipboardText.ExpectedTextForm(7, "\u0416", 0x0419)).ToLowerInvariant(), "Russian locale: CP866");
            var otherMarker = new Dictionary<uint, byte[]>(ours); otherMarker[markers[1]] = BitConverter.GetBytes(1);
            Assert.Equal(OurWrite.None, classify(otherMarker), "a marker value that is not ours");
            var foreign = new Dictionary<uint, byte[]>(ours); foreign[0xC333] = new byte[] { 1 };
            Assert.Equal(OurWrite.None, classify(foreign), "a format our write never sets");
            var ansiOnly = new Dictionary<uint, byte[]> { { 1, form(1, "dictated") }, { markers[0], new byte[] { 0 } } };
            Assert.Equal(OurWrite.None, classify(ansiOnly), "a text form without our text");
            Assert.Equal(OurWrite.None, classify(new Dictionary<uint, byte[]>()), "an empty clipboard is not a write");
        }

        public static void OnlyAPositiveAbsenceCountsAsMissing()
        {
            var absent = PendingClipboard.Presence.Absent; var unknown = PendingClipboard.Presence.Unknown;
            Assert.Equal(absent, PendingClipboard.ClassifyPresence(0xFFFFFFFFu, 2), "ERROR_FILE_NOT_FOUND: absent");
            Assert.Equal(absent, PendingClipboard.ClassifyPresence(0xFFFFFFFFu, 3), "ERROR_PATH_NOT_FOUND: absent");
            foreach (int error in new[] { 5, 32, 33, 1, 21, 53, 67, 1920, 0 })
                Assert.Equal(unknown, PendingClipboard.ClassifyPresence(0xFFFFFFFFu, error), "error " + error + " (access denied, sharing, network, ...): unknown, never 'missing'");
            Assert.Equal(PendingClipboard.Presence.Present, PendingClipboard.ClassifyPresence(0x20u, 0), "attributes read: present");
            Assert.Equal(PendingClipboard.Presence.Present, PendingClipboard.ClassifyPresence(0x80u, 5), "attributes read (a stale error code is ignored): present");
            string dir = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "dn-presence-" + Guid.NewGuid().ToString("N"));
            System.IO.Directory.CreateDirectory(dir);
            try
            {
                string file = System.IO.Path.Combine(dir, "x.bin");
                Assert.Equal(absent, PendingClipboard.Probe(file), "a file that is not there");
                Assert.Equal(absent, PendingClipboard.Probe(System.IO.Path.Combine(dir, "no-such-dir", "x.bin")), "a directory that is not there");
                System.IO.File.WriteAllBytes(file, new byte[] { 1 });
                Assert.Equal(PendingClipboard.Presence.Present, PendingClipboard.Probe(file), "a file that is there");
                using (new System.IO.FileStream(file, System.IO.FileMode.Open, System.IO.FileAccess.Read, System.IO.FileShare.None))
                    Assert.Equal(PendingClipboard.Presence.Present, PendingClipboard.Probe(file), "held with no sharing: still present (attributes need no open)");
            }
            finally { try { System.IO.Directory.Delete(dir, true); } catch (Exception) { } }
        }

        public static void TheExpectedLocaleIsPinnedToTheTransaction()
        {
            ClipboardOwnership ours = new ClipboardOwnership { TextLocale = 1033 };
            Func<uint, string, int, byte[]> forms = ours.ExpectedForms();
            Assert.Equal(true, forms(1, "x", 1033) != null, "the pinned locale: Windows' conversion expected");
            Assert.Equal(null, forms(1, "x", 1049), "a sentinel stating another locale: nothing is expected (not ours)");
            Assert.Equal(null, forms(16, "x", 1049), "nor its CF_LOCALE");
        }

        public static void TheSaveIsWrittenOverOnlyWhenPositivelyEstablished()
        {
            // Rounds 20-21: hooked reader replies (the client has already checked the id and stripped " end"); Judge
            // decides whether the helper may write. Listing: "list <seq before> <counted> <error> <seq after> <listed> <entries>".
            uint extra = Native.RegisterClipboardFormat("DoodleNote.CI.Extra");
            Func<uint, string, string> entry = (f, name) => f + ":" + Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(name));
            string two = " " + entry(13, "") + " " + entry(extra, "DoodleNote.CI.Extra");
            Func<uint, string> data = (f) => "data " + f + " 100 3 " + Convert.ToBase64String(new byte[] { 1, 2, 3 });
            Func<string, Func<string, string>, SavedClipboard> judge = (listReply, getReply) =>
            {
                bool retry; string line;
                return SavedClipboard.Judge((request, ms) => request == "list" ? listReply : getReply(request), 1500, () => 100u, out retry, out line);
            };
            Func<string, string> allData = (request) => data(uint.Parse(request.Split(' ')[1]));
            Func<string, Func<string, string>> withExtra = (reply) => (request) => request.Contains(" " + extra + " ") ? reply : allData(request);
            SavedClipboard ok = judge("list 100 2 0 100 2" + two, allData);
            Assert.Equal(true, ok != null && ok.Count == 2, "listed = counted = declared, no error, both saved: established");
            SavedClipboard empty = judge("list 100 0 0 100 0", allData);
            Assert.Equal(true, empty != null && empty.Count == 0 && !empty.ReportedSkip, "listed 0, counted 0, no error: a positively empty clipboard (the only zero-item save that reports restored)");
            // Not established: nothing is written, no record.
            var failures = new Dictionary<string, SavedClipboard>
            {
                { "an enumeration error with a non-empty clipboard", judge("list 100 5 1418 100 0", allData) },
                { "listed 0, counted 5 (the round-19 failure)", judge("list 100 5 0 100 0", allData) },
                { "an enumeration error mid-list", judge("list 100 2 1418 100 1 " + entry(13, ""), allData) },
                { "listed 2, counted 3", judge("list 100 3 0 100 2" + two, allData) },
                { "declared 3, listed 2", judge("list 100 2 0 100 3" + two, allData) },
                { "the sequence moved across the listing", judge("list 100 2 0 101 2" + two, allData) },
                { "a zero sequence", judge("list 0 2 0 0 2" + two, allData) },
                { "a lost hold during the listing", judge("lost", allData) },
                { "a lost hold during a get", judge("list 100 2 0 100 2" + two, withExtra("lost")) },
                { "every get none", judge("list 100 2 0 100 2" + two, (r) => "none " + r.Split(' ')[1] + " 100 1418") },
                { "a get unlocked", judge("list 100 2 0 100 2" + two, withExtra("unlocked " + extra + " 100 5")) },
                { "a GlobalSize of zero (nosize)", judge("list 100 2 0 100 2" + two, withExtra("nosize " + extra + " 100 0")) },
                { "an oversize that is not over the cap", judge("list 100 2 0 100 2" + two, withExtra("oversize " + extra + " 100 1")) },
                { "a late reply (out-of-order)", judge("out-of-order", allData) },
                { "a truncated listing (EOF fragment)", judge("list 100 2", allData) },
                { "busy", judge("busy", allData) },
                { "an overrun", judge(null, allData) },
                { "a get shorter than declared", judge("list 100 2 0 100 2" + two, withExtra("data " + extra + " 100 9 " + Convert.ToBase64String(new byte[] { 1 }))) },
                { "a get for another format", judge("list 100 2 0 100 2" + two, (r) => data(13)) },
                { "a get with a zero sequence", judge("list 100 2 0 100 2" + two, withExtra("data " + extra + " 0 3 " + Convert.ToBase64String(new byte[] { 1, 2, 3 }))) },
                { "a token without a colon", judge("list 100 2 0 100 2 13" + " " + entry(extra, "DoodleNote.CI.Extra"), allData) },
                { "a repeated format id", judge("list 100 2 0 100 2 " + entry(13, "") + " " + entry(13, ""), allData) },
                { "a registered format without a name", judge("list 100 2 0 100 2 " + entry(13, "") + " " + entry(extra, ""), allData) }
            };
            foreach (var f in failures) Assert.Equal(null, f.Value, f.Key + ": not established (no write, no record)");
            // Named skips: only a measured excess over the cap (or a format policy) still establishes the save.
            SavedClipboard skipped = judge("list 100 2 0 100 2" + two, withExtra("oversize " + extra + " 100 999999999"));
            Assert.Equal(true, skipped != null && skipped.Count == 1 && skipped.ReportedSkip, "one format measured over the cap: established, reported as skipped");
            // Round 23, the one rule (a directed change; round 22 established this as a zero-item "skipped" save): nothing
            // with the user's content would go back, so it is NOT established and nothing is pasted (a 4K screenshot).
            SavedClipboard allSkipped = judge("list 100 1 0 100 1 " + entry(extra, "DoodleNote.CI.Extra"), withExtra("oversize " + extra + " 100 999999999"));
            Assert.Equal(null, allSkipped, "every format over the cap: not established (round 23, the one rule)");
            Assert.Equal("too-large", SavedClipboard.LastNoSaveReason, "and the reason is too-large");
        }

        public static void TheThreeClassesOfFormatsASaveCannotRead()
        {
            // Round 22, the owner decision. Hooked reader replies as in TheSaveIsWrittenOverOnlyWhenPositivelyEstablished.
            uint extra = Native.RegisterClipboardFormat("DoodleNote.CI.Extra");
            uint ignore = Native.RegisterClipboardFormat("Clipboard Viewer Ignore");
            uint column = Native.RegisterClipboardFormat("MSDEVColumnSelect");
            uint marker = Native.RegisterClipboardFormat("ExcludeClipboardContentFromMonitorProcessing");
            Func<uint, string, string> entry = (f, name) => f + ":" + Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(name));
            Func<uint, string> data = (f) => "data " + f + " 100 3 " + Convert.ToBase64String(new byte[] { 1, 2, 3 });
            var asked = new List<string>();
            Func<string, Func<string, string>, bool, SavedClipboard> judge = (listReply, getReply, allowUnrendered) =>
            {
                bool retry; string line;
                asked.Clear();
                return SavedClipboard.Judge((request, ms) => { asked.Add(request); return request == "list" ? listReply : getReply(request); }, 1500, () => 100u, out retry, out line, allowUnrendered);
            };
            Func<uint, string, Func<string, string>> only = (f, reply) => (request) => request.Contains(" " + f + " ") ? reply : data(uint.Parse(request.Split(' ')[1]));
            string text = " " + entry(13, "");
            // Class 1: the known presence-only formats are never read; saved and put back as presence only.
            SavedClipboard flags = judge("list 100 3 0 100 3" + text + " " + entry(ignore, "Clipboard Viewer Ignore") + " " + entry(column, "MSDEVColumnSelect"), (r) => data(13), false);
            Assert.Equal(true, flags != null && flags.Count == 1 && flags.FormatCount == 3 && flags.Has(ignore) && flags.Has(column) && !flags.ReportedSkip, "class 1: presence-only formats saved as presence only, the save whole");
            Assert.Equal(false, asked.Exists(r => r.Contains(" " + ignore + " ") || r.Contains(" " + column + " ")), "class 1: a presence-only format is never read (its data is not used)");
            // Class 2: a privacy marker not read cleanly forces the conservative markers (first attempt too).
            foreach (string reply in new[] { "none " + marker + " 100 1418", "nosize " + marker + " 100 0", "unlocked " + marker + " 100 5" })
            {
                SavedClipboard marked = judge("list 100 2 0 100 2" + text + " " + entry(marker, "ExcludeClipboardContentFromMonitorProcessing"), only(marker, reply), false);
                Assert.Equal(true, marked != null && marked.ForceMarkers && marked.PrivacyMarked && marked.Count == 1, "class 2 (" + reply.Split(' ')[0] + "): established, the exclusion markers forced");
            }
            // Class 3: an owner-unrendered format beside content that goes back: strict on the first attempt, a NAMED reported
            // skip on the second.
            string withExtra = "list 100 2 0 100 2" + text + " " + entry(extra, "DoodleNote.CI.Extra");
            foreach (string reply in new[] { "none " + extra + " 100 1418", "nosize " + extra + " 100 0", "unlocked " + extra + " 100 5" })
            {
                Assert.Equal(null, judge(withExtra, only(extra, reply), false), "class 3 (" + reply.Split(' ')[0] + "), first attempt: not established");
                SavedClipboard skipped = judge(withExtra, only(extra, reply), true);
                Assert.Equal(true, skipped != null && skipped.Count == 1 && skipped.ReportedSkip, "class 3 (" + reply.Split(' ')[0] + "), second attempt: established, reported as skipped");
                Assert.Equal("DoodleNote.CI.Extra (not provided by the app that copied it)", string.Join("|", skipped.Missing().ToArray()), "class 3: the skipped format is named, with its reason");
                Assert.Equal(true, skipped.Incomplete, "and the save is incomplete (an offer of it says so)");
            }
            // The limit: nothing with data provided, so nothing would come back: never established (the clipboard is left alone).
            Assert.Equal(null, judge("list 100 1 0 100 1 " + entry(extra, "DoodleNote.CI.Extra"), (r) => "none " + extra + " 100 1418", true), "class 3 limit: no format with data provided: not established");
            // Everything else stays NOT ESTABLISHED on the second attempt too.
            Assert.Equal(null, judge(withExtra, only(extra, "lost"), true), "a lost hold: not established");
            Assert.Equal(null, judge(withExtra, only(extra, "busy"), true), "busy: not established");
            Assert.Equal(null, judge(withExtra, only(extra, "unresponsive"), true), "an unresponsive owner: not established");
            Assert.Equal(null, judge(withExtra, only(extra, "out-of-order"), true), "a framing error: not established");
            Assert.Equal(null, judge("list 100 3 0 100 2" + text + " " + entry(extra, "DoodleNote.CI.Extra"), only(extra, "none " + extra + " 100 1418"), true), "listed != counted: not established");
            Assert.Equal(null, judge("list 100 2 1418 100 2" + text + " " + entry(extra, "DoodleNote.CI.Extra"), only(extra, "none " + extra + " 100 1418"), true), "an enumeration error: not established");
            Assert.Equal(null, judge(withExtra, only(extra, "none " + extra + " 101 1418"), true), "the sequence moved: not established");
            // S5 / F9: the reply kinds are bound to the format; ids are bounded.
            Assert.Equal(null, judge("list 100 1 0 100 1" + text, (r) => "emf 13 100 3 " + Convert.ToBase64String(new byte[] { 1, 2, 3 }), true), "an \"emf\" reply for CF_UNICODETEXT: not established");
            Assert.Equal(null, judge("list 100 1 0 100 1 " + entry(14, ""), (r) => data(14), true), "a \"data\" reply for CF_ENHMETAFILE: not established");
            Assert.Equal(null, judge("list 100 1 0 100 1 " + entry(0x10000, ""), (r) => data(0x10000), true), "a format id above 0xFFFF: not established");
            // Round 23, the one rule: CF_LOCALE, a clean marker or "Preferred DropEffect" are no user content.
            uint dropEffect = Native.RegisterClipboardFormat("Preferred DropEffect");
            Assert.Equal(null, judge("list 100 2 0 100 2" + text + " " + entry(16, ""), (r) => r.Contains(" 13 ") ? "none 13 100 0" : data(16), true), "the text unrendered, CF_LOCALE read: not established");
            Assert.Equal(null, judge("list 100 2 0 100 2 " + entry(marker, "ExcludeClipboardContentFromMonitorProcessing") + " " + entry(extra, "DoodleNote.CI.Extra"), (r) => r.Contains(" " + extra + " ") ? "none " + extra + " 100 0" : data(marker), true), "a clean marker beside an unrendered format: not established");
            Assert.Equal(null, judge("list 100 2 0 100 2 " + entry(dropEffect, "Preferred DropEffect") + " " + entry(extra, "DoodleNote.CI.Extra"), (r) => r.Contains(" " + extra + " ") ? "none " + extra + " 100 0" : data(dropEffect), true), "Preferred DropEffect beside an unrendered format: not established");
            Assert.Equal("unrendered", SavedClipboard.LastNoSaveReason, "and the reason is unrendered");
            // Round 23 (S-D): Clipboard Viewer Ignore keeps the copy off the disk.
            Assert.Equal(true, flags.PrivacyMarked, "Clipboard Viewer Ignore: privacy-marked (in memory only)");
            // Round 23 (nits): a negative reply's error field must be numeric; an oversize marker reports nothing.
            Assert.Equal(null, judge(withExtra, only(extra, "none " + extra + " 100 garbage"), true), "a negative reply with a non-numeric error: malformed, not established");
            SavedClipboard bigMarker = judge("list 100 2 0 100 2" + text + " " + entry(marker, "ExcludeClipboardContentFromMonitorProcessing"), only(marker, "oversize " + marker + " 100 999999"), false);
            Assert.Equal(true, bigMarker != null && bigMarker.ForceMarkers && !bigMarker.ReportedSkip, "an oversize marker: the markers forced, no reported skip (class 2 reports nothing)");
            // Round 23 (S2): a bitmap that cannot be rebuilt is named.
            SavedClipboard noDib = judge("list 100 2 0 100 2" + text + " " + entry(2, ""), (r) => data(13), false);
            Assert.Equal(true, noDib != null && noDib.Missing().Contains("CF_BITMAP (no picture to rebuild it from)"), "a bitmap without a DIB: named");
            // Round 23 (Opus): one more ping for an owner busy at the first one.
            int pings = 0;
            bool rr; string ll;
            SavedClipboard pinged = SavedClipboard.Judge((request, ms) => request == "list" ? "list 100 1 0 100 1" + text : (pings++ == 0 ? "unresponsive" : data(13)), 1500, () => 100u, out rr, out ll);
            Assert.Equal(true, pinged != null && pings == 2, "an owner busy at the first ping is asked once more: established");
            // S4: no time left: no request at all.
            bool r4; string l4;
            int requests = 0;
            Assert.Equal(null, SavedClipboard.Judge((request, ms) => { requests++; return "list 100 0 0 100 0"; }, 0, () => 100u, out r4, out l4), "no time left: not established");
            Assert.Equal(0, requests, "and no listing was requested");
        }

        public static void WhatASaveCouldNotKeepIsWrittenDownAndReadBack()
        {
            Func<SavedClipboard, SavedClipboard> roundTrip = (saved) =>
            {
                var stream = new System.IO.MemoryStream();
                using (var writer = new System.IO.BinaryWriter(stream, System.Text.Encoding.UTF8, true)) saved.WriteTo(writer);
                stream.Position = 0;
                using (var reader = new System.IO.BinaryReader(stream, System.Text.Encoding.UTF8)) return SavedClipboard.ReadFrom(reader);
            };
            uint extra = Native.RegisterClipboardFormat("DoodleNote.CI.Extra");
            uint ignore = Native.RegisterClipboardFormat("Clipboard Viewer Ignore");
            Func<uint, string, string> entry = (f, name) => f + ":" + Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(name));
            bool retry; string line;
            SavedClipboard skipped = SavedClipboard.Judge((request, ms) => request == "list"
                    ? "list 100 3 0 100 3 " + entry(13, "") + " " + entry(extra, "DoodleNote.CI.Extra") + " " + entry(ignore, "Clipboard Viewer Ignore")
                    : request.Contains(" " + extra + " ") ? "none " + extra + " 100 1418" : "data 13 100 4 " + Convert.ToBase64String(new byte[] { 65, 0, 0, 0 }),
                1500, () => 100u, out retry, out line, true);
            Assert.Equal(true, skipped != null, "the save is established (class 3): " + line);
            SavedClipboard back = roundTrip(skipped);
            Assert.Equal(3, back.ListedCount, "provenance: the listed count is written down");
            Assert.Equal("DoodleNote.CI.Extra (not provided by the app that copied it)", string.Join("|", back.Missing().ToArray()), "provenance: what was not kept is written down, by name and reason");
            Assert.Equal(true, back.Has(ignore) && back.FormatCount == 2, "the presence-only format round-trips as presence only");
            Assert.Equal("skipped", back.PutBackResult(true), "a put-back of it is never \"restored\"");
            // B2: an EMF whose bytes are not available is written as LOST, never as absent, and read back incomplete.
            SavedClipboard lostEmf = SavedClipboard.ForTest(new[] { new KeyValuePair<uint, byte[]>(13, new byte[] { 65, 0, 0, 0 }) }, false);
            lostEmf.metafileExpected = true;
            SavedClipboard lostBack = roundTrip(lostEmf);
            Assert.Equal("unrestored", lostBack.PutBackResult(true), "B2: an EMF written as lost: never restored (the record stays)");
            Assert.Equal(true, lostBack.Incomplete && lostBack.Missing().Contains("CF_ENHMETAFILE (it could not be written down)"), "B2: and it says what is missing");
            Assert.Equal("unrestored", roundTrip(lostBack).PutBackResult(true), "B2: written down again, still lost (never absent)");
            // A whole save: nothing missing.
            SavedClipboard whole = roundTrip(SavedClipboard.ForTest(new[] { new KeyValuePair<uint, byte[]>(13, new byte[] { 65, 0, 0, 0 }) }, false));
            Assert.Equal(true, !whole.Incomplete && whole.Missing().Count == 0 && whole.PutBackResult(true) == "restored", "control: a whole save is restored, nothing missing");
            // The delivery's reply names what was not put back; an unsaved clipboard is said.
            DeliveryResult result = new DeliveryResult(DeliveryOutcome.Delivered, null) { Clipboard = "skipped" };
            Delivery.ClipboardNotes(result, skipped, null);
            Assert.Equal("DoodleNote.CI.Extra (not provided by the app that copied it)", result.ClipboardMissing == null ? null : string.Join("|", result.ClipboardMissing.ToArray()), "the reply names the skipped format");
            DeliveryResult notSaved = new DeliveryResult(DeliveryOutcome.Delivered, null) { Clipboard = "untouched" };
            Delivery.ClipboardNotes(notSaved, null, "too-large");
            Assert.Equal("not-saved", notSaved.ClipboardNotice, "a clipboard that could not be saved: the reply says so");
            Assert.Equal("too-large", notSaved.ClipboardNoticeReason, "and why (round 23)");
        }

        public static void AFailedLivenessQueryIsUnknownNeverNotRunning()
        {
            Assert.Equal(PendingClipboard.Liveness.NotRunning, PendingClipboard.HelperLiveness(0), "no pid: not running");
            Assert.Equal(PendingClipboard.Liveness.NotRunning, PendingClipboard.HelperLiveness(int.MaxValue - 1), "no such process: not running (proven)");
            using (System.Diagnostics.Process self = System.Diagnostics.Process.GetCurrentProcess())
            {
                Assert.Equal(PendingClipboard.Liveness.Running, PendingClipboard.HelperLiveness(self.Id, self.StartTime.ToUniversalTime().Ticks), "this process at its start time: running");
                Assert.Equal(PendingClipboard.Liveness.NotRunning, PendingClipboard.HelperLiveness(self.Id, self.StartTime.ToUniversalTime().Ticks - TimeSpan.TicksPerHour), "another start time: a reused pid, not running");
            }
        }

        public static void EveryDestructiveCallerRefusesAnIncompleteEnumeration()
        {
            // Round 22: one call site at a time reports an incomplete enumeration (test build); each refuses its proof.
            var window = new System.Windows.Forms.NativeWindow();
            var parameters = new System.Windows.Forms.CreateParams();
            parameters.Parent = new IntPtr(-3); // HWND_MESSAGE
            window.CreateHandle(parameters);
            try
            {
                bool opened = false;
                for (int i = 0; i < 50 && !(opened = Native.OpenClipboard(window.Handle)); i++) System.Threading.Thread.Sleep(20);
                Assert.True(opened, "the test opens the clipboard with its own window");
                try
                {
                    Assert.True(Native.EmptyClipboard(), "emptied");
                    byte[] text = System.Text.Encoding.Unicode.GetBytes("incomplete enumeration\0");
                    Assert.True(ClipboardText.SetBytes(13, text), "CF_UNICODETEXT set");
                    SavedClipboard saved = SavedClipboard.ForTest(new[] { new KeyValuePair<uint, byte[]>(13, text) }, false);
                    string id = new string('0', 32);
                    ClipboardText.IncompleteAt = null;
                    Assert.Equal(true, saved.MatchesOpenClipboard(), "control: the clipboard holds exactly the saved content");
                    ClipboardView whole = ClipboardView.Read(saved, id, "n", new byte[32]);
                    Assert.Equal(false, whole.Incomplete, "control: the view's enumeration is complete");
                    // (CF_UNICODETEXT alone counts 0: the sizes skip every format Windows may synthesize; known, not -1.)
                    Assert.Equal(true, ClipboardText.OpenClipboardBytes(false) >= 0, "control: the size is known");
                    ClipboardText.IncompleteAt = "matches";
                    Assert.Equal(false, saved.MatchesOpenClipboard(), "MatchesOpenClipboard: incomplete, no proof the saved content is there");
                    ClipboardText.IncompleteAt = "view";
                    ClipboardView view = ClipboardView.Read(saved, id, "n", new byte[32]);
                    Assert.Equal(true, view.Incomplete, "ClipboardView.Read: incomplete");
                    Assert.Equal(false, PendingClipboard.Decide(new RecordFacts { Stage = "written", SequenceAtStage = 7, SequenceAfterWrite = 7 }, view, LogonMatch.Same) == PendingClipboard.RecoveryVerdict.Untouched, "the recovery: never untouched (never deleted) on an incomplete view");
                    ClipboardText.IncompleteAt = "bytes";
                    Assert.Equal(-1L, ClipboardText.OpenClipboardBytes(false), "OpenClipboardBytes: unknown, never a smaller size");
                }
                finally
                {
                    ClipboardText.IncompleteAt = null;
                    Native.CloseClipboard();
                }
            }
            finally { window.DestroyHandle(); }
        }

        public static void EveryProofNeedsACompleteEnumeration()
        {
            // Round 21: the shared enumeration, with the native calls injected.
            Func<uint[], int, int, bool> complete = (sequence, endError, counted) =>
            {
                int i = 0;
                List<uint> got;
                return ClipboardText.EnumerateComplete(f => i < sequence.Length ? sequence[i++] : 0u, () => endError, () => counted, out got);
            };
            uint sentinel = Native.RegisterClipboardFormat(PendingClipboard.SentinelFormat);
            Assert.Equal(true, complete(new uint[] { 13, sentinel }, 0, 2), "every format, ERROR_SUCCESS at the end, the count matches: complete");
            // Astra scenario 1: a foreign format appended AFTER ours, the enumeration stopping before it: no proof (no restore).
            Assert.Equal(false, complete(new uint[] { 13, sentinel }, 0, 3), "stopped before an appended foreign format (counted 3): incomplete");
            Assert.Equal(false, complete(new uint[] { 13, sentinel }, 1418, 2), "ended with an error: incomplete");
            // Astra scenario 2: saved A+B, now A matching, B changed, the enumeration failing after A: no deletion.
            Assert.Equal(false, complete(new uint[] { 13 }, 1418, 2), "failed after A: incomplete (the record is not deleted as untouched)");
            Assert.Equal(false, complete(new uint[] { 13, 13 }, 0, 2), "a repeated id: incomplete");
            Assert.Equal(true, complete(new uint[0], 0, 0), "an empty clipboard, positively");
            Assert.Equal(false, complete(new uint[0], 0, 4), "nothing listed but 4 counted: incomplete");
        }

        public static void OnlyAWholeSaveIsEverAlreadyThere()
        {
            // Round 23 (B2): the retained subset of an incomplete save back on the clipboard is never "nothing missing".
            var text = new KeyValuePair<uint, byte[]>(13, new byte[] { 65, 0, 0, 0 });
            var present = new List<uint> { 13 };
            Assert.Equal(true, SavedClipboard.ForTest(new[] { text }, false).AllPresent(present), "control: a whole save, all present");
            Assert.Equal(false, SavedClipboard.ForTest(new[] { text }, false, true, true).AllPresent(present), "a reported skip (class 3, a cap, a policy): never already there");
            Assert.Equal(false, SavedClipboard.ForTest(new[] { text }, false, false, false).AllPresent(present), "not complete (a bitmap not rebuilt): never already there");
            Assert.Equal(false, SavedClipboard.ForTest(new[] { text }, false, true, true).Incomplete == false, "and it is incomplete (its Restore says restored-partially)");
        }

        public static void OnlyUserContentCountsAsRestorable()
        {
            // Round 24 (Opus, the one rule at the user's Restore): CF_LOCALE, markers and flags are no content to put back.
            uint marker = Native.RegisterClipboardFormat("ExcludeClipboardContentFromMonitorProcessing");
            var locale = new KeyValuePair<uint, byte[]>(16, new byte[] { 9, 4, 0, 0 });
            var text = new KeyValuePair<uint, byte[]>(13, new byte[] { 65, 0, 0, 0 });
            var mark = new KeyValuePair<uint, byte[]>(marker, new byte[] { 0 });
            Assert.Equal(0, SavedClipboard.ForTest(new[] { locale, mark }, true).UserContentCount, "CF_LOCALE and a marker: nothing to put back");
            Assert.Equal(1, SavedClipboard.ForTest(new[] { locale, text }, false).UserContentCount, "the text is content");
        }

        public static void ARecordThatCannotGoBackWholeIsNeverRestored()
        {
            // Round 21: on reading a record, a registered format with an empty name (or one that cannot be registered)
            // and a metafile that cannot be rebuilt make the record INCOMPLETE: a put-back of it is never "restored"
            // (so the user's Restore cannot delete it) and it is never "already on the clipboard".
            Func<Action<System.IO.BinaryWriter>, SavedClipboard> read = (write) =>
            {
                var stream = new System.IO.MemoryStream();
                using (var writer = new System.IO.BinaryWriter(stream, System.Text.Encoding.UTF8, true)) write(writer);
                stream.Position = 0;
                using (var reader = new System.IO.BinaryReader(stream, System.Text.Encoding.UTF8)) return SavedClipboard.ReadFrom(reader);
            };
            SavedClipboard noName = read(w =>
            {
                w.Write(2);
                w.Write(13u); w.Write(""); w.Write(4); w.Write(new byte[] { 65, 0, 0, 0 });
                w.Write(0xC123u); w.Write(""); w.Write(3); w.Write(new byte[] { 1, 2, 3 }); // a registered format with no name
                w.Write(0); w.Write(false); w.Write(true); w.Write(false);
            });
            Assert.Equal("unrestored", noName.PutBackResult(true), "a registered format without a name: never restored (the record stays)");
            Assert.Equal(false, noName.AllPresent(new List<uint> { 13 }), "and never already there");
            SavedClipboard badEmf = read(w =>
            {
                w.Write(1);
                w.Write(13u); w.Write(""); w.Write(4); w.Write(new byte[] { 65, 0, 0, 0 });
                w.Write(5); w.Write(new byte[] { 1, 2, 3, 4, 5 }); // metafile bits that cannot be rebuilt
                w.Write(false); w.Write(true); w.Write(false);
            });
            Assert.Equal("unrestored", badEmf.PutBackResult(true), "a metafile that cannot be rebuilt: never restored");
            SavedClipboard whole = read(w =>
            {
                w.Write(1);
                w.Write(13u); w.Write(""); w.Write(4); w.Write(new byte[] { 65, 0, 0, 0 });
                w.Write(0); w.Write(false); w.Write(true); w.Write(false);
            });
            Assert.Equal("restored", whole.PutBackResult(true), "control: a whole record is restored");
        }

        public static void OfferOnlyRecordsAreNeverRestoredOnTheirOwn()
        {
            Func<uint, OurWrite, int, ClipboardView> view = (seq, write, count) => new ClipboardView { Sequence = seq, OurWrite = write, FormatCount = count };
            Func<string, uint, RecordFacts> offerOnly = (stage, at) => new RecordFacts { Stage = stage, SequenceAtStage = at, SequenceAfterWrite = 7, OfferOnly = true };
            // The round-16 trace: a rejection, then a retry that finds our complete write within our own operations.
            Assert.Equal(PendingClipboard.RecoveryVerdict.Pending, PendingClipboard.Decide(offerOnly("written", 7), view(9, OurWrite.Complete, 8), LogonMatch.Same), "offer-only: our complete write within our own operations is no longer (a)");
            Assert.Equal(PendingClipboard.RecoveryVerdict.Pending, PendingClipboard.Decide(offerOnly("emptied", 4), view(4, OurWrite.None, 0), LogonMatch.Same), "offer-only: an empty clipboard at exactly M is no longer (b) (an adopted payload)");
            Assert.Equal(PendingClipboard.RecoveryVerdict.Pending, PendingClipboard.Decide(offerOnly("saved", 4), view(4, OurWrite.None, 1), LogonMatch.Same), "offer-only: not even 'nothing emptied' is believed");
            ClipboardView exact = view(15, OurWrite.None, 5); exact.HoldsSavedExactly = true; exact.OnlySavedFormats = true;
            Assert.Equal(PendingClipboard.RecoveryVerdict.Untouched, PendingClipboard.Decide(offerOnly("restore-emptied", 8), exact, LogonMatch.Same), "the saved content already there: deleted, losing nothing");
            Assert.Equal(PendingClipboard.RecoveryVerdict.OtherSession, PendingClipboard.Decide(offerOnly("written", 7), view(9, OurWrite.Complete, 8), LogonMatch.OtherSession), "another session's: still left alone");
            Assert.Equal(PendingClipboard.RecoveryVerdict.Pending, PendingClipboard.Decide(new RecordFacts { Stage = "written", SequenceAtStage = 7, SequenceAfterWrite = 7 }, view(9, OurWrite.Complete, 8), LogonMatch.Same), "the same record never rejected: also offered since round 18 (no authority from disk)");
        }

        public static void StatesAreValidatedStrictly()
        {
            string dir = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "dn-pending-schema-" + Guid.NewGuid().ToString("N"));
            System.IO.Directory.CreateDirectory(dir);
            string old = PendingClipboard.Directory;
            PendingClipboard.Directory = dir;
            try
            {
                var items = new[] { new KeyValuePair<uint, byte[]>(13, System.Text.Encoding.Unicode.GetBytes("schema\0")) };
                PendingRecord record = PendingClipboard.Begin(SavedClipboard.ForTest(items, false), "dictated");
                record.PayloadWriter.Join(10000);
                string path = System.IO.Directory.GetFiles(dir, "*.state").Single();
                string text = System.IO.File.ReadAllText(path);
                Assert.Equal(null, RecordFacts.Validate(Wire.Parse(text), record.Id), "a state this helper wrote is valid");
                Func<Action<Dictionary<string, object>>, string> mutated = (change) => { var state = Wire.Parse(text); change(state); return RecordFacts.Validate(state, record.Id); };
                var cases = new Dictionary<string, string>
                {
                    { "{}", RecordFacts.Validate(Wire.Parse("{}"), record.Id) },
                    { "missing stage", mutated(st => st.Remove("stage")) },
                    { "unknown stage", mutated(st => st["stage"] = "restored-ish") },
                    { "stage of the wrong type", mutated(st => st["stage"] = 3) },
                    { "missing session", mutated(st => st.Remove("session")) },
                    { "missing logon", mutated(st => st.Remove("logon")) },
                    { "missing session key", mutated(st => st.Remove("sessionKey")) },
                    { "missing boot id", mutated(st => st.Remove("bootId")) },
                    { "session as a string", mutated(st => st["session"] = "1") },
                    { "a negative sequence", mutated(st => st["sequenceAtStage"] = -1) },
                    { "a fractional sequence", mutated(st => st["sequenceAtStage"] = 1.5) },
                    { "a sequence beyond 32 bits", mutated(st => st["sequenceClosed"] = 4294967296.0) },
                    { "offerOnly missing (an older build)", mutated(st => st.Remove("offerOnly")) },
                    { "offerOnly as a string", mutated(st => st["offerOnly"] = "false") },
                    { "extra junk", mutated(st => st["junk"] = 1) },
                    { "another record's id", mutated(st => st["id"] = "fedcba9876543210fedcba9876543210") },
                    { "another format", mutated(st => st["format"] = 2) },
                    { "five offer boots", mutated(st => st["offerBoots"] = 5) },
                    { "a null stage", mutated(st => st["stage"] = null) },
                    { "truncated JSON", RecordFacts.Validate(Wire.Parse(text.Substring(0, text.Length / 2)), record.Id) },
                    { "an array", RecordFacts.Validate(Wire.Parse("[1,2]"), record.Id) },
                    { "zeroed bytes", RecordFacts.Validate(Wire.Parse(new string('\0', 64)), record.Id) }
                };
                foreach (KeyValuePair<string, string> c in cases) Assert.True(c.Value != null, c.Key + ": invalid (never a default that could make proof)");
                Assert.Equal(null, mutated(st => st["stage"] = "settled"), "the settled stage is a known one");
                Assert.Equal(null, mutated(st => { st["session"] = -1; st["logon"] = ""; st["sessionKey"] = ""; st["bootId"] = ""; st["pid"] = 0; }), "a rebuilt record's unknown identity is a valid (offer-only) state");
                Assert.Equal(true, RecordFacts.Of(Wire.Parse(text)).OfferOnly == false, "a fresh transaction is not offer-only");
                PendingClipboard.Finish(record, "restored");
            }
            finally
            {
                PendingClipboard.DrainJournal(10000); // round 33: queued steps run before the directory changes back
                PendingClipboard.Directory = old;
                try { System.IO.Directory.Delete(dir, true); } catch (Exception) { }
            }
        }

        public static void ARecordIsNeverDeletedByItsStageAlone()
        {
            // Round 33 (a), a directed change (until round 32 this test pinned: a "saved" record is deleted on sight, also
            // from another boot). Begin's first durable state is "emptying" ("may be emptied"); no stage, neither that nor
            // an earlier build's "saved", deletes a record: recovery decides by CONTENT, and here (no clipboard window) the
            // clipboard cannot be looked at, so the record is kept.
            string dir = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "dn-pending-saved-" + Guid.NewGuid().ToString("N"));
            System.IO.Directory.CreateDirectory(dir);
            string old = PendingClipboard.Directory;
            PendingClipboard.Directory = dir;
            try
            {
                var items = new[] { new KeyValuePair<uint, byte[]>(13, System.Text.Encoding.Unicode.GetBytes("saved stage\0")) };
                PendingRecord record = PendingClipboard.Begin(SavedClipboard.ForTest(items, false), "dictated");
                record.PayloadWriter.Join(10000);
                PendingClipboard.ForgetInFlight(record.Id); // round 35: the in-flight set is lock-free (no HashSet to reach)
                string state = System.IO.Directory.GetFiles(dir, "*.state").Single();
                var parsed = Wire.Parse(System.IO.File.ReadAllText(state));
                Assert.Equal("emptying", Wire.Str(parsed, "stage"), "Begin's first durable state is \"emptying\"");
                parsed["bootId"] = "an-earlier-boot";
                System.IO.File.WriteAllText(state, Wire.Serialize(parsed));
                Assert.Equal(null, RecordFacts.Validate(Wire.Parse(System.IO.File.ReadAllText(state)), record.Id), "still a valid state");
                PendingClipboard.RecoverLeftover("test");
                Assert.Equal(true, PendingClipboard.OnDisk(record.Id), "an \"emptying\" record of another boot: kept (never deleted by its stage)");
                parsed["stage"] = "saved";
                System.IO.File.WriteAllText(state, Wire.Serialize(parsed));
                PendingClipboard.RecoverLeftover("test");
                Assert.Equal(true, PendingClipboard.OnDisk(record.Id), "an earlier build's \"saved\" record: kept too (the old stage rule is gone)");
            }
            finally
            {
                PendingClipboard.DrainJournal(10000); // round 33: queued steps run before the directory changes back
                PendingClipboard.Directory = old;
                try { System.IO.Directory.Delete(dir, true); } catch (Exception) { }
            }
        }

        public static void ASettledRecordIsNeverOfferedAgain()
        {
            string dir = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "dn-pending-settled-" + Guid.NewGuid().ToString("N"));
            System.IO.Directory.CreateDirectory(dir);
            string old = PendingClipboard.Directory;
            PendingClipboard.Directory = dir;
            try
            {
                var items = new[] { new KeyValuePair<uint, byte[]>(13, System.Text.Encoding.Unicode.GetBytes("settled\0")) };
                PendingRecord record = PendingClipboard.Begin(SavedClipboard.ForTest(items, false), "dictated");
                record.PayloadWriter.Join(10000);
                string payload = System.IO.Directory.GetFiles(dir, "*.bin").Single();
                string state = System.IO.Directory.GetFiles(dir, "*.state").Single();
                // Another process holds the payload (an AV scan): the deletion after the restore is refused, nothing deleted.
                using (new System.IO.FileStream(payload, System.IO.FileMode.Open, System.IO.FileAccess.Read, System.IO.FileShare.Read))
                {
                    PendingClipboard.Finish(record, "restored");
                    Assert.Equal(true, PendingClipboard.DrainJournal(10000), "the journal writer ran its queue (round 33: settlement is queued)");
                    Assert.Equal(true, PendingClipboard.OnDisk(record.Id), "the deletion waited (the payload was held): intact");
                    Assert.Equal("settled", Wire.Str(Wire.Parse(System.IO.File.ReadAllText(state)), "stage"), "but journaled settled before it left in-flight");
                }
                // The next check deletes it on sight, never offers it (it found no clipboard to compare: it never opened one).
                PendingClipboard.RecoverLeftover("test");
                Assert.Equal(false, PendingClipboard.OnDisk(record.Id), "a settled record is deleted, never offered again");
            }
            finally
            {
                PendingClipboard.DrainJournal(10000); // round 33: queued steps run before the directory changes back
                PendingClipboard.Directory = old;
                try { System.IO.Directory.Delete(dir, true); } catch (Exception) { }
            }
        }

        public static void ARecordIsOfferedInAtMostTwoBoots()
        {
            RecordFacts facts = new RecordFacts();
            // Boot A: the transaction crashed before any offer.
            Assert.Equal("keep", PendingClipboard.OfferBootStep(facts, "A", 9000), "never offered: nothing to count");
            // Boot B: first offered (as Offer() records it).
            Assert.Equal("keep", PendingClipboard.OfferBootStep(facts, "B", 9000), "first offer in B");
            facts.OfferedTick = 5000; facts.OfferedBoot = "B"; facts.OfferBoots = 1; facts.OfferedSequence = 40;
            Assert.Equal("keep", PendingClipboard.OfferBootStep(facts, "B", 9000), "still B: kept");
            // Boot C: offered again, as a fresh offer (sequence numbers restarted).
            Assert.Equal("reoffer", PendingClipboard.OfferBootStep(facts, "C", 9000), "C: offered again");
            Assert.Equal(2, facts.OfferBoots, "two boots counted");
            Assert.Equal(0u, facts.OfferedSequence, "the old offered sequence means nothing in C");
            facts.OfferedTick = 3000; facts.OfferedBoot = "C"; facts.OfferedSequence = 7;
            Assert.Equal("keep", PendingClipboard.OfferBootStep(facts, "C", 9000), "still C: kept");
            // Boot D: deleted (a policy, not proof the content is no longer wanted).
            Assert.Equal("delete", PendingClipboard.OfferBootStep(facts, "D", 9000), "D: deleted (the boot limit is a policy)");
            // Without a boot counter: a tick count below the offer's is another boot.
            RecordFacts noCounter = new RecordFacts { OfferedTick = 50000, OfferBoots = 1, OfferedSequence = 3 };
            Assert.Equal("keep", PendingClipboard.OfferBootStep(noCounter, "", 60000), "no counter, later tick: the same boot");
            Assert.Equal("reoffer", PendingClipboard.OfferBootStep(noCounter, "", 1000), "no counter, earlier tick: another boot");
        }

        public static void ARecoveryJournalNeverCarriesAnotherBootsSequences()
        {
            RecordFacts old = new RecordFacts { Stage = "restore-emptied", SequenceAtStage = 100, SequenceClosed = 101, SequenceAfterWrite = 97, Tick = 9000000 };
            PendingRecord journal = new PendingRecord("0123456789abcdef0123456789abcdef", "n");
            PendingClipboard.Inherit(journal, old, LogonMatch.Different, 4000);
            Assert.Equal("", journal.OriginStage ?? "", "another boot: no origin stage");
            Assert.Equal(0u, journal.OriginSequenceAtStage, "no origin sequence");
            Assert.Equal(0u, journal.SequenceAfterWrite, "no write sequence");
            Assert.Equal(4000L, journal.CreatedTick, "this boot's tick, not the old record's");
            // So a coincidental empty at the old sequence proves nothing: the journal's stage alone decides.
            RecordFacts written = new RecordFacts { Stage = "recovering", SequenceAtStage = 90, OriginStage = journal.OriginStage ?? "", OriginSequenceAtStage = journal.OriginSequenceAtStage };
            Assert.Equal(PendingClipboard.RecoveryVerdict.Pending, PendingClipboard.Decide(written, new ClipboardView { Sequence = 100, FormatCount = 0 }, LogonMatch.Same), "an empty clipboard at the old boot's sequence: offered, never restored on its own");
            PendingRecord unknown = new PendingRecord("0123456789abcdef0123456789abcdef", "n");
            PendingClipboard.Inherit(unknown, old, LogonMatch.Unknown, 4000);
            Assert.Equal("", unknown.OriginStage ?? "", "an unknown logon: no origin either");
            PendingRecord same = new PendingRecord("0123456789abcdef0123456789abcdef", "n");
            PendingClipboard.Inherit(same, old, LogonMatch.Same, 4000);
            Assert.Equal("", same.OriginStage ?? "", "round 18: even the same logon and boot carries no origin (nothing on disk is proof)");
            Assert.Equal(0u, same.OriginSequenceAtStage, "and no sequence");
            Assert.Equal(9000000L, same.CreatedTick, "only the creation tick, from the same boot");
        }

        public static void AnInterruptedRestoreHoldsOnlyWhatWeSaved()
        {
            var text = new KeyValuePair<uint, byte[]>(13, System.Text.Encoding.Unicode.GetBytes("old\0"));
            var mine = new KeyValuePair<uint, byte[]>(0xC123, new byte[] { 1, 2, 3 });
            var saved = new List<KeyValuePair<uint, byte[]>> { text, mine };
            Func<Dictionary<uint, byte[]>, Func<uint, int, byte[]>> reader = (now) => (f, cap) => now.ContainsKey(f) ? now[f].Take(Math.Min(cap, now[f].Length)).ToArray() : null;
            Func<byte[]> noEmf = () => null;
            Assert.Equal(true, SavedClipboard.ExplainsPresent(new uint[] { 13, 1, 7, 16 }, reader(new Dictionary<uint, byte[]> { { 13, text.Value } }), saved, null, noEmf), "our text (and what Windows synthesizes from it)");
            Assert.Equal(true, SavedClipboard.ExplainsPresent(new uint[] { 0xC123 }, reader(new Dictionary<uint, byte[]> { { 0xC123, mine.Value } }), saved, null, noEmf), "a restore cut short after one format");
            Assert.Equal(false, SavedClipboard.ExplainsPresent(new uint[] { 0xC123, 1 }, reader(new Dictionary<uint, byte[]> { { 0xC123, mine.Value } }), saved, null, noEmf), "text present without its saved source: not synthesized from what is there");
            var locale = new List<KeyValuePair<uint, byte[]>> { new KeyValuePair<uint, byte[]>(16, new byte[] { 9, 4, 0, 0 }) };
            Assert.Equal(false, SavedClipboard.ExplainsPresent(new uint[] { 16, 13 }, reader(new Dictionary<uint, byte[]> { { 16, new byte[] { 9, 4, 0, 0 } }, { 13, System.Text.Encoding.Unicode.GetBytes("any\0") } }), locale, null, noEmf), "a saved CF_LOCALE alone explains no text (directed synthesis)");
            Assert.Equal(false, SavedClipboard.ExplainsPresent(new uint[] { 0xC123 }, reader(new Dictionary<uint, byte[]> { { 0xC123, new byte[] { 1, 2, 3, 4 } } }), saved, null, noEmf), "longer data that starts with our bytes is not ours");
            Assert.Equal(false, SavedClipboard.ExplainsPresent(new uint[] { 8, 2, 17 }, reader(new Dictionary<uint, byte[]>()), saved, null, noEmf), "a screenshot (bitmap family we never saved)");
            Assert.Equal(false, SavedClipboard.ExplainsPresent(new uint[] { 13 }, reader(new Dictionary<uint, byte[]> { { 13, System.Text.Encoding.Unicode.GetBytes("new\0") } }), saved, null, noEmf), "same format, other content");
            Assert.Equal(false, SavedClipboard.ExplainsPresent(new uint[] { 15 }, reader(new Dictionary<uint, byte[]>()), saved, null, noEmf), "a file list we never saved");
            Assert.Equal(false, SavedClipboard.ExplainsPresent(new uint[] { 1, 7 }, reader(new Dictionary<uint, byte[]>()), saved, null, noEmf), "only synthesized formats: nothing compared");
            var bitmap = new KeyValuePair<uint, byte[]>(8, new byte[] { 9, 9, 9 });
            Assert.Equal(false, SavedClipboard.ExplainsPresent(new uint[] { 8, 2 }, reader(new Dictionary<uint, byte[]> { { 8, new byte[] { 7, 7, 7 } } }), new List<KeyValuePair<uint, byte[]>> { bitmap }, null, noEmf), "a different bitmap than the one we saved");
            Assert.Equal(true, SavedClipboard.ExplainsPresent(new uint[] { 8, 2, 9, 17 }, reader(new Dictionary<uint, byte[]> { { 8, bitmap.Value } }), new List<KeyValuePair<uint, byte[]>> { bitmap }, null, noEmf), "our bitmap back (and what Windows makes from a DIB)");
            uint marker = Native.RegisterClipboardFormat(ClipboardText.MarkerNames[0]);
            Assert.Equal(true, SavedClipboard.ExplainsPresent(new uint[] { 13, marker }, reader(new Dictionary<uint, byte[]> { { 13, text.Value }, { marker, new byte[] { 0 } } }), saved, null, noEmf, true), "conservative markers the save forced");
            Assert.Equal(false, SavedClipboard.ExplainsPresent(new uint[] { 13, marker }, reader(new Dictionary<uint, byte[]> { { 13, text.Value }, { marker, new byte[] { 0 } } }), saved, null, noEmf, false), "markers the save did not force");
            Assert.Equal("unrestored", SavedClipboard.RestoreResult(false, true, false), "a format that could not be set back: failed, record kept");
            Assert.Equal("restored", SavedClipboard.RestoreResult(true, true, false), "complete");
            Assert.Equal("partial", SavedClipboard.RestoreResult(true, false, false), "what the save could not keep: settled");
            Assert.Equal("skipped", SavedClipboard.RestoreResult(true, true, true), "capped content: settled");
        }

        public static void ARecoveryReportsWhatTheSaveKept()
        {
            var items = new[] { new KeyValuePair<uint, byte[]>(13, System.Text.Encoding.Unicode.GetBytes("user\0")) };
            foreach (var c in new[] { Tuple.Create(true, false, "restored"), Tuple.Create(false, false, "partial"), Tuple.Create(true, true, "skipped") })
            {
                var stream = new System.IO.MemoryStream();
                using (var writer = new System.IO.BinaryWriter(stream, System.Text.Encoding.UTF8, true)) SavedClipboard.ForTest(items, false, c.Item1, c.Item2).WriteTo(writer);
                stream.Position = 0;
                SavedClipboard back;
                using (var reader = new System.IO.BinaryReader(stream, System.Text.Encoding.UTF8)) back = SavedClipboard.ReadFrom(reader);
                Assert.Equal(c.Item3, back.PutBackResult(true), "a written-down save keeps its completeness: " + c.Item3);
                Assert.Equal("unrestored", back.PutBackResult(false), "a failed set-back is never reported restored");
            }
        }

        public static void RetriesMoveOnlyOnFailedAttemptsOrAmbiguousStates()
        {
            Assert.Equal(0, PendingClipboard.NextStep(false, 0, PendingClipboard.RetryKind.Check), "a first check schedules step 0");
            Assert.Equal(PendingClipboard.KeepSchedule, PendingClipboard.NextStep(true, 2, PendingClipboard.RetryKind.Check), "a start or delivery check keeps the schedule (consumes nothing)");
            Assert.Equal(3, PendingClipboard.NextStep(true, 2, PendingClipboard.RetryKind.Failed), "a failed restore attempt moves on");
            Assert.Equal(3, PendingClipboard.NextStep(true, 2, PendingClipboard.RetryKind.Pending), "an ambiguous state moves on");
            Assert.Equal(2, PendingClipboard.NextStep(true, 2, PendingClipboard.RetryKind.Busy), "a busy clipboard waits on its step");
            Assert.Equal(PendingClipboard.RetryKind.Check, PendingClipboard.KindAfter(PendingClipboard.RecoverResult.Failed, false), "RecoverLeftover (start, delivery) never consumes a step");
            Assert.Equal(PendingClipboard.RetryKind.Failed, PendingClipboard.KindAfter(PendingClipboard.RecoverResult.Failed, true), "the timer's failed attempt");
            Assert.Equal(PendingClipboard.RetryKind.Pending, PendingClipboard.KindAfter(PendingClipboard.RecoverResult.Busy, true), "the timer finds the clipboard busy (or the key unavailable): backs off, never a tight loop");
            Assert.Equal(PendingClipboard.RetryKind.Pending, PendingClipboard.KindAfter(PendingClipboard.RecoverResult.Pending, true), "the timer finds it still ambiguous");
        }

        public static void ASettledTransactionIsNeverPublishedAndOrphansAreSwept()
        {
            string dir = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "dn-pending-race-" + Guid.NewGuid().ToString("N"));
            System.IO.Directory.CreateDirectory(dir);
            string old = PendingClipboard.Directory;
            int oldDelay = PendingClipboard.TestPayloadDelayMs;
            int oldDeadline = PendingClipboard.BeginDeadlineMs;
            PendingClipboard.Directory = dir;
            try
            {
                var items = new[] { new KeyValuePair<uint, byte[]>(13, System.Text.Encoding.Unicode.GetBytes("user\0")) };
                // A slow payload writer (a busy disk, an AV scan). Round 33: the payload on disk is the precondition of our
                // EmptyClipboard, so a payload later than Begin's deadline makes the transaction NOT established (no record,
                // nothing emptied), and the late writer publishes nothing.
                PendingClipboard.TestPayloadDelayMs = 600;
                PendingClipboard.BeginDeadlineMs = 150;
                PendingRecord record = PendingClipboard.Begin(SavedClipboard.ForTest(items, false), "dictated");
                Assert.Equal(true, record == null, "not established: the payload was not on disk within the deadline");
                Assert.Equal(true, PendingClipboard.LastBeginFailure != null && PendingClipboard.LastBeginFailure.Contains("150 ms"), "the reason is given (" + PendingClipboard.LastBeginFailure + ")");
                for (int i = 0; i < 100 && PendingClipboard.WritersRunning() > 0; i++) System.Threading.Thread.Sleep(50);
                Assert.Equal(0, PendingClipboard.WritersRunning(), "the late writer finished");
                // The writer removes what it had published once it ends (Begin had given up): polled with a deadline.
                for (int i = 0; i < 100 && System.IO.Directory.GetFiles(dir).Length > 0; i++) System.Threading.Thread.Sleep(50);
                Assert.Equal(0, System.IO.Directory.GetFiles(dir).Length, "the late writer did not publish (no payload, no .tmp, no state)");
                PendingClipboard.TestPayloadDelayMs = 0;
                PendingClipboard.BeginDeadlineMs = oldDeadline;
                // Leftovers without a state file, and a round-8 record: deleted, never restored from.
                string prefix = "DoodleNote-Bark-clipboard-" + HelperIdentity.Sanitized;
                // Orphans older than 10 minutes go; a fresh one (another session's helper may be mid-step) stays.
                string oldOrphan = System.IO.Path.Combine(dir, prefix + "-0123456789abcdef0123456789abcdef.bin");
                string oldTmp = System.IO.Path.Combine(dir, prefix + "-fedcba9876543210fedcba9876543210.bin.tmp");
                string freshOrphan = System.IO.Path.Combine(dir, prefix + "-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.bin");
                System.IO.File.WriteAllBytes(oldOrphan, new byte[] { 1 });
                System.IO.File.WriteAllBytes(oldTmp, new byte[] { 1 });
                System.IO.File.WriteAllBytes(freshOrphan, new byte[] { 1 });
                System.IO.File.SetLastWriteTimeUtc(oldOrphan, DateTime.UtcNow.AddHours(-1));
                System.IO.File.SetLastWriteTimeUtc(oldTmp, DateTime.UtcNow.AddHours(-1));
                System.IO.File.WriteAllBytes(System.IO.Path.Combine(dir, prefix + ".bin"), new byte[] { 1 });
                // Another identity whose name starts with ours (X-foo for X): its records are never read or deleted.
                string otherState = System.IO.Path.Combine(dir, prefix + "-foo-0123456789abcdef0123456789abcdef.state");
                string otherPayload = System.IO.Path.Combine(dir, prefix + "-foo-0123456789abcdef0123456789abcdef.bin");
                string otherOrphan = System.IO.Path.Combine(dir, prefix + "-foo-fedcba9876543210fedcba9876543210.bin");
                System.IO.File.WriteAllText(otherState, "{\"stage\":\"written\"}");
                System.IO.File.WriteAllBytes(otherPayload, new byte[] { 1 });
                System.IO.File.WriteAllBytes(otherOrphan, new byte[] { 1 });
                PendingClipboard.RecoverLeftover("test");
                Assert.Equal(4, System.IO.Directory.GetFiles(dir).Length, "our old orphans and the legacy record are gone; the fresh orphan and the other identity's three files stay");
                Assert.Equal(true, System.IO.File.Exists(freshOrphan) && !System.IO.File.Exists(oldOrphan) && !System.IO.File.Exists(oldTmp), "only orphans older than 10 minutes are swept");
                Assert.Equal(true, System.IO.File.Exists(otherState) && System.IO.File.Exists(otherPayload) && System.IO.File.Exists(otherOrphan), "X-foo's record and payloads untouched");
            }
            finally
            {
                PendingClipboard.DrainJournal(10000); // round 33: queued steps run before the directory changes back
                PendingClipboard.Directory = old;
                PendingClipboard.TestPayloadDelayMs = oldDelay;
                PendingClipboard.BeginDeadlineMs = oldDeadline;
                try { System.IO.Directory.Delete(dir, true); } catch (Exception) { }
            }
        }

        /// <summary>Round 33: the journal's stage transitions (Begin's durable state, the queued diagnostics, settlement).</summary>
        public static void TheJournalsStageTransitionsAreDurableOnlyWhereTheyMustBe()
        {
            string dir = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "dn-journal-test-" + Guid.NewGuid().ToString("N"));
            System.IO.Directory.CreateDirectory(dir);
            string old = PendingClipboard.Directory;
            PendingClipboard.Directory = dir;
            Func<string, string> state = id => System.IO.File.ReadAllText(System.IO.Directory.GetFiles(dir, "*" + id + ".state")[0]);
            try
            {
                var items = new[] { new KeyValuePair<uint, byte[]>(13, System.Text.Encoding.Unicode.GetBytes("user\0")) };
                // Begin: the first durable state ("emptying": may be emptied) and the payload are on disk when it returns.
                PendingRecord record = PendingClipboard.Begin(SavedClipboard.ForTest(items, false), "dictated");
                Assert.Equal(true, record != null && record.PayloadPublished, "Begin returned with its payload published");
                Assert.Equal(2, System.IO.Directory.GetFiles(dir).Length, "the state and the payload, no .tmp");
                Assert.Equal(true, state(record.Id).Contains("\"stage\":\"emptying\""), "the first durable stage is emptying (no saved stage any more)");
                // Diagnostics: queued, written in order by the one writer.
                PendingClipboard.Stage(record, "emptied", 5);
                PendingClipboard.Stage(record, "written", 7, 7);
                Assert.Equal(true, PendingClipboard.DrainJournal(10000), "the journal writer ran its queue");
                Assert.Equal(true, state(record.Id).Contains("\"stage\":\"written\""), "the last diagnostic stage queued is the one on disk");
                // Settlement: settled and deleted on the writer; a stage queued AFTER it never recreates the state.
                PendingClipboard.Finish(record, "restored");
                PendingClipboard.Stage(record, "restore-emptied", 9);
                Assert.Equal(true, PendingClipboard.DrainJournal(10000), "the journal writer ran its queue");
                Assert.Equal(false, PendingClipboard.OnDisk(record.Id), "settled and deleted; the later stage wrote nothing");
                // A restore that did not complete: kept, with its offer-only and unrestored facts written in order.
                PendingRecord kept = PendingClipboard.Begin(SavedClipboard.ForTest(items, false), "dictated");
                PendingClipboard.Stage(kept, "written", 7, 7);
                PendingClipboard.Finish(kept, "unrestored");
                Assert.Equal(true, PendingClipboard.DrainJournal(10000), "the journal writer ran its queue");
                string facts = state(kept.Id);
                Assert.Equal(true, facts.Contains("\"offerOnly\":true") && facts.Contains("\"unrestored\":true") && facts.Contains("\"stage\":\"written\""), "kept: offer-only, unrestored, its last stage (" + facts + ")");
            }
            finally
            {
                PendingClipboard.DrainJournal(10000);
                PendingClipboard.Directory = old;
                try { System.IO.Directory.Delete(dir, true); } catch (Exception) { }
            }
        }

        /// <summary>Round 34-35: the unchanged-since-capture deletion proof and every guard it needs.</summary>
        public static void TheUnchangedSinceCaptureProofNeedsACompleteObservationInTheSameWindowStation() // round 36: every guard isolated
        {
            Func<RecordFacts> facts = () => new RecordFacts { Stage = "emptying", SequenceAtStage = 40, BootId = PendingClipboard.CurrentBootId, WindowStation = PendingClipboard.windowStation };
            Func<ClipboardView> view = () => new ClipboardView { Sequence = 40 };
            Assert.Equal(true, PendingClipboard.windowStation.Length > 0, "this process reads its window station (" + PendingClipboard.windowStation + ")");
            Assert.Equal(true, PendingClipboard.UnchangedSinceCapture(facts(), view(), LogonMatch.Same), "the same sequence, logon, boot and window station, a complete look: unchanged");
            ClipboardView incomplete = view(); incomplete.Incomplete = true;
            Assert.Equal(false, PendingClipboard.UnchangedSinceCapture(facts(), incomplete, LogonMatch.Same), "an incomplete enumeration proves nothing (round 21)");
            RecordFacts station = facts(); station.WindowStation = "Service-0x0-3e7$";
            Assert.Equal(false, PendingClipboard.UnchangedSinceCapture(station, view(), LogonMatch.Same), "another window station: its sequence numbers are another series");
            RecordFacts old = facts(); old.WindowStation = "";
            Assert.Equal(false, PendingClipboard.UnchangedSinceCapture(old, view(), LogonMatch.Same), "a state without its window station (round 33-34): no proof");
            RecordFacts written = facts(); written.Stage = "written";
            Assert.Equal(false, PendingClipboard.UnchangedSinceCapture(written, view(), LogonMatch.Same), "only the first durable stage carries the capture sequence");
            Assert.Equal(false, PendingClipboard.UnchangedSinceCapture(facts(), new ClipboardView { Sequence = 41 }, LogonMatch.Same), "the sequence moved");
            Assert.Equal(false, PendingClipboard.UnchangedSinceCapture(facts(), view(), LogonMatch.Unknown), "the logon cannot be told");
            RecordFacts boot = facts(); boot.BootId = "another-boot";
            Assert.Equal(false, PendingClipboard.UnchangedSinceCapture(boot, view(), LogonMatch.Same), "another boot");
            Assert.Equal(false, PendingClipboard.UnchangedSinceCapture(facts(), new ClipboardView { Sequence = 0 }, LogonMatch.Same), "a zero is no evidence");
            // Round 36 (Astra P3, Opus): each guard isolated, so that removing any one of them fails here.
            RecordFacts zero = facts(); zero.SequenceAtStage = 0;
            Assert.Equal(false, PendingClipboard.UnchangedSinceCapture(zero, new ClipboardView { Sequence = 0 }, LogonMatch.Same), "both zero (capture and now): no evidence, though they are equal");
            Assert.Equal(false, PendingClipboard.UnchangedSinceCapture(facts(), null, LogonMatch.Same), "no view at all");
            RecordFacts noBoot = facts(); noBoot.BootId = "";
            Assert.Equal(false, PendingClipboard.UnchangedSinceCapture(noBoot, view(), LogonMatch.Same, "", PendingClipboard.windowStation), "the boot unavailable on both sides (equal, but empty): no proof");
            RecordFacts noStation = facts(); noStation.WindowStation = "";
            Assert.Equal(false, PendingClipboard.UnchangedSinceCapture(noStation, view(), LogonMatch.Same, PendingClipboard.CurrentBootId, ""), "the window station unavailable on both sides (equal, but empty): no proof");
            Assert.Equal(true, PendingClipboard.UnchangedSinceCapture(facts(), view(), LogonMatch.Same, PendingClipboard.CurrentBootId, PendingClipboard.windowStation), "the explicit form agrees with the one in use");
            Assert.Equal(false, PendingClipboard.UnchangedSinceCapture(null, view(), LogonMatch.Same), "no facts at all");
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
