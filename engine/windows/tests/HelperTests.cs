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

        public static void RecoveryWritesOnlyWhenProvablyOurs()
        {
            Func<uint, OurWrite, int, bool, ClipboardView> view = (seq, write, count, only) =>
                new ClipboardView { Sequence = seq, OurWrite = write, FormatCount = count, OnlySavedFormats = only, RestoreOps = 4 };
            Func<string, uint, RecordFacts> facts = (stage, atStage) => new RecordFacts { Stage = stage, SequenceAtStage = atStage, SequenceAfterWrite = 7 };
            Action<PendingClipboard.RecoveryVerdict, RecordFacts, ClipboardView, LogonMatch, string> expect = (want, f, v, logon, why) => Assert.Equal(want, PendingClipboard.Decide(f, v, logon), why);
            LogonMatch same = LogonMatch.Same, other = LogonMatch.Different, unknown = LogonMatch.Unknown;
            // Provable, so it is restored on its own: (a) our complete write within our own operations, (b) empty at exactly our M, (c) our window for this transaction.
            foreach (string stage in new[] { "emptied", "written", "restoring", "restore-emptied", "recovering", "recovering-emptied" })
                expect(PendingClipboard.RecoveryVerdict.OursByWrite, facts(stage, 3), view(9, OurWrite.Complete, 8, false), same, stage + ": (a) our complete write, within our own operations");
            expect(PendingClipboard.RecoveryVerdict.InterruptedEmpty, facts("emptied", 4), view(4, OurWrite.None, 0, false), same, "(b) empty at exactly M (journaled under our lock)");
            expect(PendingClipboard.RecoveryVerdict.InterruptedEmpty, new RecordFacts { Stage = "restore-emptied", SequenceAtStage = 8, SequenceClosed = 9 }, view(9, OurWrite.None, 0, false), same, "(b) empty at the sequence confirmed after our close");
            ClipboardView mine = view(12, OurWrite.None, 3, false); mine.OwnerIsUs = true; mine.OwnerAlive = true; mine.OwnedByThisTransaction = true;
            expect(PendingClipboard.RecoveryVerdict.OursByOwner, facts("restore-emptied", 8), mine, same, "(c) our live window owns it, and our last empty was this transaction's");
            ClipboardView otherTxn = view(12, OurWrite.None, 3, false); otherTxn.OwnerIsUs = true; otherTxn.OwnerAlive = true; otherTxn.OwnedByThisTransaction = false;
            expect(PendingClipboard.RecoveryVerdict.Pending, facts("restore-emptied", 8), otherTxn, same, "our window owns it for ANOTHER transaction: never ours for this one");
            // (a) needs continuity: a manager replaying every format (our sentinel too) after the crash, at a later sequence.
            expect(PendingClipboard.RecoveryVerdict.Pending, facts("written", 7), view(7 + (uint)PendingClipboard.CloseMoves + 8 + 1, OurWrite.Complete, 8, false), same, "a complete write BEYOND our own operations: a replay, offered, not restored on its own");
            // Pending: kept, nothing written, offered.
            expect(PendingClipboard.RecoveryVerdict.Pending, facts("emptied", 4), view(6, OurWrite.Partial, 2, false), same, "our write cut short, without the sentinel");
            expect(PendingClipboard.RecoveryVerdict.Pending, facts("restore-emptied", 8), view(10, OurWrite.None, 2, true), same, "only saved formats");
            expect(PendingClipboard.RecoveryVerdict.Pending, facts("emptying", 3), view(4, OurWrite.None, 0, false), same, "empty at N+1 after a pre-empty stage");
            expect(PendingClipboard.RecoveryVerdict.Pending, facts("written", 7), view(7, OurWrite.Complete, 8, false), unknown, "an unknown logon: even our complete write waits for the user");
            // Never deleted for these (the blocker): our own later transactions, the user's later copy, a live foreign owner.
            expect(PendingClipboard.RecoveryVerdict.Pending, facts("restore-emptied", 8), view(8 + 40, OurWrite.None, 3, false), same, "far beyond our bounds (another delivery, another offer's restore, the user's copy): still offered");
            ClipboardView foreign = view(9, OurWrite.None, 3, false); foreign.OwnerAlive = true;
            expect(PendingClipboard.RecoveryVerdict.Pending, facts("restore-emptied", 8), foreign, same, "a live foreign owner: offered, not deleted");
            // Deleted without writing, losing nothing.
            expect(PendingClipboard.RecoveryVerdict.Stale, facts("restore-emptied", 8), view(10, OurWrite.Complete, 8, false), other, "another boot: the clipboard did not survive it");
            expect(PendingClipboard.RecoveryVerdict.OtherSession, facts("restore-emptied", 8), view(10, OurWrite.None, 2, false), LogonMatch.OtherSession, "another session's record: left alone");
            expect(PendingClipboard.RecoveryVerdict.Untouched, facts("emptying", 3), view(3, OurWrite.None, 2, true), same, "nothing emptied yet");
            expect(PendingClipboard.RecoveryVerdict.Pending, facts("emptying", 3), view(3, OurWrite.None, 2, false), unknown, "the same sequence after a relogin proves nothing (the numbers start over): pending, never deleted");
            ClipboardView exact = view(15, OurWrite.None, 5, true); exact.HoldsSavedExactly = true;
            expect(PendingClipboard.RecoveryVerdict.Untouched, facts("restore-emptied", 8), exact, unknown, "the clipboard already holds exactly the saved content");
            expect(PendingClipboard.RecoveryVerdict.Untouched, facts("saved", 7), view(7, OurWrite.Complete, 1, true), same, "nothing was emptied");
            // D3 origin.
            RecordFacts chain = new RecordFacts { Stage = "recovering", SequenceAtStage = 20, SequenceAfterWrite = 7, OriginStage = "recovering-emptied", OriginSequenceAtStage = 18 };
            expect(PendingClipboard.RecoveryVerdict.Pending, chain, view(20, OurWrite.None, 2, true), same, "the four-helper chain: pending, not stale");
            expect(PendingClipboard.RecoveryVerdict.InterruptedEmpty, new RecordFacts { Stage = "recovering", SequenceAtStage = 18, OriginStage = "restore-emptied", OriginSequenceAtStage = 18 }, view(18, OurWrite.None, 0, false), same, "a recovery that never emptied: the found empty at its M still proves (b)");
        }

        public static void ContinuityCountsOnlyOperationsWePerformed()
        {
            Func<string, uint, RecordFacts> facts = (stage, at) => new RecordFacts { Stage = stage, SequenceAtStage = at };
            Func<uint, ClipboardView> view = (seq) => new ClipboardView { Sequence = seq, RestoreOps = 9 };
            uint slack = (uint)PendingClipboard.CloseMoves;
            // A restore journaled but not yet begun establishes no continuity: a replay of every format after a crash
            // before its empty (Empty + 8 sets) is beyond, whatever operations that restore would have performed.
            Assert.Equal(true, PendingClipboard.Beyond(facts("restoring", 100), view(100 + 1 + 8)), "restoring: a replay after a crash before the empty is beyond");
            Assert.Equal(false, PendingClipboard.Beyond(facts("restoring", 100), view(100 + slack)), "restoring: unchanged (plus a close) is continuous");
            Assert.Equal(true, PendingClipboard.Beyond(facts("recovering", 100), view(100 + slack + 1)), "recovering: nothing it had not done counts");
            // "emptied": our write's sets and its sentinel are one locked step after the journal.
            Assert.Equal(false, PendingClipboard.Beyond(facts("emptied", 100), view(100 + (uint)PendingClipboard.WriteOps + slack)), "emptied: our own write's sets count");
            Assert.Equal(true, PendingClipboard.Beyond(facts("emptied", 100), view(100 + (uint)PendingClipboard.WriteOps + slack + 1)), "emptied: one more is beyond");
            // Wrap-safe forward distance; a sequence behind the basis is beyond.
            Assert.Equal(false, PendingClipboard.Beyond(facts("written", 0xFFFFFFFFu), view(0u + 1)), "across the wrap: two steps forward");
            Assert.Equal(true, PendingClipboard.Beyond(facts("written", 0xFFFFFFF0u), view(0x10u)), "across the wrap: far forward");
            Assert.Equal(true, PendingClipboard.Beyond(facts("written", 100), view(99)), "behind the basis");
            Assert.Equal(true, PendingClipboard.Beyond(new RecordFacts { Stage = "written" }, view(5)), "nothing journaled: no continuity");
        }

        public static void TheLogonIdentityNeverUsesTheWallClock()
        {
            Func<string, string, LogonNow> now = (key, boot) => new LogonNow { Session = 1, Logon = "3e7", SessionKey = key, KeyCreatedTick = 1000, BootId = boot, Tick = 5000000 };
            RecordFacts here = new RecordFacts { Session = 1, Logon = "3e7", SessionKey = "a1", BootId = "14", Tick = 4000000 };
            Assert.Equal(LogonMatch.Same, here.Compare(now("a1", "14")), "same session, LUID, key and boot (a clock correction changes nothing)");
            Assert.Equal(LogonMatch.Different, here.Compare(now("a1", "15")), "another boot (Windows' boot counter): deleted, the clipboard did not survive it");
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
            Assert.Equal(true, PendingClipboard.Expired(offered, now(1000 + day + 1, "14")), "24 h after the first offer, on the tick count: deleted");
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
            var ours = new Dictionary<uint, byte[]>
            {
                { 13, System.Text.Encoding.Unicode.GetBytes("dictated\0") },
                { markers[0], new byte[] { 0 } }, { markers[1], BitConverter.GetBytes(0) }, { markers[2], BitConverter.GetBytes(0) },
                { sentinel, System.Text.Encoding.UTF8.GetBytes(id + ":" + nonce) }
            };
            Func<Dictionary<uint, byte[]>, Func<uint, int, byte[]>> reader = (now) => (f, cap) => now.ContainsKey(f) ? now[f].Take(Math.Min(cap, now[f].Length)).ToArray() : null;
            Func<Dictionary<uint, byte[]>, uint[], OurWrite> classify = (now, extra) => ClipboardText.ClassifyOurWrite(now.Keys.Concat(extra).ToList(), reader(now), id, nonce, hash);
            Assert.Equal(OurWrite.Complete, classify(ours, new uint[] { 1, 7, 16 }), "our text, markers and sentinel (and what Windows synthesizes from the text)");
            var noSentinel = new Dictionary<uint, byte[]>(ours); noSentinel.Remove(sentinel);
            Assert.Equal(OurWrite.Partial, classify(noSentinel, new uint[0]), "cut short before the sentinel (set last)");
            Assert.Equal(OurWrite.None, ClipboardText.ClassifyOurWrite(ours.Keys.ToList(), reader(ours), id, "00000000000000000000000000000000", hash), "another nonce (a replayed older sentinel)");
            var otherText = new Dictionary<uint, byte[]>(ours); otherText[13] = System.Text.Encoding.Unicode.GetBytes("dictatee\0");
            Assert.Equal(OurWrite.None, classify(otherText, new uint[0]), "other text with our sentinel");
            var otherMarker = new Dictionary<uint, byte[]>(ours); otherMarker[markers[1]] = BitConverter.GetBytes(1);
            Assert.Equal(OurWrite.None, classify(otherMarker, new uint[0]), "a marker value that is not ours");
            var foreign = new Dictionary<uint, byte[]>(ours); foreign[0xC333] = new byte[] { 1 };
            Assert.Equal(OurWrite.None, classify(foreign, new uint[0]), "a format our write never sets");
            var onlyMarkers = new Dictionary<uint, byte[]> { { markers[0], new byte[] { 0 } } };
            Assert.Equal(OurWrite.None, classify(onlyMarkers, new uint[] { 1 }), "synthesized text without our text");
            Assert.Equal(OurWrite.None, classify(new Dictionary<uint, byte[]>(), new uint[0]), "an empty clipboard is not a write");
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
            Assert.Equal(PendingClipboard.RetryKind.Busy, PendingClipboard.KindAfter(PendingClipboard.RecoverResult.Busy, true), "the timer finds the clipboard busy");
            Assert.Equal(PendingClipboard.RetryKind.Pending, PendingClipboard.KindAfter(PendingClipboard.RecoverResult.Pending, true), "the timer finds it still ambiguous");
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
                System.IO.File.WriteAllBytes(System.IO.Path.Combine(dir, prefix + "-0123456789abcdef0123456789abcdef.bin"), new byte[] { 1 });
                System.IO.File.WriteAllBytes(System.IO.Path.Combine(dir, prefix + "-fedcba9876543210fedcba9876543210.bin.tmp"), new byte[] { 1 });
                System.IO.File.WriteAllBytes(System.IO.Path.Combine(dir, prefix + ".bin"), new byte[] { 1 });
                // Another identity whose name starts with ours (X-foo for X): its records are never read or deleted.
                string otherState = System.IO.Path.Combine(dir, prefix + "-foo-0123456789abcdef0123456789abcdef.state");
                string otherPayload = System.IO.Path.Combine(dir, prefix + "-foo-0123456789abcdef0123456789abcdef.bin");
                string otherOrphan = System.IO.Path.Combine(dir, prefix + "-foo-fedcba9876543210fedcba9876543210.bin");
                System.IO.File.WriteAllText(otherState, "{\"stage\":\"written\"}");
                System.IO.File.WriteAllBytes(otherPayload, new byte[] { 1 });
                System.IO.File.WriteAllBytes(otherOrphan, new byte[] { 1 });
                PendingClipboard.RecoverLeftover("test");
                Assert.Equal(3, System.IO.Directory.GetFiles(dir).Length, "our orphans and the legacy record are gone; the other identity's three files stay");
                Assert.Equal(true, System.IO.File.Exists(otherState) && System.IO.File.Exists(otherPayload) && System.IO.File.Exists(otherOrphan), "X-foo's record and payloads untouched");
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
