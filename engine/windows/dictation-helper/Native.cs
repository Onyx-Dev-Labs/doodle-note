using System;
using System.Runtime.InteropServices;
using System.Text;

namespace DoodleNote.DictationHelper
{
    /// <summary>Win32 entry points the helper uses. Nothing here keeps state.</summary>
    internal static class Native
    {
        public const int WH_KEYBOARD_LL = 13;
        public const int WH_MOUSE_LL = 14;
        public const int WM_KEYDOWN = 0x0100, WM_KEYUP = 0x0101, WM_SYSKEYDOWN = 0x0104, WM_SYSKEYUP = 0x0105;
        public const int WM_LBUTTONDOWN = 0x0201, WM_RBUTTONDOWN = 0x0204;
        public const int WM_MBUTTONDOWN = 0x0207, WM_MBUTTONUP = 0x0208;
        public const int WM_XBUTTONDOWN = 0x020B, WM_XBUTTONUP = 0x020C;
        public const uint LLKHF_INJECTED = 0x10;
        public const int VK_SHIFT = 0x10, VK_CONTROL = 0x11, VK_MENU = 0x12;
        public const int VK_LWIN = 0x5B, VK_RWIN = 0x5C, VK_RETURN = 0x0D;
        public const int VK_LSHIFT = 0xA0, VK_RSHIFT = 0xA1, VK_LCONTROL = 0xA2, VK_RCONTROL = 0xA3, VK_LMENU = 0xA4, VK_RMENU = 0xA5;
        public const int VK_MBUTTON = 0x04, VK_XBUTTON1 = 0x05, VK_XBUTTON2 = 0x06;
        public const int VK_V = 0x56;
        /// <summary>Unassigned virtual key: pressed while Alt or Win is down so their release is not "alone".</summary>
        public const int VK_MASK = 0xE8;
        public const uint KEYEVENTF_EXTENDEDKEY = 0x1, KEYEVENTF_KEYUP = 0x2, KEYEVENTF_UNICODE = 0x4;
        /// <summary>Marks the helper's own synthetic input so its hooks ignore it.</summary>
        public static readonly IntPtr OwnInputMarker = new IntPtr(0x444E4252); // "DNBR"

