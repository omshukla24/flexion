// "The Noise Band": the 10 real validation fists drop as glass beads onto a rail over a
// printed scale; the hatched band is his MDC95. A glowing "tomorrow" bead can be
// dragged (or moved with arrow keys): inside the band it's day-to-day noise,
// outside it's a real change. Scroll drops the beads and draws the band.
import * as THREE from 'three';
import { createStudio, freeBand, glassMaterial, printedPlane } from './studio.js';
import { FISTS, BASE, MDC95, verdict, stackRows } from './band-math.js';
import { clamp, lerp, smoothstep } from '../core/math.js';
import { cssVar } from '../core/env.js';

const AXIS = { min: 0.08, max: 0.32, width: 14 };
const R = 0.3;
const LANE = 1.1; // tomorrow's bead rolls in front of the history beads
const xOf = (v) => ((v - AXIS.min) / (AXIS.max - AXIS.min) - 0.5) * AXIS.width;
const vOf = (x) => AXIS.min + (x / AXIS.width + 0.5) * (AXIS.max - AXIS.min);
const GAP = ((2 * R * 0.96) / AXIS.width) * (AXIS.max - AXIS.min);
const TOMORROW = { start: 0.2, drift: 0.268 }; // the unattended demo: noise, then a looser fist
const SPAN = 16.5; // both rails end to end (14.7) + the front rail's perspective and parallax swing
const TEXT = 1.4; // printed label scale: keeps them ~13 px now that wide screens frame the whole rail

// Step response of the needle spring family (damping ratio 0.72), t in seconds.
function settle(t) {
  if (t <= 0) return 0;
  const w = 13;
  const z = 0.72;
  const k = Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * t) * (Math.cos(w * k * t) + (z / k) * Math.sin(w * k * t));
}

function drawAxis(g, u, w, h, ink) {
  const X = (x) => w / 2 + x * u;
  const Y = (y) => h / 2 - y * u;
  const line = (x0, y0, x1, y1, lw, a) => { g.globalAlpha = a; g.lineWidth = lw; g.beginPath(); g.moveTo(X(x0), Y(y0)); g.lineTo(X(x1), Y(y1)); g.stroke(); };
  const text = (s, x, y, size, a, align = 'center', weight = 600) => { g.globalAlpha = a; g.font = `${weight} ${size * TEXT}px "Atkinson Hyperlegible Mono", monospace`; g.textAlign = align; g.fillText(s, X(x), Y(y)); };
  g.fillStyle = cssVar('--void') || '#0D1520';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = ink;
  g.fillStyle = ink;
  // The band: hatched, edges dashed, the usual value solid.
  const b0 = xOf(BASE - MDC95);
  const b1 = xOf(BASE + MDC95);
  g.save();
  g.beginPath();
  g.rect(X(b0), Y(3.4), (b1 - b0) * u, 3.7 * u);
  g.clip();
  for (let d = -h; d < w; d += 14) line((d - w / 2) / u, -0.3, (d - w / 2 + h) / u, 3.4 + h / u, 2, 0.16);
  g.restore();
  g.setLineDash([10, 9]);
  line(b0, -0.3, b0, 3.4, 2, 0.6);
  line(b1, -0.3, b1, 3.4, 2, 0.6);
  g.setLineDash([]);
  line(xOf(BASE), -0.3, xOf(BASE), 3.6, 2.5, 0.9);
  text(`YOUR USUAL ${BASE.toFixed(3)}`, xOf(BASE), 3.85, 20, 0.9);
  text(`± ${MDC95.toFixed(3)}`, b1 - 0.15, 3.1, 16, 0.55, 'right');
  // The scale under the rail.
  line(-AXIS.width / 2, -0.55, AXIS.width / 2, -0.55, 2, 0.7);
  for (let i = 0; i <= 24; i += 1) {
    const v = AXIS.min + i * 0.01;
    line(xOf(v), -0.55, xOf(v), -0.55 - (i % 2 ? 0.14 : 0.28), 1.6, 0.7);
    if (i % 2 === 0) text(v.toFixed(2), xOf(v), -1.15, 18, 0.75);
  }
  // Two label rows under the scale, every label inside the band's width so a phone's crop keeps them whole.
  text('← TIGHTER', b0, -1.75, 17, 0.75, 'left');
  text('10 FISTS · 20 OCT · RUN 4', xOf(BASE), -2.35, 16, 0.5);
  text('LOOSER →', b1, -1.75, 17, 0.75, 'right');
}

