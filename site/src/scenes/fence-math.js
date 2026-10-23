// The Fence's 4-week story. ILLUSTRATION ONLY (the page says so): a simulated
// routine, not patient data. Values are index curl, 0 (open) .. 1 (fist).
export const DAYS = 28;
export const NOISE = 0.063 / 0.583; // The measured MDC95 as a share of the open->fist range (10.7 %)

// The routine's target rises each day but never passes the therapist's fence;
// readings wobble around it, and two flare mornings dip well below.
export function simulate({ fence, start = 0.42, rate = 0.016, flare = [14, 15], dip = 0.2, gentleFrom = -1 }) {
  const days = [];
  let target = start;
  for (let d = 0; d < DAYS; d += 1) {
    if (d > 0) target = Math.min(fence, target + (gentleFrom >= 0 && d >= gentleFrom ? rate * 0.35 : rate));
    const wobble = Math.sin(d * 2.3) * 0.02;
    const reading = target + wobble - (flare.includes(d) ? dip : 0);
    days.push({ day: d + 1, target, reading });
  }
  return days;
}

// Product rule: a flare is two mornings in a row below target by more than the noise band.
export function flareIndex(days, noise = NOISE) {
  for (let i = 1; i < days.length; i += 1) {
    const low = (x) => x.reading < x.target - noise;
    if (low(days[i]) && low(days[i - 1])) return i;
  }
  return -1;
}
