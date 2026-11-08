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
        public const uint SMTO_ABORTIFHUNG = 0x0002, SMTO_BLOCK = 0x0001;
        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam, uint flags, uint timeoutMs, out IntPtr result);

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
}