export function createNoiseBand(canvas, { onVerdict } = {}) {
  // Threshold above 1, as on the hero: the glass rails' highlights smeared into white streaks at 1.0.
  const st = createStudio(canvas, { background: cssVar('--void') || '#0D1520', bloom: [0.6, 0.4, 1.02], fov: 26 });
  if (!st) return { setProgress() {}, dispose() {} };
  const rose = new THREE.Color(cssVar('--rose') || '#E0457B');
  const root = new THREE.Group();
  st.scene.add(root);
  root.add(printedPlane(st, { width: 24, height: 10, z: -0.7, draw: (g, u, w, h) => drawAxis(g, u, w, h, cssVar('--bone') || '#E3EBF0') }));

  const glass = st.keep(glassMaterial(0.8, { attenuationColor: new THREE.Color('#b9cfe0') }));
  const ball = st.keep(new THREE.SphereGeometry(R, 48, 32));
  const rail = new THREE.Mesh(st.keep(new THREE.CapsuleGeometry(0.06, AXIS.width + 0.6, 6, 16)), glass);
  rail.rotation.z = Math.PI / 2;
  rail.position.y = -0.07;
  const rail2 = rail.clone();
  rail2.position.z = LANE;
  root.add(rail, rail2);
  const rows = stackRows(FISTS, GAP);
  const beads = FISTS.map((v, i) => {
    const m = new THREE.Mesh(ball, glass);
    m.userData = { x: xOf(v), y: R + rows[i] * 2 * R * 0.94, start: 0.04 + i * 0.035 };
    root.add(m);
    return m;
  });
  const coreMat = st.keep(new THREE.MeshBasicMaterial({ color: rose.clone() }));
  const tomorrow = new THREE.Mesh(ball, st.keep(glassMaterial(0.8, { attenuationColor: new THREE.Color('#f2c3d3') })));
  tomorrow.add(new THREE.Mesh(st.keep(new THREE.SphereGeometry(R * 0.38, 24, 16)), coreMat));
  root.add(tomorrow);
  const glow = new THREE.PointLight(rose, 0, 6, 1.6);
  tomorrow.add(glow);

  const s = { target: 0, p: 0, user: null, px: 0, py: 0, ppx: 0, ppy: 0, last: '' };
  const ray = new THREE.Raycaster();
  const lane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -LANE);
  const hit = new THREE.Vector3();
  const tv = () => s.user ?? lerp(TOMORROW.start, TOMORROW.drift, smoothstep(0.7, 0.92, s.p));

  st.frame((dt) => {
    s.p = st.reduced ? s.target : lerp(s.p, s.target, 1 - Math.exp(-dt * 7));
    const p = st.reduced ? 1 : s.p;
    beads.forEach((m) => {
      const { x, y, start } = m.userData;
      m.position.set(x, y + (1 - settle((p - start) * 7)) * 8, 0);
      m.scale.setScalar(p >= start ? 1 : 0.0001);
    });
    const v = tv();
    const show = st.reduced ? 1 : settle((p - 0.55) * 6);
    tomorrow.position.set(xOf(v), R, LANE);
    tomorrow.scale.setScalar(Math.max(0.0001, show));
    const verdictNow = verdict(v);
    coreMat.color.copy(rose).multiplyScalar(verdictNow === 'noise' ? 1.3 : 2.4);
    glow.intensity = verdictNow === 'noise' ? 2 : 6;
    s.ppx = lerp(s.ppx, s.px, 1 - Math.exp(-dt * 4));
    s.ppy = lerp(s.ppy, s.py, 1 - Math.exp(-dt * 4));
    root.rotation.set(0.06 + s.ppy * 0.05, s.ppx * 0.12, 0);
    const key = `${verdictNow}:${v.toFixed(3)}:${show > 0.5}`;
    if (key !== s.last) {
      s.last = key;
      onVerdict?.({ value: v, verdict: verdictNow, delta: v - BASE, shown: show > 0.5 });
    }
  });
  st.resized((w, h) => {
    const aspect = w / h;
    // Wide screens: the whole rail and scale fit between the copy column's measured right edge and the screen's
    // (framing only the band cut 0.30, 0.32 and the rail ends off the right). Phones crop to the
    // band so the printed scale stays readable.
    const wide = aspect >= 1.2;
    const phone = w < 600; // too narrow for the whole scale at a readable size (a 768 px tablet fits it)
    const col = canvas.parentElement?.querySelector('.piece-col');
    const x0 = col ? (col.offsetLeft + col.offsetWidth) / w + 0.03 : 0.45;
    const x1 = 0.97;
    // Narrow screens fit the printed labels (y -2.6 to 4.2) between the title and the readout.
    const band = wide ? null : freeBand(canvas);
    const visH = wide ? Math.max(7.5, SPAN / ((x1 - x0) * aspect)) : Math.max(6.8 / (band.bottom - band.top), (phone ? 9.6 : AXIS.width + 3) / aspect);
    const dist = visH / (2 * Math.tan(THREE.MathUtils.degToRad(13)));
    const cx = wide ? -((x0 + x1) / 2 - 0.5) * visH * aspect : phone ? xOf(BASE) : 0;
    const cy = wide ? 1.3 : 0.8 + ((band.top + band.bottom) / 2 - 0.5) * visH;
    st.camera.position.set(cx, wide ? 1.9 : cy, dist);
    st.camera.lookAt(cx, cy, 0);
  });

  const pick = (e) => {
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera({ x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 }, st.camera);
    if (ray.ray.intersectPlane(lane, hit)) s.user = clamp(vOf(hit.x - root.position.x), AXIS.min + 0.01, AXIS.max - 0.01);
    if (st.reduced) st.render();
  };
  let dragging = false;
  const down = (e) => { if (s.p < 0.5 && !st.reduced) return; dragging = true; canvas.setPointerCapture?.(e.pointerId); pick(e); };
  const move = (e) => {
    const r = canvas.getBoundingClientRect();
    s.px = ((e.clientX - r.left) / r.width) * 2 - 1;
    s.py = ((e.clientY - r.top) / r.height) * 2 - 1;
    if (dragging) pick(e);
  };
  const up = () => { dragging = false; };
  const keys = (e) => {
    const step = { ArrowLeft: -0.005, ArrowRight: 0.005 }[e.key];
    if (!step) return;
    e.preventDefault();
    s.user = clamp(tv() + step, AXIS.min + 0.01, AXIS.max - 0.01);
    if (st.reduced) st.render();
  };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  canvas.addEventListener('keydown', keys);
  st.start();

  return {
    setProgress(p) { s.target = clamp(p, 0, 1); if (st.reduced) st.render(); },
    dispose() {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      canvas.removeEventListener('keydown', keys);
      st.dispose();
    },
  };
}
