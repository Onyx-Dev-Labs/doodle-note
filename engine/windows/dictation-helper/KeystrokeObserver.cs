using System;
using System.Diagnostics;
using System.Threading;
using System.Windows.Automation;

namespace DoodleNote.DictationHelper
{
    /// <summary>
    /// Proof that the target processed a typed key before the next guard runs. Two kinds:
    ///  - Win32 edit controls (Edit, RichEdit, WinForms/Notepad edits): WM_GETTEXTLENGTH sent with
    ///    SendMessageTimeout is answered by the control's own UI thread, so a changed length means that
    ///    thread has handled the key (and anything the key triggered, such as ES_PASSWORD being set).
    ///  - Everything else: UI Automation TextChanged / Value property events raised by the target's
    ///    provider for that element (and IsPassword property changes, which stop typing at once).
    /// For() returns null when neither is available, and typing is then refused up front.
    /// </summary>
    internal abstract class KeystrokeObserver : IDisposable
    {
        /// <summary>A baseline taken immediately before sending a key.</summary>
        public abstract long Mark();

        /// <summary>
        /// True once the key sent after Mark() shows as processed within timeoutMs of wall clock.
        /// secureNow: the control became a password control meanwhile (stop typing).
        /// </summary>
        public abstract bool WaitProcessed(long mark, int timeoutMs, out bool secureNow);

        public virtual void Dispose() { }

        public static KeystrokeObserver For(TargetSnapshot snapshot, IntPtr focusWindow)
        {
            if (Win32EditObserver.Supports(focusWindow)) return new Win32EditObserver(focusWindow);
            if (snapshot.Element != null) return UiaEventObserver.TryCreate(snapshot.Element);
            return null;
        }

        protected static double Since(long start) { return (Stopwatch.GetTimestamp() - start) * 1000.0 / Stopwatch.Frequency; }
    }

    internal sealed class Win32EditObserver : KeystrokeObserver
    {
        readonly IntPtr window;

        public Win32EditObserver(IntPtr window) { this.window = window; }

        public static bool Supports(IntPtr window)
        {
            if (window == IntPtr.Zero) return false;
            string name = Native.ClassOf(window);
            return name.IndexOf("EDIT", StringComparison.OrdinalIgnoreCase) >= 0 // Edit, WindowsForms10.EDIT.*, RichEdit*
                && Length(window) >= 0;
        }

        /// <summary>The control's text length, answered by its UI thread; -1 when it does not answer in 100 ms.</summary>
        static long Length(IntPtr window)
        {
            IntPtr result;
            IntPtr ok = Native.SendMessageTimeout(window, Native.WM_GETTEXTLENGTH, IntPtr.Zero, IntPtr.Zero, Native.SMTO_ABORTIFHUNG | Native.SMTO_BLOCK, 100, out result);
            return ok == IntPtr.Zero ? -1 : result.ToInt64();
        }

        public override long Mark() { return Length(window); }

        public override bool WaitProcessed(long mark, int timeoutMs, out bool secureNow)
        {
            secureNow = false;
            long start = Stopwatch.GetTimestamp();
            while (true)
            {
                long now = Length(window);
                if (now >= 0 && mark >= 0 && now != mark)
                {
                    secureNow = Target.IsPasswordEdit(window);
                    return true;
                }
                if (Since(start) >= timeoutMs) return false;
                Thread.Sleep(1);
            }
        }
    }

    internal sealed class UiaEventObserver : KeystrokeObserver
    {
        readonly AutomationElement element;
        readonly AutomationEventHandler onText;
        readonly AutomationPropertyChangedEventHandler onProperty;
        readonly AutoResetEvent signal = new AutoResetEvent(false);
        long changes;
        int secure;

        UiaEventObserver(AutomationElement element)
        {
            this.element = element;
            onText = delegate { Interlocked.Increment(ref changes); signal.Set(); };
            onProperty = delegate (object sender, AutomationPropertyChangedEventArgs e)
            {
                if (e.Property == AutomationElement.IsPasswordProperty && e.NewValue is bool && (bool)e.NewValue) Interlocked.Exchange(ref secure, 1);
                else Interlocked.Increment(ref changes);
                signal.Set();
            };
        }

        /// <summary>Subscribes (bounded); null when the subscription fails or does not complete in time.</summary>
        public static UiaEventObserver TryCreate(AutomationElement element)
        {
            UiaEventObserver observer = new UiaEventObserver(element);
            bool ok;
            if (!Bounded.Run(delegate
            {
                Automation.AddAutomationEventHandler(TextPattern.TextChangedEvent, element, TreeScope.Subtree, observer.onText);
                Automation.AddAutomationPropertyChangedEventHandler(element, TreeScope.Subtree, observer.onProperty,
                    ValuePattern.ValueProperty, AutomationElement.IsPasswordProperty);
                return true;
            }, 2000, out ok) || !ok)
            {
                observer.Dispose();
                return null;
            }
            return observer;
        }

        public override long Mark() { return Interlocked.Read(ref changes); }

        public override bool WaitProcessed(long mark, int timeoutMs, out bool secureNow)
        {
            long start = Stopwatch.GetTimestamp();
            while (true)
            {
                secureNow = Interlocked.CompareExchange(ref secure, 0, 0) == 1;
                if (secureNow) return true;
                if (Interlocked.Read(ref changes) > mark) return true;
                double left = timeoutMs - Since(start);
                if (left <= 0) return false;
                signal.WaitOne((int)Math.Ceiling(left));
            }
        }

        public override void Dispose()
        {
            bool done;
            Bounded.Run(delegate
            {
                try { Automation.RemoveAutomationEventHandler(TextPattern.TextChangedEvent, element, onText); } catch (Exception) { }
                try { Automation.RemoveAutomationPropertyChangedEventHandler(element, onProperty); } catch (Exception) { }
                return true;
            }, 1000, out done);
        }
    }
}
