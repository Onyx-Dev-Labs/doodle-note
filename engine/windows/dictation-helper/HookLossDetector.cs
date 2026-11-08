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
    /// Any callback proves the hook alive and clears the evidence. Pure logic, unit-tested.
    /// </summary>
    internal sealed class HookLossDetector
    {
        readonly int required;
        int consecutive;
        bool sawAbove;

        /// <summary>Suspect ticks seen while the foreground ran above us (counted, not acted on).</summary>
        public int EvidenceWhileAbove { get; private set; }

        /// <param name="required">Consecutive suspect ticks needed normally (keyboard 1, mouse 2).</param>
        public HookLossDetector(int required) { this.required = Math.Max(1, required); }

        /// <returns>True when a loss is declared (the evidence is then cleared).</returns>
        public bool Observe(bool suspect, bool callbackAdvanced, bool foregroundAbove)
        {
            if (foregroundAbove)
            {
                sawAbove = true;
                consecutive = 0;
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
                consecutive = 0;
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
}
