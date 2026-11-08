using System;
using System.Text;

namespace DoodleNote.DictationHelper
{
    /// <summary>
    /// Which app identity this helper belongs to, so two identities installed side by side (a QA
    /// build beside production) never share helper state: the mute-recovery mutex and state file are
    /// named after it. The app passes its identity in DICTATION_HELPER_IDENTITY (a real setting, not
    /// a test switch); the default is the production app id.
    /// </summary>
    internal static class HelperIdentity
    {
        public const string Default = "com.doodlenote.desktop";

        public static readonly string Sanitized = Sanitize(Environment.GetEnvironmentVariable("DICTATION_HELPER_IDENTITY"));

        /// <summary>Letters, digits, '.', '-' and '_' are kept, anything else becomes '_'; at most 64 characters; empty means the default.</summary>
        public static string Sanitize(string identity)
        {
            if (string.IsNullOrWhiteSpace(identity)) identity = Default;
            StringBuilder clean = new StringBuilder();
            foreach (char c in identity.Trim())
            {
                if (clean.Length >= 64) break;
                bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '.' || c == '-' || c == '_';
                clean.Append(ok ? c : '_');
            }
            return clean.Length > 0 ? clean.ToString() : Default;
        }

        /// <summary>The per-session mutex guarding the mute-recovery record.</summary>
        public static string OutputMutexName(string sanitized) { return "Local\\DoodleNote-Bark-output-" + sanitized; }

        /// <summary>The mute-recovery record's file name (in the per-user %TEMP%).</summary>
        public static string OutputStateFileName(string sanitized) { return "DoodleNote-Bark-output-" + sanitized + ".json"; }

        /// <summary>The pending clipboard record's file name (in the per-user %TEMP%; DPAPI-encrypted).</summary>
        public static string ClipboardStateFileName(string sanitized) { return "DoodleNote-Bark-clipboard-" + sanitized + ".bin"; }
    }
}
