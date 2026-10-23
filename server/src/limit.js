// Cost guard for the endpoints that call paid or heavy models (/api/voice, /api/identify): per instance, in memory.

/** `allow(key, now)` is true at most once per `gapMs` per key, `perKey` times per key in all, and `perMinute` times per rolling minute overall; only allowed calls count. */
export function rateLimit({ gapMs, perMinute, perKey = Infinity }) {
  const last = new Map();
  const count = new Map();
  let recent = [];
  return (key, now = Date.now()) => {
    recent = recent.filter((t) => now - t < 60_000);
    if (recent.length >= perMinute || now - (last.get(key) ?? -Infinity) < gapMs || (count.get(key) ?? 0) >= perKey) return false;
    // shortcut: past 1000 live keys an idle key is forgotten, count included; the per-minute cap still bounds cost
    if (last.size > 1000) for (const [k, t] of last) if (now - t >= gapMs) last.delete(k), count.delete(k);
    last.set(key, now);
    count.set(key, (count.get(key) ?? 0) + 1);
    recent.push(now);
    return true;
  };
}
