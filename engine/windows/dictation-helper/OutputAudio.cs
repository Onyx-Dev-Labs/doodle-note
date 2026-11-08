using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;

namespace DoodleNote.DictationHelper
{
    /* ---- Core Audio (MMDevice API) interop: only the calls used here ---- */

    internal enum EDataFlow { Render = 0, Capture = 1 }
    internal enum ERole { Console = 0, Multimedia = 1, Communications = 2 }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    internal class MMDeviceEnumeratorComObject { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(EDataFlow flow, int stateMask, out IMMDeviceCollection devices);
        [PreserveSig] int GetDefaultAudioEndpoint(EDataFlow flow, ERole role, out IMMDevice device);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
        [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr client);
        [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr client);
    }

    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDeviceCollection
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int Item(int index, out IMMDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int context, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
        [PreserveSig] int OpenPropertyStore(int access, out IPropertyStore store);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetState(out int state);
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct PropertyKey { public Guid Format; public int Id; }

    [StructLayout(LayoutKind.Explicit, Size = 24)]
    internal struct PropVariant { [FieldOffset(0)] public ushort Type; [FieldOffset(8)] public IntPtr Pointer; }

    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IPropertyStore
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int GetAt(int index, out PropertyKey key);
        [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
        [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
        [PreserveSig] int Commit();
    }

    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioEndpointVolume
    {
        [PreserveSig] int RegisterControlChangeNotify(IntPtr notify);
        [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify);
        [PreserveSig] int GetChannelCount(out uint count);
        [PreserveSig] int SetMasterVolumeLevel(float level, ref Guid context);
        [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid context);
        [PreserveSig] int GetMasterVolumeLevel(out float level);
        [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
        [PreserveSig] int SetChannelVolumeLevel(uint channel, float level, ref Guid context);
        [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid context);
        [PreserveSig] int GetChannelVolumeLevel(uint channel, out float level);
        [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }

    internal static class CoreAudio
    {
        const int DEVICE_STATE_ACTIVE = 1;
        static readonly Guid VolumeIid = typeof(IAudioEndpointVolume).GUID;
        static PropertyKey FriendlyName = new PropertyKey { Format = new Guid("A45C254E-DF1C-4EFD-8020-67D146A850E0"), Id = 14 };

        [DllImport("ole32.dll")]
        static extern int PropVariantClear(ref PropVariant value);

        static IMMDeviceEnumerator Enumerator() { return (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject(); }

        public static IMMDevice Default(EDataFlow flow, ERole role)
        {
            IMMDevice device;
            return Enumerator().GetDefaultAudioEndpoint(flow, role, out device) == 0 ? device : null;
        }

        public static IMMDevice ById(string id)
        {
            IMMDevice device;
            if (string.IsNullOrEmpty(id) || Enumerator().GetDevice(id, out device) != 0 || device == null) return null;
            int state;
            return device.GetState(out state) == 0 && state == DEVICE_STATE_ACTIVE ? device : null;
        }

        public static string Id(IMMDevice device)
        {
            string id;
            return device != null && device.GetId(out id) == 0 ? id : null;
        }

        public static string Name(IMMDevice device)
        {
            IPropertyStore store;
            if (device.OpenPropertyStore(0, out store) != 0 || store == null) return null;
            PropVariant value;
            if (store.GetValue(ref FriendlyName, out value) != 0) return null;
            try { return value.Type == 31 ? Marshal.PtrToStringUni(value.Pointer) : null; }
            finally { PropVariantClear(ref value); }
        }

        /// <summary>
        /// The active capture endpoint whose friendly name matches. Chromium appends a
        /// "(vid:pid)" suffix the Windows name lacks, so an exact match is tried first, then a
        /// normalized match, then a prefix match. Null when none matches (never a wrong device).
        /// </summary>
        public static IMMDevice CaptureByName(string name)
        {
            IMMDeviceCollection devices;
            if (Enumerator().EnumAudioEndpoints(EDataFlow.Capture, DEVICE_STATE_ACTIVE, out devices) != 0) return null;
            int count;
            devices.GetCount(out count);
            string wanted = Normalize(name);
            IMMDevice exact = null, normalized = null;
            int normalizedMatches = 0;
            for (int i = 0; i < count; i++)
            {
                IMMDevice device;
                if (devices.Item(i, out device) != 0) continue;
                string deviceName = Name(device) ?? "";
                if (string.Equals(deviceName, name, StringComparison.OrdinalIgnoreCase)) { exact = device; break; }
                if (Normalize(deviceName) == wanted) { normalized = device; normalizedMatches++; }
            }
            // An exact name wins; otherwise accept a normalized match only when it is unambiguous.
            // Two devices that differ only by a "(USB A)"/"(USB B)" tail must not be guessed.
            if (exact != null) return exact;
            return normalizedMatches == 1 ? normalized : null;
        }

        /// <summary>
        /// Lower case, trimmed, with only a trailing Chromium "(xxxx:xxxx)" hardware id removed.
        /// Device-name parentheses like "Microphone (USB A)" are kept, so two such devices stay distinct.
        /// </summary>
        internal static string Normalize(string name)
        {
            if (string.IsNullOrEmpty(name)) return "";
            string value = name.Trim();
            value = System.Text.RegularExpressions.Regex.Replace(value, @"\s*\([0-9a-fA-F]{4}:[0-9a-fA-F]{4}\)\s*$", "");
            return value.Trim().ToLowerInvariant();
        }

        public static IAudioEndpointVolume Volume(IMMDevice device)
        {
            if (device == null) return null;
            object instance;
            Guid iid = VolumeIid;
            return device.Activate(ref iid, 23 /* CLSCTX_ALL */, IntPtr.Zero, out instance) == 0 ? instance as IAudioEndpointVolume : null;
        }
    }

    /// <summary>What the muter needs from an output device, so its logic is tested without touching the real volume.</summary>
    internal interface IOutputDeviceControl
    {
        /// <summary>The device sound is going to right now; null when there is none.</summary>
        string DefaultDevice();
        bool Exists(string device);
        /// <summary>The mute switch, when the device has one that can be set.</summary>
        bool? MuteSwitch(string device);
        bool SetMuteSwitch(string device, bool muted);
        /// <summary>The master volume 0..1, when it can be read.</summary>
        float? Volume(string device);
        bool SetVolume(string device, float value);
    }

    /// <summary>
    /// Silences whatever is playing while the user dictates, then puts it back. Port of
    /// OutputMuter in OutputAudio.swift: it remembers exactly what it changed and restores
    /// only if the device is still the way it left it, so a mute or volume the user set in
    /// the meantime is never overwritten, and a device that was already silent is left alone.
    /// </summary>
    internal sealed class OutputMuter
    {
        readonly IOutputDeviceControl control;
        readonly object gate = new object();
        string heldDevice;
        /// <summary>null = the mute switch; otherwise the volume it had before.</summary>
        float? heldVolume;
        bool holding;

        public OutputMuter(IOutputDeviceControl control) { this.control = control; }

        public bool IsHolding { get { lock (gate) return holding; } }
        public string HeldDevice { get { lock (gate) return heldDevice; } }
        public float? HeldVolume { get { lock (gate) return heldVolume; } }

        /// <summary>muted | already-held | already-silent | unsupported | no-device</summary>
        public string Mute()
        {
            lock (gate)
            {
                if (holding) return "already-held";
                string device = control.DefaultDevice();
                if (device == null) return "no-device";
                bool? muted = control.MuteSwitch(device);
                if (muted.HasValue)
                {
                    if (muted.Value) return "already-silent";
                    if (!control.SetMuteSwitch(device, true)) return "unsupported";
                    Hold(device, null);
                    return "muted";
                }
                float? volume = control.Volume(device);
                if (!volume.HasValue) return "unsupported";
                if (volume.Value <= 0) return "already-silent";
                if (!control.SetVolume(device, 0)) return "unsupported";
                Hold(device, volume);
                return "muted";
            }
        }

        void Hold(string device, float? volume)
        {
            holding = true;
            heldDevice = device;
            heldVolume = volume;
        }

        /// <summary>Put back a silence a previous helper left behind (it was ended before it could).</summary>
        public void Adopt(string device, float? volume)
        {
            lock (gate) { if (!holding) Hold(device, volume); }
        }

        /// <summary>restored | nothing | user-changed | gone</summary>
        public string Restore()
        {
            lock (gate)
            {
                if (!holding) return "nothing";
                string device = heldDevice;
                float? previous = heldVolume;
                holding = false;
                heldDevice = null;
                heldVolume = null;
                if (!control.Exists(device)) return "gone";
                if (!previous.HasValue)
                {
                    // Still the mute this code set? Then give it back; otherwise the user took over.
                    if (control.MuteSwitch(device) != true) return "user-changed";
                    return control.SetMuteSwitch(device, false) ? "restored" : "user-changed";
                }
                float? now = control.Volume(device);
                if (!now.HasValue || now.Value > 0) return "user-changed";
                return control.SetVolume(device, previous.Value) ? "restored" : "user-changed";
            }
        }
    }

    /// <summary>The real default output device.</summary>
    internal sealed class SystemOutputControl : IOutputDeviceControl
    {
        static Guid context = Guid.Empty;

        public string DefaultDevice() { return CoreAudio.Id(CoreAudio.Default(EDataFlow.Render, ERole.Multimedia)); }
        public bool Exists(string device) { return CoreAudio.ById(device) != null; }

        public bool? MuteSwitch(string device)
        {
            IAudioEndpointVolume volume = CoreAudio.Volume(CoreAudio.ById(device));
            bool muted;
            if (volume == null || volume.GetMute(out muted) != 0) return null;
            return muted;
        }

        public bool SetMuteSwitch(string device, bool muted)
        {
            IAudioEndpointVolume volume = CoreAudio.Volume(CoreAudio.ById(device));
            return volume != null && volume.SetMute(muted, ref context) == 0;
        }

        public float? Volume(string device)
        {
            IAudioEndpointVolume volume = CoreAudio.Volume(CoreAudio.ById(device));
            float level;
            if (volume == null || volume.GetMasterVolumeLevelScalar(out level) != 0) return null;
            return level;
        }

        public bool SetVolume(string device, float value)
        {
            IAudioEndpointVolume volume = CoreAudio.Volume(CoreAudio.ById(device));
            return volume != null && volume.SetMasterVolumeLevelScalar(value, ref context) == 0;
        }
    }

    internal static class OutputAudio
    {
        public static readonly OutputMuter Shared = new OutputMuter(new SystemOutputControl());
        /// <summary>If the app never asks for the sound back (it hung, or was killed), give it back anyway.</summary>
        public const int WatchdogSeconds = 15 * 60;
        static System.Threading.Timer watchdog;
        /// <summary>A token unique to this helper instance, so one instance never clears another's record.</summary>
        static readonly string Owner = Process.GetCurrentProcess().Id + ":" + Guid.NewGuid().ToString("N");
        /// <summary>Owner of a record this instance has adopted (so it may clear it on restore).</summary>
        static string adoptedOwner;

        /// <summary>
        /// Serialize read/modify/write of the record across helper instances of the SAME app identity in
        /// this session (the mutex and the file are named after HelperIdentity, so a QA identity beside
        /// production shares neither).
        /// The record file lives in the per-user %TEMP%, so a per-session (Local\) mutex is the right
        /// scope and avoids the access-denied a Global\ mutex causes for a second signed-in user.
        /// If the lock cannot be created or acquired the protected operation is SKIPPED (never run
        /// unlocked) and the fallback returned, so two instances can never race the record.
        /// </summary>
        static T WithStateLock<T>(Func<T> body, T fallback)
        {
            System.Threading.Mutex mutex;
            try { mutex = new System.Threading.Mutex(false, HelperIdentity.OutputMutexName(HelperIdentity.Sanitized)); }
            catch (Exception) { return fallback; }
            using (mutex)
            {
                bool held = false;
                try { held = mutex.WaitOne(2000); }
                catch (System.Threading.AbandonedMutexException) { held = true; }
                catch (Exception) { return fallback; }
                if (!held) return fallback;
                try { return body(); }
                finally { try { mutex.ReleaseMutex(); } catch (Exception) { } }
            }
        }

        static void WithStateLock(Action body) { WithStateLock<object>(() => { body(); return null; }, null); }

        /// <summary>
        /// Test-only probe (gated by the op): returns true only if the protected body actually ran
        /// under the lock, false if the lock could not be taken within the timeout. Proves the body
        /// is SKIPPED on a WaitOne timeout rather than run unlocked.
        /// </summary>
#if DICTATION_TEST
        public static bool ProbeStateLock() { return WithStateLock<bool>(() => true, false); }
#endif

        /// <summary>
        /// Windows can end the helper without warning (the app is killed), so a silence in
        /// force is written down and the next helper gives it back. Device id and volume only.
        /// </summary>
        static string StatePath
        {
            // Named after the app identity, so a QA build beside production keeps its own record.
            get { return Path.Combine(Path.GetTempPath(), HelperIdentity.OutputStateFileName(HelperIdentity.Sanitized)); }
        }

        public static string Mute()
        {
            string outcome = Shared.Mute();
            if (outcome == "muted")
            {
                WriteState();
                if (watchdog != null) watchdog.Dispose();
                watchdog = new System.Threading.Timer(delegate { Restore(); }, null, WatchdogSeconds * 1000, System.Threading.Timeout.Infinite);
            }
            return outcome;
        }

        public static string Restore()
        {
            if (watchdog != null) watchdog.Dispose();
            watchdog = null;
            string outcome = Shared.Restore();
            ClearState();
            return outcome;
        }

        static void WriteState()
        {
            WithStateLock(() =>
            {
                try
                {
                    Dictionary<string, object> state = Wire.Fields("pid", Process.GetCurrentProcess().Id, "owner", Owner, "device", Shared.HeldDevice);
                    if (Shared.HeldVolume.HasValue) state["volume"] = (double)Shared.HeldVolume.Value;
                    File.WriteAllText(StatePath, Wire.Serialize(state));
                }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
            });
        }

        /// <summary>Delete the record only if this instance owns it (wrote or adopted it).</summary>
        static void ClearState()
        {
            WithStateLock(() =>
            {
                try
                {
                    if (!File.Exists(StatePath)) return;
                    Dictionary<string, object> state = Wire.Parse(File.ReadAllText(StatePath));
                    string recordOwner = state != null ? Wire.Str(state, "owner") : null;
                    if (recordOwner == null || recordOwner == Owner || recordOwner == adoptedOwner) File.Delete(StatePath);
                }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
            });
        }

        /// <summary>At start: a silence left by a helper that no longer runs is given back.</summary>
        public static void RecoverLeftover()
        {
            string device = null;
            double? volume = null;
            string owner = null;
            bool adopt = WithStateLock(() =>
            {
                Dictionary<string, object> state;
                try
                {
                    if (!File.Exists(StatePath)) return false;
                    state = Wire.Parse(File.ReadAllText(StatePath));
                }
                catch (IOException) { return false; }
                catch (UnauthorizedAccessException) { return false; }
                if (state == null) return false;
                double? pid = Wire.Num(state, "pid");
                owner = Wire.Str(state, "owner");
                // A record owned by another helper that is still running belongs to it: leave it alone.
                if (pid.HasValue && pid.Value != Process.GetCurrentProcess().Id && owner != Owner)
                {
                    try
                    {
                        using (Process other = Process.GetProcessById((int)pid.Value))
                        {
                            if (!other.HasExited && other.ProcessName.IndexOf("dictation-helper", StringComparison.OrdinalIgnoreCase) >= 0) return false;
                        }
                    }
                    catch (ArgumentException) { }
                    catch (InvalidOperationException) { }
                    catch (System.ComponentModel.Win32Exception) { }
                }
                device = Wire.Str(state, "device");
                volume = Wire.Num(state, "volume");
                adoptedOwner = owner; // we own it now, so ClearState below may delete it
                return true;
            }, false);
            if (!adopt) return;
            if (device != null)
            {
                Shared.Adopt(device, volume.HasValue ? (float?)(float)volume.Value : null);
                Wire.Log("giving back output audio left silenced by an earlier helper: " + Shared.Restore());
            }
            ClearState();
        }
    }

    /// <summary>Read-only look at a microphone: muted, or turned all the way down?</summary>
    internal static class Microphone
    {
        /// <summary>
        /// null or "default": the default input; "communications": the communications input;
        /// "name:Label": the input Chromium lists under that label; otherwise an endpoint id.
        /// An input that is gone falls back to the default, as the engine does.
        /// </summary>
        public static IMMDevice Device(string uid)
        {
            if (uid == "communications") return CoreAudio.Default(EDataFlow.Capture, ERole.Communications);
            // A named microphone that is not found returns null, not the default: input-state then
            // reports "unknown" rather than the mute/volume of the wrong device.
            if (uid != null && uid.StartsWith("name:")) return CoreAudio.CaptureByName(uid.Substring(5));
            if (!string.IsNullOrEmpty(uid) && uid != "default")
                return CoreAudio.ById(uid) ?? CoreAudio.Default(EDataFlow.Capture, ERole.Console);
            return CoreAudio.Default(EDataFlow.Capture, ERole.Console);
        }

        public static Dictionary<string, object> State(IMMDevice device)
        {
            Dictionary<string, object> fields = new Dictionary<string, object>();
            IAudioEndpointVolume volume = CoreAudio.Volume(device);
            if (volume == null) return fields;
            bool muted;
            if (volume.GetMute(out muted) == 0) fields["muted"] = muted;
            float level;
            if (volume.GetMasterVolumeLevelScalar(out level) == 0) fields["volume"] = (double)level;
            return fields;
        }
    }
}
