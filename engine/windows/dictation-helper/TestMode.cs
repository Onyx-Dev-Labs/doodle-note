using System;

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
    }
}
