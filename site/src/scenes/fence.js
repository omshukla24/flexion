// "The Fence": one big clear-acrylic goniometer arc. The rose needle is the
// routine's daily target, stepping through 4 weeks as you scroll; the ink post is
// the therapist's limit, which the target never passes. Drag the post (or use the
// arrow keys) and the month replays inside the new limit. Two low mornings raise
// the flare question; the gentle routine starts only if the visitor confirms.
import * as THREE from 'three';
import { createStudio, freeBand, glassMaterial, printedPlane } from './studio.js';
import { simulate, flareIndex, DAYS } from './fence-math.js';
import { clamp, lerp } from '../core/math.js';
import { cssVar } from '../core/env.js';

const RI = 5.1;
const RO = 6;
const FENCE = { init: 0.72, min: 0.5, max: 0.95 };
const BOX = { cx: 3, cy: 3.5, size: 9.4 }; // arc + labels, hub at origin
const ang = (v) => THREE.MathUtils.degToRad(100 - 90 * v);

function drawPlate(g, u, w, h, ink) {
  const X = (x) => w / 2 + (x - BOX.cx) * u;
  const Y = (y) => h / 2 - (y - BOX.cy) * u;
  const at = (r, v) => [X(Math.cos(ang(v)) * r), Y(Math.sin(ang(v)) * r)];
  g.fillStyle = cssVar('--ground') || '#E3EBF0';
  g.fillRect(0, 0, w, h);
  const pool = g.createRadialGradient(X(2.4), Y(3.2), 0, X(2.4), Y(3.2), 11 * u);
  pool.addColorStop(0, 'rgba(255,255,255,0.2)');
  pool.addColorStop(0.45, 'rgba(255,255,255,0)');
  pool.addColorStop(1, 'rgba(255,255,255,0)'); // edges = the scene background, so the plate's border never shows
  g.fillStyle = pool;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = ink;
  g.fillStyle = ink;
  g.lineCap = 'round';
  for (let i = 0; i <= 100; i += 1) {
    const len = i % 10 === 0 ? 0.55 : i % 5 === 0 ? 0.36 : 0.18;
    g.globalAlpha = 0.75;
    g.lineWidth = i % 10 === 0 ? 3 : 1.5;
    g.beginPath();
    g.moveTo(...at(RO + 0.35, i / 100));
    g.lineTo(...at(RO + 0.35 + len, i / 100));
    g.stroke();
    if (i % 10 === 0) {
      g.font = '600 20px "Atkinson Hyperlegible Mono", monospace';
      g.textAlign = 'center';
      const [x, y] = at(RO + 1.35, i / 100);
      g.fillText(String(i).padStart(3, '0'), x, y + 7);
    }
  }
  g.globalAlpha = 1;
}

