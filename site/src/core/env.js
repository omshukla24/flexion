// Capability checks. `?reduced` in the URL forces reduced motion for testing.
// Everything reads `window` lazily so the module is safe to import during SSR.
export const prefersReducedMotion = () =>
  new URLSearchParams(window.location.search).has('reduced') ||
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const hasFinePointer = () =>
  window.matchMedia('(pointer: fine)').matches || window.matchMedia('(any-pointer: fine)').matches;

export const cssVar = (name, el = document.documentElement) =>
  getComputedStyle(el).getPropertyValue(name).trim();