        public delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)]
        public struct KBDLLHOOKSTRUCT { public uint vkCode, scanCode, flags, time; public IntPtr dwExtraInfo; }

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT { public int X, Y; }

        [StructLayout(LayoutKind.Sequential)]
        public struct MSLLHOOKSTRUCT { public POINT pt; public uint mouseData, flags, time; public IntPtr dwExtraInfo; }

        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr SetWindowsHookEx(int idHook, HookProc fn, IntPtr hMod, uint threadId);
        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool UnhookWindowsHookEx(IntPtr hook);
        [DllImport("user32.dll")]
        public static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        public static extern IntPtr GetModuleHandle(string name);
        [DllImport("user32.dll")]
        public static extern short GetAsyncKeyState(int vk);

        // SendInput. INPUT is 40 bytes on x64 (type + 8-byte aligned union of 32 bytes).
        [StructLayout(LayoutKind.Sequential)]
        public struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
        [StructLayout(LayoutKind.Sequential)]
        public struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
        [StructLayout(LayoutKind.Explicit)]
        public struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
        [StructLayout(LayoutKind.Sequential)]
        public struct INPUT { public uint type; public InputUnion u; }
        [DllImport("user32.dll", SetLastError = true)]
        public static extern uint SendInput(uint count, INPUT[] inputs, int size);

        public static INPUT Key(int vk, bool up, bool extended)
        {
            INPUT input = new INPUT();
            input.type = 1;
            input.u.ki.wVk = (ushort)vk;
            input.u.ki.dwFlags = (up ? KEYEVENTF_KEYUP : 0) | (extended ? KEYEVENTF_EXTENDEDKEY : 0);
            input.u.ki.dwExtraInfo = OwnInputMarker;
            return input;
        }

        public static INPUT Unicode(char unit, bool up)
        {
            INPUT input = new INPUT();
            input.type = 1;
            input.u.ki.wScan = unit;
            input.u.ki.dwFlags = KEYEVENTF_UNICODE | (up ? KEYEVENTF_KEYUP : 0);
            input.u.ki.dwExtraInfo = OwnInputMarker;
            return input;
        }

        public static uint Send(INPUT[] inputs)
        {
            if (inputs.Length == 0) return 0;
            return SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
        }

        // Windows and processes.
        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
        [StructLayout(LayoutKind.Sequential)]
        public struct RECT { public int Left, Top, Right, Bottom; }
        [StructLayout(LayoutKind.Sequential)]
        public struct GUITHREADINFO
        {
            public int cbSize; public uint flags;
            public IntPtr hwndActive, hwndFocus, hwndCapture, hwndMenuOwner, hwndMoveSize, hwndCaret;
            public RECT rcCaret;
        }
        [DllImport("user32.dll")]
        public static extern bool GetGUIThreadInfo(uint threadId, ref GUITHREADINFO info);
        public delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
        [DllImport("user32.dll")]
        public static extern bool EnumChildWindows(IntPtr parent, EnumProc fn, IntPtr lParam);
        [DllImport("user32.dll")]
        public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern int GetClassName(IntPtr hwnd, StringBuilder name, int max);
        [DllImport("user32.dll")]
        public static extern int GetWindowLong(IntPtr hwnd, int index);
        [DllImport("user32.dll")]
        public static extern bool IsWindow(IntPtr hwnd);

        public const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
        [DllImport("kernel32.dll")]
        public static extern bool CloseHandle(IntPtr handle);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern bool QueryFullProcessImageName(IntPtr process, int flags, StringBuilder name, ref int size);
        [DllImport("advapi32.dll", SetLastError = true)]
        public static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
        [DllImport("advapi32.dll", SetLastError = true)]
        public static extern bool GetTokenInformation(IntPtr token, int infoClass, out int info, int length, out int returned);
        [DllImport("kernel32.dll")]
        public static extern IntPtr GetCurrentProcess();
        [DllImport("kernel32.dll")]
        public static extern IntPtr GetCurrentThread();
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool SetThreadPriority(IntPtr thread, int priority);
        public const int THREAD_PRIORITY_HIGHEST = 2;

        [DllImport("advapi32.dll", SetLastError = true)]
        static extern bool GetTokenInformation(IntPtr token, int infoClass, IntPtr info, int length, out int returned);
        [DllImport("kernel32.dll")]
        public static extern ulong GetTickCount64();
        /// <summary>The system OEM code page (CF_OEMTEXT of our write is in it).</summary>
        [DllImport("kernel32.dll")]
        public static extern uint GetOEMCP();

        /// <summary>When this boot started (UTC, from the tick count). Diagnostics only: it moves with clock corrections.</summary>
        public static DateTime BootTimeUtc { get { return DateTime.UtcNow - TimeSpan.FromMilliseconds(GetTickCount64()); } }

        /// <summary>
        /// Windows' boot counter (HKLM\...\Memory Management\PrefetchParameters\BootId), readable by any user:
        /// a different value is a different boot, with no wall clock involved. Empty when unavailable.
        /// </summary>
        public static string BootId()
        {
            try
            {
                using (Microsoft.Win32.RegistryKey key = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management\PrefetchParameters"))
                {
                    object value = key == null ? null : key.GetValue("BootId");
                    return value is int ? ((int)value).ToString() : "";
                }
            }
            catch (Exception) { return ""; }
        }

        public const string SessionKeyPath = @"Software\DoodleNote.Bark.Session";

        /// <summary>
        /// A random key for this logon, kept in a VOLATILE registry key (HKCU\Software\DoodleNote.Bark.Session, one
        /// value per app identity, "key:tick it was created at"). Volatile means it is removed when the user's hive
        /// is unloaded (logoff, reboot); the LUID covers a new logon while the hive stayed loaded, and the boot
        /// counter a new boot. A key of that name that already exists as a normal (persistent) key (an older build,
        /// a registry import, a profile tool) would survive reboots: it is detected (a non-volatile subkey can be
        /// created under it) and replaced by a volatile one. Created once per logon under a mutex (two helpers
        /// starting together agree on it). Key empty when the registry cannot be used or the key not verified.
        /// </summary>
        public static SessionKeyInfo LogonSessionKey(string identity, string path = SessionKeyPath)
        {
            SessionKeyInfo info = new SessionKeyInfo();
            try
            {
                using (System.Threading.Mutex mutex = new System.Threading.Mutex(false, "Local\\DoodleNote-Bark-session-key-" + identity))
                {
                    bool held = false;
                    try
                    {
                        try { held = mutex.WaitOne(2000); } catch (System.Threading.AbandonedMutexException) { held = true; }
                        if (!held) { info.Note = "the key could not be agreed with another helper"; return info; }
                        if (!EnsureVolatile(path, info)) return info;
                        using (Microsoft.Win32.RegistryKey key = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(path,
                            Microsoft.Win32.RegistryKeyPermissionCheck.ReadWriteSubTree, Microsoft.Win32.RegistryOptions.Volatile))
                        {
                            if (key == null) { info.Note = "the key could not be opened"; return info; }
                            string existing = key.GetValue(identity) as string;
                            if (SessionKeyInfo.TryParse(existing, info)) return info;
                            info.Key = Guid.NewGuid().ToString("N");
                            info.CreatedTick = (long)GetTickCount64();
                            info.CreatedHere = true;
                            key.SetValue(identity, info.Key + ":" + info.CreatedTick, Microsoft.Win32.RegistryValueKind.String);
                            return info;
                        }
                    }
                    finally { if (held) mutex.ReleaseMutex(); }
                }
            }
            catch (Exception error) { info.Key = ""; info.Note = "registry: " + error.GetType().Name; return info; }
        }

        /// <summary>The key at path is volatile (or absent); a persistent one is deleted (and so recreated volatile). False: not verified.</summary>
        static bool EnsureVolatile(string path, SessionKeyInfo info)
        {
            using (Microsoft.Win32.RegistryKey existing = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(path, true))
            {
                if (existing == null) return true;
                string probe = "volatility-probe-" + Guid.NewGuid().ToString("N");
                try
                {
                    // A non-volatile subkey cannot be created under a volatile key (ERROR_CHILD_MUST_BE_VOLATILE).
                    using (Microsoft.Win32.RegistryKey child = existing.CreateSubKey(probe)) { }
                    existing.DeleteSubKey(probe, false);
                }
                catch (System.IO.IOException error)
                {
                    // Only ERROR_CHILD_MUST_BE_VOLATILE (1021) proves the key is volatile; any other failure leaves it unknown.
                    if ((System.Runtime.InteropServices.Marshal.GetHRForException(error) & 0xFFFF) == 1021) return true;
                    info.Note = "the key's volatility could not be checked: " + error.Message;
                    return false;
                }
                catch (Exception error) { info.Note = "the key's volatility could not be checked: " + error.GetType().Name; return false; }
            }
            // A persistent key of our name: its values may predate this boot. Replace it.
            try { Microsoft.Win32.Registry.CurrentUser.DeleteSubKeyTree(path, false); info.ReplacedPersistent = true; return true; }
            catch (Exception error) { info.Note = "a persistent session key could not be replaced: " + error.GetType().Name; return false; }
        }

        /// <summary>This process's logon session (TokenStatistics.AuthenticationId); unique per logon until reboot. Empty when unreadable.</summary>
        public static string LogonId()
        {
            IntPtr token;
            if (!OpenProcessToken(GetCurrentProcess(), 0x0008, out token)) return "";
            IntPtr buffer = Marshal.AllocHGlobal(256);
            try
            {
                int returned;
                if (!GetTokenInformation(token, 10, buffer, 256, out returned) || returned < 16) return ""; // TokenStatistics
                return Marshal.ReadInt64(buffer, 8).ToString("x"); // AuthenticationId (after TokenId)
            }
            finally { Marshal.FreeHGlobal(buffer); CloseHandle(token); }
        }
        [DllImport("advapi32.dll")]
        static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);
        [DllImport("advapi32.dll")]
        static extern IntPtr GetSidSubAuthority(IntPtr sid, uint index);
        [DllImport("user32.dll")]
        public static extern bool GetCursorPos(out POINT point);
        [DllImport("user32.dll")]
        public static extern IntPtr GetClipboardOwner();
        [DllImport("user32.dll")]
        public static extern IntPtr GetParent(IntPtr hwnd);
        public const uint WM_GETTEXTLENGTH = 0x000E;
        public const uint EM_GETSEL = 0x00B0;
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern uint RealGetWindowClass(IntPtr hwnd, StringBuilder name, uint max);
        [StructLayout(LayoutKind.Sequential)]
        public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
        [DllImport("user32.dll")]
        public static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
        /// <summary>The tick of the last real (hardware or SendInput) input; SetCursorPos does not move it. 0 when unavailable.</summary>
        public static uint LastInputTick()
        {
            LASTINPUTINFO info = new LASTINPUTINFO();
            info.cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO));
            return GetLastInputInfo(ref info) ? info.dwTime : 0;
        }
        /// <summary>GetAsyncKeyState: down now, and whether it was pressed since the previous query (the low bit).</summary>
        public static void KeyState(int vk, out bool down, out bool pressedSince)
        {
            short state = GetAsyncKeyState(vk);
            down = (state & 0x8000) != 0;
            pressedSince = (state & 1) != 0;
        }
        public const uint SMTO_ABORTIFHUNG = 0x0002, SMTO_BLOCK = 0x0001;
        // The Unicode entry point: the A version translates text messages through the ANSI code page
        // (WM_GETTEXTLENGTH would count bytes, not UTF-16 units) and returns EM_GETSEL truncated.
        [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam, uint flags, uint timeoutMs, out IntPtr result);
        /// <summary>WM_GETTEXT into a buffer (the system marshals the text across processes).</summary>
        [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint msg, IntPtr wParam, StringBuilder lParam, uint flags, uint timeoutMs, out IntPtr result);
        public const uint WM_NULL = 0x0000;
        [DllImport("user32.dll")]
        public static extern bool IsHungAppWindow(IntPtr hwnd);
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern IntPtr GetStdHandle(int which);
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
        public const uint HANDLE_FLAG_INHERIT = 0x1;
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool GetHandleInformation(IntPtr handle, out uint flags);
        [DllImport("user32.dll", SetLastError = true)]
        public static extern UIntPtr SetCoalescableTimer(IntPtr hwnd, UIntPtr id, uint elapseMs, IntPtr timerProc, uint toleranceMs);
        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool KillTimer(IntPtr hwnd, UIntPtr id);

        // Clipboard.
        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool OpenClipboard(IntPtr owner);
        [DllImport("user32.dll")]
        public static extern bool CloseClipboard();
        [DllImport("user32.dll")]
        public static extern bool EmptyClipboard();
        [DllImport("user32.dll")]
        public static extern uint EnumClipboardFormats(uint format);
        [DllImport("user32.dll")]
        public static extern IntPtr GetClipboardData(uint format);
        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr SetClipboardData(uint format, IntPtr data);
        [DllImport("user32.dll")]
        public static extern bool IsClipboardFormatAvailable(uint format);
        [DllImport("user32.dll")]
        public static extern uint GetClipboardSequenceNumber();
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern uint RegisterClipboardFormat(string name);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern int GetClipboardFormatName(uint format, StringBuilder name, int max);
        [DllImport("kernel32.dll")]
        public static extern IntPtr GlobalAlloc(uint flags, UIntPtr bytes);
        [DllImport("kernel32.dll")]
        public static extern IntPtr GlobalLock(IntPtr mem);
        [DllImport("kernel32.dll")]
        public static extern bool GlobalUnlock(IntPtr mem);
        [DllImport("kernel32.dll")]
        public static extern UIntPtr GlobalSize(IntPtr mem);
        [DllImport("kernel32.dll")]
        public static extern IntPtr GlobalFree(IntPtr mem);
        [DllImport("gdi32.dll")]
        public static extern IntPtr CopyEnhMetaFile(IntPtr source, IntPtr fileName);
        [DllImport("gdi32.dll")]
        public static extern uint GetEnhMetaFileBits(IntPtr hemf, uint size, byte[] buffer);
        [DllImport("gdi32.dll")]
        public static extern IntPtr SetEnhMetaFileBits(uint size, byte[] bits);
        [DllImport("gdi32.dll")]
        public static extern bool DeleteEnhMetaFile(IntPtr hemf);
        public const uint GMEM_MOVEABLE = 0x0002;

        // Icons.
        [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
        public static extern int SHDefExtractIcon(string iconFile, int index, uint flags, out IntPtr large, out IntPtr small, uint size);
        [DllImport("user32.dll")]
        public static extern bool DestroyIcon(IntPtr icon);

        [DllImport("kernel32.dll")]
        public static extern bool SetConsoleCtrlHandler(ConsoleCtrl handler, bool add);
        public delegate bool ConsoleCtrl(int type);

        public static bool IsDown(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }

        public static uint WindowPid(IntPtr hwnd)
        {
            uint pid;
            GetWindowThreadProcessId(hwnd, out pid);
            return pid;
        }

        public static string ClassOf(IntPtr hwnd)
        {
            StringBuilder name = new StringBuilder(256);
            GetClassName(hwnd, name, name.Capacity);
            return name.ToString();
        }

        /// <summary>The full path of a process's image, or "" when Windows will not say.</summary>
        public static string ProcessPath(uint pid)
        {
            IntPtr process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (process == IntPtr.Zero) return "";
            try
            {
                StringBuilder name = new StringBuilder(1024);
                int size = name.Capacity;
                return QueryFullProcessImageName(process, 0, name, ref size) ? name.ToString(0, size) : "";
            }
            finally { CloseHandle(process); }
        }

        /// <summary>
        /// Whether the process runs at a higher mandatory integrity level than this helper. Windows
        /// drops synthetic input sent to such a window (UIPI) and a low-level hook stops seeing input
        /// destined for it, so typing into it cannot work and its foreground time is not hook loss.
        /// Compares integrity levels (TokenIntegrityLevel RIDs), not elevation. A token that cannot be
        /// opened for query (access denied) is treated as above us; a process that cannot be opened at
        /// all is not (nothing is known about it).
        /// </summary>
        public static bool RunsAboveUs(uint pid)
        {
            int ours = IntegrityOf(GetCurrentProcess());
            if (ours < 0) return false;
            IntPtr process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (process == IntPtr.Zero) return false;
            try
            {
                IntPtr token;
                if (!OpenProcessToken(process, 0x0008, out token)) return Marshal.GetLastWin32Error() == 5;
                try
                {
                    int theirs = IntegrityRid(token);
                    if (theirs < 0) return Marshal.GetLastWin32Error() == 5;
                    return theirs > ours;
                }
                finally { CloseHandle(token); }
            }
            finally { CloseHandle(process); }
        }

        static int ownIntegrity = -2;

        /// <summary>The process's mandatory integrity RID (0x1000 low, 0x2000 medium, 0x3000 high, 0x4000 system), or -1.</summary>
        static int IntegrityOf(IntPtr process)
        {
            if (process == GetCurrentProcess() && ownIntegrity != -2) return ownIntegrity;
            IntPtr token;
            int rid = -1;
            if (OpenProcessToken(process, 0x0008, out token))
            {
                try { rid = IntegrityRid(token); }
                finally { CloseHandle(token); }
            }
            if (process == GetCurrentProcess()) ownIntegrity = rid;
            return rid;
        }

        /// <summary>TokenIntegrityLevel (25) -> TOKEN_MANDATORY_LABEL -> the label SID's last sub-authority.</summary>
        public static int IntegrityRid(IntPtr token)
        {
            int needed;
            GetTokenInformation(token, 25, IntPtr.Zero, 0, out needed);
            if (needed <= 0 || needed > 4096) return -1;
            IntPtr buffer = Marshal.AllocHGlobal(needed);
            try
            {
                if (!GetTokenInformation(token, 25, buffer, needed, out needed)) return -1;
                IntPtr sid = Marshal.ReadIntPtr(buffer); // TOKEN_MANDATORY_LABEL.Label.Sid
                if (sid == IntPtr.Zero) return -1;
                int count = Marshal.ReadByte(GetSidSubAuthorityCount(sid));
                if (count < 1) return -1;
                return Marshal.ReadInt32(GetSidSubAuthority(sid, (uint)(count - 1)));
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }
    }

    /// <summary>This logon's key (see Native.LogonSessionKey).</summary>
    internal sealed class SessionKeyInfo
    {
        public string Key = "";
        /// <summary>The tick count (since this boot) when the key was created.</summary>
        public long CreatedTick;
        /// <summary>This helper created it (it was absent, or replaced).</summary>
        public bool CreatedHere;
        /// <summary>A persistent key of our name was found and replaced by a volatile one.</summary>
        public bool ReplacedPersistent;
        public string Note = "";

        public static bool TryParse(string value, SessionKeyInfo info)
        {
            if (value == null) return false;
            int colon = value.IndexOf(':');
            if (colon != 32) return false;
            long tick;
            if (!long.TryParse(value.Substring(33), out tick)) return false;
            info.Key = value.Substring(0, 32);
            info.CreatedTick = tick;
            return true;
        }
    }
}
