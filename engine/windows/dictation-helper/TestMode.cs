using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Threading;

namespace DoodleNote.DictationHelper
{
    /// <summary>
    /// Test facilities (the "__" ops, timing overrides, the clipboard cap override, the typing
    /// strategy switch) exist only in a build compiled with /define:DICTATION_TEST, which is used for
    /// the CI smoke and native QA harness. The shipped helper is compiled without it, so no
    /// environment variable can switch them on; even in a test build they need DICTATION_HELPER_TEST=1.
    /// </summary>
    internal static class TestMode
    {
#if DICTATION_TEST
        public static readonly bool On = Environment.GetEnvironmentVariable("DICTATION_HELPER_TEST") == "1";
#else
        public static readonly bool On = false;
#endif

        /// <summary>A test environment variable, or null (always null in a release build).</summary>
        public static string Env(string name)
        {
#if DICTATION_TEST
            return On ? Environment.GetEnvironmentVariable(name) : null;
#else
            return null;
#endif
        }

        /// <summary>A positive integer test override, or the fallback.</summary>
        public static int Int(string name, int fallback)
        {
            int value;
            string raw = Env(name);
            return raw != null && int.TryParse(raw, out value) && value > 0 ? value : fallback;
        }

        /// <summary>
        /// Round 30: a line the CI harness waits for ("test-trace: ..."), so a case acts on what the helper reached,
        /// never on a timed guess. Nothing in a release build.
        /// </summary>
        public static void Trace(string what)
        {
#if DICTATION_TEST
            if (On) Wire.Log("test-trace: " + what);
#endif
        }

        /// <summary>
        /// Round 30: a test-hook stall, announced first ("test-trace: stall NAME"), so the harness kills or acts once the
        /// helper is inside it. A no-op for 0. Round 31: the body is compiled into the test build only, so a release build
        /// cannot stall here whatever its callers pass (they pass 0 there anyway: Int answers the fallback).
        /// </summary>
        public static void Stall(string hook, int ms)
        {
#if DICTATION_TEST
            if (ms <= 0) return;
            Trace("stall " + hook + " " + ms + " ms");
            Thread.Sleep(ms);
#endif
        }

#if DICTATION_TEST
        static readonly Dictionary<string, int> gateUses = new Dictionary<string, int>();
#endif

        /// <summary>
        /// Round 30: a gate at a named point. Enabled per name (DICTATION_HELPER_TEST_GATES, a comma list) with a folder
        /// (DICTATION_HELPER_TEST_GATE_DIR): the n-th pass waits until the harness creates the file "NAME-n" there (at most
        /// 120 s), announcing "gate NAME#n waiting" and then "gate NAME#n opened" (or "timed out"). The order of the
        /// harness's action and the helper's next step is then fixed, not timed. Returns whether the gate was enabled
        /// (the caller's own timed wait is skipped then). Nothing in a release build.
        /// </summary>
        public static bool Gate(string name)
        {
#if DICTATION_TEST
            string folder = Env("DICTATION_HELPER_TEST_GATE_DIR");
            string enabled = Env("DICTATION_HELPER_TEST_GATES");
            if (string.IsNullOrEmpty(folder) || enabled == null || Array.IndexOf(enabled.Split(','), name) < 0) return false;
            int n;
            lock (gateUses)
            {
                gateUses.TryGetValue(name, out n);
                gateUses[name] = ++n;
            }
            string path = Path.Combine(folder, name + "-" + n);
            Trace("gate " + name + "#" + n + " waiting");
            Stopwatch waited = Stopwatch.StartNew();
            bool opened;
            while (!(opened = File.Exists(path)) && waited.ElapsedMilliseconds < 120000) Thread.Sleep(10);
            Trace("gate " + name + "#" + n + (opened ? " opened" : " timed out") + " after " + waited.ElapsedMilliseconds + " ms");
            return true;
#else
            return false;
#endif
        }
    }
}
