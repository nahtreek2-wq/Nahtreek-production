// F-206: the single NAHTREEK motion grammar. Entrances share one duration and
// one stagger rhythm in both apps (Reanimated FadeInDown on Home,
// MotionReveal on Pro — same timing, native implementation each). Feedback
// (toast, sheet, press) keeps its faster timings: different role.
// Every consumer must honor useReducedMotion; these numbers are the
// full-motion values.
export const Motion = {
  /** Entrance duration for screens, cards, and revealed sections. */
  entrance: 300,
  /** Per-item stagger step for lists and carousels. */
  staggerStep: 40,
  /** Stagger cap so long lists never cascade longer than this. */
  staggerCap: 200,
  /** Toast/banner fade in/out. */
  feedback: 160,
  /** Bottom sheet open. */
  sheet: 220,
} as const;

/** Capped list stagger: staggerStep * index, never more than staggerCap. */
export function stagger(index: number): number {
  return Math.min(index * Motion.staggerStep, Motion.staggerCap);
}
