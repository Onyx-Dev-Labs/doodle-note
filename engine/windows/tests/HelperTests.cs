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

        public static void MouseLossNeedsTwoConsecutiveSuspectTicks()
        {
            HookLossDetector mouse = new HookLossDetector(2);
            Assert.Equal(false, mouse.Observe(true, false, false), "one cursor move without a callback (an app moving it) is not a loss");
            Assert.Equal(false, mouse.Observe(false, false, false), "a quiet tick breaks the run");
            Assert.Equal(false, mouse.Observe(true, false, false), "run restarts at one");
            Assert.Equal(true, mouse.Observe(true, false, false), "two consecutive suspect ticks: lost");
            Assert.Equal(false, mouse.Observe(true, false, false), "evidence is cleared once a loss is declared");
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

        public static void TheHookRetryDelayGrowsAndCaps()
        {
            int delay = 0;
            int[] expected = { 4000, 8000, 16000, 30000, 30000 };
            foreach (int want in expected)
            {
                delay = HoldWatcher.NextBackoff(delay, 2000);
                Assert.Equal(want, delay, "retry delay");
            }
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
    }
}
