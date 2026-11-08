using System;

namespace DoodleNote.DictationHelper
{
    /// <summary>
    /// Decides, one watchdog tick at a time, whether a low-level hook has been lost, from real
    /// traffic only (no input is ever injected). A "suspect" tick is one where input the hook should
    /// have seen happened (the armed key changed state / the cursor moved) but the hook delivered no
    /// callback at all. While the foreground runs above us (higher integrity), hooks legitimately see
    /// nothing, so suspect ticks are only counted, never acted on; after such a window loses the
    /// foreground, a loss needs at least two CONSECUTIVE suspect ticks, so the stretch of time spent
    /// there cannot be mistaken for a loss, yet a hook that really died meanwhile is still caught.
    /// Any callback proves the hook alive and clears the evidence. With consecutive=false (the mouse),
    /// quiet ticks do not clear the evidence either: isolated suspect ticks separated by quiet ones
    /// add up until `required` is reached or a callback arrives. Pure logic, unit-tested.
    /// </summary>
    internal sealed class HookLossDetector
    {
        readonly int required;
        readonly bool needConsecutive;
        int consecutive;
        bool sawAbove;

        /// <summary>Suspect ticks seen while the foreground ran above us (counted, not acted on).</summary>
        public int EvidenceWhileAbove { get; private set; }

        /// <param name="required">Suspect ticks needed normally (keyboard 1, mouse 2).</param>
        /// <param name="consecutive">Whether a quiet tick clears the evidence (true for the keyboard).</param>
        public HookLossDetector(int required, bool consecutive = true)
        {
            this.required = Math.Max(1, required);
            needConsecutive = consecutive;
        }

        /// <returns>True when a loss is declared (the evidence is then cleared).</returns>
        public bool Observe(bool suspect, bool callbackAdvanced, bool foregroundAbove)
        {
            if (foregroundAbove)
            {
                sawAbove = true;
                consecutive = 0; // evidence after it leaves starts afresh
                if (suspect) EvidenceWhileAbove++;
                return false;
            }
            if (callbackAdvanced)
            {
                Reset();
                return false;
            }
            if (!suspect)
            {
                if (needConsecutive) consecutive = 0;
                return false;
            }
            consecutive++;
            int need = sawAbove ? Math.Max(2, required) : required;
            if (consecutive < need) return false;
            Reset();
            return true;
        }

        public void Reset()
        {
            consecutive = 0;
            sawAbove = false;
            EvidenceWhileAbove = 0;
        }
    }

    /// <summary>
    /// When to retry re-installing a hook after failures: immediately the first time, then after a
    /// delay that doubles (2 ticks, 4, 8 … capped at 30 s). Tick() is called once per watchdog tick
    /// and says whether to attempt on THIS tick; the attempt happens on the tick where the delay runs
    /// out, so the delays are exactly 4/8/16/30 s with a 2 s tick. Pure logic, unit-tested.
    /// </summary>
    internal sealed class RetryClock
    {
        readonly int tickMs;
        int delayMs;
        int countdownMs;

        public RetryClock(int tickMs) { this.tickMs = Math.Max(1, tickMs); }

        public bool Tick()
        {
            if (countdownMs <= 0) return true;
            countdownMs -= tickMs;
            return countdownMs <= 0;
        }

        public void Failed()
        {
            delayMs = Math.Min(delayMs <= 0 ? 2 * tickMs : delayMs * 2, 30000);
            countdownMs = delayMs;
        }

        public void Succeeded() { delayMs = 0; countdownMs = 0; }

        public int DelayMs { get { return delayMs; } }
    }
}
