using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace DoodleNote.DictationHelper
{
    /// <summary>
    /// How Windows apps are named. The executable's file name, in lower case
    /// ("slack.exe"), plays the part of a macOS bundle identifier; the display name
    /// is the one the program's own version resource gives ("Slack"). Window titles
    /// are never read, since they can carry document names and message subjects.
    /// </summary>
    internal static class AppNames
    {
        public static string ExeName(string path)
        {
            if (string.IsNullOrEmpty(path)) return "";
            try { return Path.GetFileName(path).ToLowerInvariant(); }
            catch (ArgumentException) { return ""; }
        }

        public static string DisplayName(string path, uint pid)
        {
            string name = "";
            if (!string.IsNullOrEmpty(path))
            {
                try
                {
                    FileVersionInfo info = FileVersionInfo.GetVersionInfo(path);
                    name = Clean(info.FileDescription);
                    if (name == "" || name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) name = Clean(info.ProductName);
                }
                catch (FileNotFoundException) { }
                catch (UnauthorizedAccessException) { }
                catch (IOException) { }
            }
            if (name == "" && !string.IsNullOrEmpty(path)) name = Path.GetFileNameWithoutExtension(path);
            if (name == "" && pid != 0)
            {
                try { using (Process process = Process.GetProcessById((int)pid)) name = process.ProcessName; }
                catch (ArgumentException) { }
                catch (InvalidOperationException) { }
            }
            return name;
        }

        static string Clean(string value) { return (value ?? "").Trim(); }
    }

    /// <summary>App icons and names for the pill and the settings page. Only the program file's own icon is read.</summary>
    internal static class AppInfo
    {
        public const int MaxBatch = 40;

        public static bool LooksLikeApp(string path)
        {
            return !string.IsNullOrEmpty(path) && path.Length <= 1024 && Path.IsPathRooted(path)
                && path.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) && File.Exists(path);
        }

        /// <summary>The icon of the program at path as a square PNG, or null.</summary>
        public static byte[] Png(string path, int pixels)
        {
            if (!LooksLikeApp(path)) return null;
            Icon icon = null;
            IntPtr large = IntPtr.Zero, small = IntPtr.Zero;
            try
            {
                if (Native.SHDefExtractIcon(path, 0, 0, out large, out small, (uint)(pixels | (16 << 16))) == 0 && large != IntPtr.Zero)
                    icon = Icon.FromHandle(large);
                if (icon == null) icon = Icon.ExtractAssociatedIcon(path);
                if (icon == null) return null;
                using (Bitmap bitmap = new Bitmap(pixels, pixels, PixelFormat.Format32bppArgb))
                {
                    using (Graphics g = Graphics.FromImage(bitmap))
                    {
                        g.Clear(Color.Transparent);
                        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                        using (Bitmap source = icon.ToBitmap()) g.DrawImage(source, 0, 0, pixels, pixels);
                    }
                    using (MemoryStream stream = new MemoryStream())
                    {
                        bitmap.Save(stream, ImageFormat.Png);
                        return stream.ToArray();
                    }
                }
            }
            catch (ArgumentException) { return null; }
            catch (ExternalException) { return null; }
            finally
            {
                if (large != IntPtr.Zero) Native.DestroyIcon(large);
                if (small != IntPtr.Zero) Native.DestroyIcon(small);
            }
        }

        /// <summary>bundleId always; name and png only when the program is found on this PC.</summary>
        public static Dictionary<string, object> Lookup(string bundleId, Dictionary<string, string> known)
        {
            Dictionary<string, object> output = Wire.Fields("bundleId", bundleId);
            if (string.IsNullOrEmpty(bundleId) || bundleId.Length > 200 || !bundleId.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) return output;
            string path;
            if (!known.TryGetValue(bundleId.ToLowerInvariant(), out path) || !LooksLikeApp(path)) return output;
            string name = AppNames.DisplayName(path, 0);
            if (name != "") output["name"] = name;
            byte[] png = Png(path, 64);
            if (png != null) output["png"] = Convert.ToBase64String(png);
            return output;
        }

        /// <summary>
        /// Where installed programs live, by executable name: running processes first, then
        /// the App Paths registry, then the targets of Start menu shortcuts.
        /// </summary>
        public static Dictionary<string, string> InstalledPrograms(ICollection<string> wanted)
        {
            Dictionary<string, string> found = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            HashSet<string> want = new HashSet<string>(wanted, StringComparer.OrdinalIgnoreCase);
            Func<bool> done = () => want.Count == 0;
            Action<string> add = path =>
            {
                string exe = AppNames.ExeName(path);
                if (exe != "" && want.Contains(exe) && !found.ContainsKey(exe) && File.Exists(path))
                {
                    found[exe] = path;
                    want.Remove(exe);
                }
            };
            foreach (Process process in Process.GetProcesses())
            {
                try
                {
                    if (!done() && want.Contains(process.ProcessName + ".exe")) add(Native.ProcessPath((uint)process.Id));
                }
                catch (InvalidOperationException) { }
                finally { process.Dispose(); }
            }
            foreach (RegistryKey root in new[] { Registry.CurrentUser, Registry.LocalMachine })
            {
                foreach (string exe in new List<string>(want))
                {
                    try
                    {
                        using (RegistryKey key = root.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\App Paths\" + exe))
                        {
                            string value = key != null ? key.GetValue("") as string : null;
                            if (value != null) add(Environment.ExpandEnvironmentVariables(value.Trim('"')));
                        }
                    }
                    catch (System.Security.SecurityException) { }
                    catch (UnauthorizedAccessException) { }
                }
            }
            if (!done()) ScanShortcuts(add, done);
            return found;
        }

        static void ScanShortcuts(Action<string> add, Func<bool> done)
        {
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null) return;
            object shell = null;
            try
            {
                shell = Activator.CreateInstance(shellType);
                string[] roots =
                {
                    Environment.GetFolderPath(Environment.SpecialFolder.StartMenu),
                    Environment.GetFolderPath(Environment.SpecialFolder.CommonStartMenu),
                    Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory)
                };
                int seen = 0;
                foreach (string root in roots)
                {
                    if (string.IsNullOrEmpty(root) || !Directory.Exists(root)) continue;
                    IEnumerable<string> links;
                    try { links = Directory.EnumerateFiles(root, "*.lnk", SearchOption.AllDirectories); }
                    catch (UnauthorizedAccessException) { continue; }
                    foreach (string link in links)
                    {
                        if (done() || ++seen > 600) return;
                        try
                        {
                            object shortcut = shellType.InvokeMember("CreateShortcut", System.Reflection.BindingFlags.InvokeMethod, null, shell, new object[] { link });
                            string target = shortcut.GetType().InvokeMember("TargetPath", System.Reflection.BindingFlags.GetProperty, null, shortcut, null) as string;
                            System.Runtime.InteropServices.Marshal.ReleaseComObject(shortcut);
                            if (!string.IsNullOrEmpty(target)) add(target);
                        }
                        catch (Exception) { }
                    }
                }
            }
            catch (Exception) { }
            finally
            {
                if (shell != null) System.Runtime.InteropServices.Marshal.ReleaseComObject(shell);
            }
        }
    }
}
