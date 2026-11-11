using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace DoodleNote.DictationHelper
{
    /// <summary>
    /// NDJSON over stdio between the DoodleNote main process and this helper, the
    /// same contract as the macOS helper (engine/Sources/dictation-helper/Wire.swift).
    ///
    /// Requests:  {"op":"…","id":"…", …}
    /// Replies:   {"event":"reply","id":"…","ok":true|false, …}
    /// Unsolicited events: {"event":"ready","pid":N}, {"event":"hold","phase":"down|up","holdId":N,"reason":"…"},
    ///                     {"event":"tap"}, {"event":"click"}
    ///
    /// Lines are written by one writer thread, so a hook callback never waits on the pipe.
    /// </summary>
    internal static class Wire
    {
        static readonly BlockingCollection<string> outbox = new BlockingCollection<string>();
        static readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 64 * 1024 * 1024 };
        static Thread writer;
        static Stream stdout;

        public static void Start()
        {
            stdout = Console.OpenStandardOutput();
            writer = new Thread(() =>
            {
                foreach (string line in outbox.GetConsumingEnumerable())
                {
                    try
                    {
                        byte[] bytes = new UTF8Encoding(false).GetBytes(line + "\n");
                        stdout.Write(bytes, 0, bytes.Length);
                        stdout.Flush();
                    }
                    catch (IOException) { }
                }
            });
            writer.IsBackground = true;
            writer.Name = "wire-writer";
            writer.Start();
        }

        public static string Serialize(object value) { return json.Serialize(value); }

        /// <summary>Parse one request line; null (never a throw) when it is not a JSON object.</summary>
        public static Dictionary<string, object> Parse(string line)
        {
            // A bad \uXXXX escape throws FormatException; any malformed input must not kill the reader.
            try { return json.DeserializeObject(line) as Dictionary<string, object>; }
            catch (Exception) { return null; }
        }

        public static void Send(Dictionary<string, object> payload) { outbox.Add(Serialize(payload)); }

        public static void Reply(string id, bool ok, Dictionary<string, object> fields)
        {
            Dictionary<string, object> payload = fields != null ? new Dictionary<string, object>(fields) : new Dictionary<string, object>();
            payload["event"] = "reply";
            payload["id"] = id;
            payload["ok"] = ok;
            Send(payload);
        }

        public static void Reply(string id) { Reply(id, true, null); }

        /// <summary>Wait (briefly) for queued lines to leave before the process exits.</summary>
        public static void Drain(int timeoutMs)
        {
            outbox.CompleteAdding();
            if (writer != null) writer.Join(timeoutMs);
        }

        public static void Log(string message)
        {
            try { Console.Error.WriteLine("[dictation-helper] " + message); } catch (IOException) { }
        }

        public static Dictionary<string, object> Fields(params object[] pairs)
        {
            Dictionary<string, object> fields = new Dictionary<string, object>();
            for (int i = 0; i + 1 < pairs.Length; i += 2) fields[(string)pairs[i]] = pairs[i + 1];
            return fields;
        }

        /* ---- reading request fields, tolerant of missing or odd types ---- */

        public static string Str(Dictionary<string, object> request, string key)
        {
            object value;
            return request.TryGetValue(key, out value) ? value as string : null;
        }

        public static bool? Bool(Dictionary<string, object> request, string key)
        {
            object value;
            if (!request.TryGetValue(key, out value) || !(value is bool)) return null;
            return (bool)value;
        }

        public static double? Num(Dictionary<string, object> request, string key)
        {
            object value;
            if (!request.TryGetValue(key, out value) || value == null) return null;
            if (value is int) return (int)value;
            if (value is long) return (long)value;
            if (value is decimal) return (double)(decimal)value;
            if (value is double) return (double)value;
            return null;
        }

        public static List<string> Strings(Dictionary<string, object> request, string key)
        {
            List<string> list = new List<string>();
            object value;
            if (!request.TryGetValue(key, out value)) return list;
            object[] items = value as object[];
            System.Collections.ArrayList array = value as System.Collections.ArrayList;
            System.Collections.IEnumerable source = (System.Collections.IEnumerable)items ?? array;
            if (source == null) return list;
            foreach (object item in source)
            {
                string text = item as string;
                if (text != null) list.Add(text);
            }
            return list;
        }
    }
}
