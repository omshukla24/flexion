// Motion and scene tokens. Every timing reads from here, so the whole feel
// re-tunes in one file.

export const EASE = {
  emergence: 'expo.out', // things arriving
  emergenceCss: 'cubic-bezier(0.16, 1, 0.3, 1)',
  orbital: 'power4.inOut', // things travelling between two resting states
  orbitalCss: 'cubic-bezier(0.83, 0, 0.17, 1)',
  settle: 'power3.out',
  exit: 'power2.in',
  // One soft overshoot, never a wobble: the spring family (damping ~0.72); elastic easing reads as cheap.
  elastic: 'back.out(1.6)',
  pill: 'back.out(1.4)',
};

export const DURATION = { micro: 0.3, base: 0.9, cinematic: 1.35 };

export const LENIS = { duration: 1.15, wheelMultiplier: 0.92, touchMultiplier: 1.1 };

export const CURSOR = {
  dotLerp: 0.12,
  ringLerp: 0.45,
  hoverScale: 1.7,
  labelScale: 2.4,
  magneticPullX: 0.34,
  magneticPullY: 0.44,
  magneticInner: 0.18,
};

export const REVEAL = { yPercent: 118, duration: 1.05, stagger: 0.035, start: 'top 88%' };

export const NAV_INERTIA = {
  smoothing: 0.16,
  clampVelocity: 45,
  strength: 0.5,
  max: 14,
  bend: 0.42,
  maxBend: 13,
  lag: 0.5,
  disableBelow: 900,
};

export const HELIX = {
  runway: 3.2, // viewport heights of scroll the ring stays pinned for
  turns: 0.5,
  spread: 2.4,
  falloff: 0.46,
  radiusFactor: 1.05,
  dragScale: 0.0016,
  friction: 0.93,
  lerp: 0.1,
  snapDelay: 160,
  openDuration: 1.05,
  closeDuration: 0.7,
  closeScrollPx: 48,
};

export const STAGE = { dwell: 7, crossfade: 0.9 };

export const GATE = { runway: 2.4, chargeEnd: 0.3, labels: ['KEEP SCROLLING', 'CHARGING', 'OPEN'] };

export const DECK = { mobileBelow: 700, enterStagger: 0.07, exitStagger: 0.04 };

export const FILM = { scrub: 0.6, seekStep: (1 / 24) * 1.5 };

export const PERF = { dprMax: 1.75, dprDegraded: 1.25, degradeFrameMs: 22, sampleFrames: 90 };