export function createFence(canvas, { onDay, anchor } = {}) {
  const st = createStudio(canvas, { background: cssVar('--ground') || '#E3EBF0', bloom: [0.3, 0.35, 1.05], fov: 28 });
  if (!st) return { setProgress() {}, setGentle() {}, dispose() {} };
  const ink = new THREE.Color(cssVar('--ink') || '#0F1B2D');
  const rose = new THREE.Color(cssVar('--rose') || '#E0457B');
  const care = new THREE.Color(cssVar('--care-fill') || '#F2B33D');
  const root = new THREE.Group();
  st.scene.add(root);
  const plate = printedPlane(st, { width: 22, height: 22, z: -0.9, draw: (g, u, w, h) => drawPlate(g, u, w, h, cssVar('--ink') || '#0F1B2D') });
  plate.position.set(BOX.cx, BOX.cy, -0.9);
  root.add(plate);

  // The glass arc band.
  const shape = new THREE.Shape();
  shape.absarc(0, 0, RO, ang(0), ang(1), true);
  shape.absarc(0, 0, RI, ang(1), ang(0), false);
  const band = new THREE.Mesh(st.keep(new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 4, curveSegments: 120 })), st.keep(glassMaterial(0.6, { clearcoat: 0.2, envMapIntensity: 0.45, specularIntensity: 0.6, iridescence: 0.2 })));
  band.position.z = -0.15; // softer reflections: the full-strength clearcoat streak read as glare
  root.add(band);
  const hub = new THREE.Mesh(st.keep(new THREE.SphereGeometry(0.38, 40, 28)), st.keep(glassMaterial(0.9)));
  root.add(hub);

  // Needle: a glass rod with rose light inside, pivoting on the hub.
  const needle = new THREE.Group();
  const rod = new THREE.Mesh(st.keep(new THREE.CapsuleGeometry(0.11, RO - 0.4, 6, 16)), st.keep(glassMaterial(0.4)));
  rod.position.y = (RO - 0.4) / 2 + 0.2;
  const coreMat = st.keep(new THREE.MeshBasicMaterial({ color: rose.clone().multiplyScalar(1.25) }));
  const core = new THREE.Mesh(st.keep(new THREE.CapsuleGeometry(0.035, RO - 0.7, 4, 8)), coreMat);
  core.position.y = rod.position.y;
  needle.add(rod, core);
  root.add(needle);

  // The therapist's fence: an ink metal post across the band, with its flag.
  const metal = st.keep(new THREE.MeshPhysicalMaterial({ color: ink, metalness: 0.65, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.1 }));
  const post = new THREE.Group();
  const bar = new THREE.Mesh(st.keep(new THREE.CylinderGeometry(0.075, 0.075, RO - RI + 1.1, 20)), metal);
  bar.position.y = (RI + RO) / 2;
  const flag = new THREE.Mesh(st.keep(new THREE.BoxGeometry(0.42, 0.3, 0.05)), metal);
  flag.position.set(0.2, RO + 0.5, 0);
  post.add(bar, flag);
  root.add(post);

  // Readings trail: one dot per morning, amber on a low morning.
  const dots = new THREE.InstancedMesh(st.keep(new THREE.SphereGeometry(0.075, 12, 8)), st.keep(new THREE.MeshBasicMaterial()), DAYS);
  root.add(dots);
  const m4 = new THREE.Matrix4();

  const s = { target: 0, p: 0, fence: FENCE.init, gentle: null, days: [], flare: -1, px: 0, py: 0, ppx: 0, ppy: 0, last: '' };
  const replan = () => {
    s.flare = flareIndex(simulate({ fence: s.fence }));
    s.days = simulate({ fence: s.fence, gentleFrom: s.gentle === true ? s.flare + 1 : -1 });
  };
  replan();

  const tmp = new THREE.Vector3();
  st.frame((dt) => {
    s.p = st.reduced ? s.target : lerp(s.p, s.target, 1 - Math.exp(-dt * 6));
    const t = clamp((s.p - 0.06) / 0.86, 0, 1) * (DAYS - 1);
    const d = Math.floor(t);
    const a = s.days[d];
    const b = s.days[Math.min(DAYS - 1, d + 1)];
    const target = lerp(a.target, b.target, t - d);
    needle.rotation.z = ang(target) - Math.PI / 2;
    post.rotation.z = ang(s.fence) - Math.PI / 2;
    s.days.forEach((x, i) => {
      const low = i === s.flare || i === s.flare - 1;
      const r = RO + 0.18;
      m4.makeScale(...(i <= d ? [1, 1, 1] : [0.0001, 0.0001, 0.0001])).setPosition(Math.cos(ang(x.reading)) * r, Math.sin(ang(x.reading)) * r, 0.25);
      dots.setMatrixAt(i, m4);
      dots.setColorAt(i, low ? care : rose);
    });
    dots.instanceMatrix.needsUpdate = true;
    if (dots.instanceColor) dots.instanceColor.needsUpdate = true;
    s.ppx = lerp(s.ppx, s.px, 1 - Math.exp(-dt * 4));
    s.ppy = lerp(s.ppy, s.py, 1 - Math.exp(-dt * 4));
    root.rotation.set(-0.08 + s.ppy * 0.06, -0.18 + s.ppx * 0.14, 0);
    if (anchor) {
      flag.getWorldPosition(tmp).project(st.camera);
      anchor.style.transform = `translate3d(${((tmp.x + 1) / 2) * st.size.w}px, ${((1 - tmp.y) / 2) * st.size.h}px, 0)`;
    }
    const prompt = s.gentle === null && s.flare >= 0 && d >= s.flare;
    const key = `${d}:${s.fence.toFixed(2)}:${s.gentle}:${prompt}`;
    if (key !== s.last) {
      s.last = key;
      onDay?.({ day: d + 1, target: a.target, reading: a.reading, fence: s.fence, low: d === s.flare || d === s.flare - 1, prompt, gentle: s.gentle });
    }
  });
  st.resized((w, h) => {
    const aspect = w / h;
    const wide = aspect >= 1.2;
    // Wide: the copy column is on the left, so the arc sits right. Narrow: it fits between the title and the
    // readout, with room kept for the flare question that grows the readout (~130 px).
    const band = wide ? { top: 0.09, bottom: 0.91 } : freeBand(canvas, 130);
    const visH = Math.max(BOX.size / (band.bottom - band.top), BOX.size / (wide ? 0.46 : 0.9) / aspect);
    const dist = visH / (2 * Math.tan(THREE.MathUtils.degToRad(14)));
    const lookX = BOX.cx - (wide ? 0.22 : 0) * visH * aspect;
    const lookY = BOX.cy + ((band.top + band.bottom) / 2 - 0.5) * visH;
    st.camera.position.set(lookX, lookY, dist);
    st.camera.lookAt(lookX, lookY, 0);
  });

  // Drag the post around the hub, or nudge it with the arrow keys.
  const ray = new THREE.Raycaster();
  const face = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const hit = new THREE.Vector3();
  const setFence = (v) => {
    s.fence = clamp(v, FENCE.min, FENCE.max);
    replan();
    if (st.reduced) st.render();
  };
  let dragging = false;
  const aim = (e) => {
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera({ x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 }, st.camera);
    if (!ray.ray.intersectPlane(face, hit)) return;
    root.worldToLocal(hit);
    setFence((100 - THREE.MathUtils.radToDeg(Math.atan2(hit.y, hit.x))) / 90);
  };
  const down = (e) => { dragging = true; canvas.setPointerCapture?.(e.pointerId); aim(e); };
  const move = (e) => {
    const r = canvas.getBoundingClientRect();
    s.px = ((e.clientX - r.left) / r.width) * 2 - 1;
    s.py = ((e.clientY - r.top) / r.height) * 2 - 1;
    if (dragging) aim(e);
  };
  const up = () => { dragging = false; };
  const keys = (e) => {
    const step = { ArrowLeft: -0.01, ArrowDown: -0.01, ArrowRight: 0.01, ArrowUp: 0.01 }[e.key];
    if (!step) return;
    e.preventDefault();
    setFence(s.fence + step);
  };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  canvas.addEventListener('keydown', keys);
  st.start();

  return {
    setProgress(p) { s.target = clamp(p, 0, 1); if (st.reduced) st.render(); },
    // The visitor's answer to "switch to the gentle routine?"; nothing changes without it.
    setGentle(yes) { s.gentle = Boolean(yes); replan(); if (st.reduced) st.render(); },
    dispose() {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      canvas.removeEventListener('keydown', keys);
      st.dispose();
    },
  };
}
