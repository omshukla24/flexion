// "The Grip": a matte, chalky putty blob in the putty-ladder colours. Press and hold (or Space) and the five
// glass fingertips of the landmark hand press in and leave dents; let go and the putty creeps back.
// Scroll steps the resistance, extra soft to extra firm; the putty's colour stays on the putty (v4: two grounds only).
import * as THREE from 'three';
import { createStudio, glassMaterial, blobTexture } from './studio.js';
import { LEVELS, PRESS, bulgeAt, dentAt, depthAt, levelAt, radius, squeezeStep } from './grip-math.js';
import { clamp, lerp } from '../core/math.js';
import { cssVar } from '../core/env.js';

const SHAPE = new THREE.Vector3(1.1, 0.84, 1); // a hand-rolled ball, a little squashed
const HOVER = 0.42;                              // fingertip gap at rest
const lump = (x, y, z) => 1 + 0.035 * Math.sin(3.1 * x + 1.2) * Math.sin(2.3 * y + 0.4) + 0.025 * Math.sin(4.7 * z + 2.1 * x);

export function createGrip(canvas, { onState } = {}) {
  // Bloom only above 1.0: the squeezed rose cores glow, the matte putty never haloes (no big coloured glows).
  const st = createStudio(canvas, { background: cssVar('--ground') || '#E3EBF0', bloom: [0.4, 0.3, 1.3], fov: 30 });
  if (!st) return { setProgress() {}, dispose() {} };
  const root = new THREE.Group();
  st.scene.add(root);

  // The squeeze is linear (grip-math radius), so the blob is the rest lump plus two morph targets the GPU blends every
  // frame: a uniform bulge and the five dents at full depth. No per-frame vertex work on the CPU (it cost p95 20.8 ms at 4x CPU before).
  const geo = st.keep(new THREE.SphereGeometry(1, 128, 96));
  const pos = geo.attributes.position, n = pos.count;
  const rest = new Float32Array(n * 3), dents = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), b = lump(x, y, z), w = -b * dentAt([x, y, z]);
    rest.set([x * b * SHAPE.x, y * b * SHAPE.y, z * b * SHAPE.z], i * 3);
    dents.set([x * w * SHAPE.x, y * w * SHAPE.y, z * w * SHAPE.z], i * 3);
  }
  pos.array.set(rest);
  geo.computeVertexNormals();
  // Dent shading: exact at the deepest dent (extra soft); shallower levels blend toward it and the shader renormalises.
  const deepest = depthAt(0);
  const deep = new THREE.BufferGeometry().setIndex(geo.index).setAttribute('position', new THREE.BufferAttribute(rest.map((v, k) => v + deepest * dents[k]), 3));
  deep.computeVertexNormals();
  const n0 = geo.attributes.normal.array, nd = deep.attributes.normal.array;
  geo.morphAttributes.position = [new THREE.BufferAttribute(rest.slice(), 3), new THREE.BufferAttribute(dents, 3)];
  geo.morphAttributes.normal = [new THREE.BufferAttribute(new Float32Array(n * 3), 3), new THREE.BufferAttribute(nd.map((v, k) => (v - n0[k]) / deepest), 3)];
  geo.morphTargetsRelative = true;
  deep.dispose();
  const putty = st.keep(new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(LEVELS[0].color), roughness: 0.78, metalness: 0, sheen: 0.25, sheenRoughness: 0.9,
    sheenColor: new THREE.Color('#ffffff'), transmission: 0.08, thickness: 1.4, clearcoat: 0.03, envMapIntensity: 0.45,
  }));
  const blob = new THREE.Mesh(geo, putty);
  root.add(blob);
  const window_ = new THREE.DirectionalLight(0xffffff, 0.6); // a window key light from the top left, so the dents shade
  window_.position.set(-3, 4, 3);
  st.scene.add(window_);

  const shadow = new THREE.Mesh(st.keep(new THREE.PlaneGeometry(3.4, 3.4)), st.keep(new THREE.MeshBasicMaterial({ map: st.keep(blobTexture('15,27,45', 0.32)), transparent: true, depthWrite: false })));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -SHAPE.y - 0.02;
  root.add(shadow);

  const tipGeo = st.keep(new THREE.SphereGeometry(0.095, 32, 20)); // landmark beads, smaller than a fingertip so the dents show
  const tipGlass = st.keep(glassMaterial(0.4, { attenuationColor: new THREE.Color('#f2c3d3') }));
  const core = st.keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(cssVar('--rose') || '#E0457B') }));
  const coreGeo = st.keep(new THREE.SphereGeometry(0.034, 16, 12));
  const tips = PRESS.map(() => {
    const m = new THREE.Mesh(tipGeo, tipGlass);
    m.add(new THREE.Mesh(coreGeo, core));
    root.add(m);
    return m;
  });

  const s = { level: 0, user: null, held: false, pulse: 0, squeeze: 0, drawn: -1, color: new THREE.Color(LEVELS[0].color), px: 0, py: 0, ppx: 0, ppy: 0, last: '' };
  const lvl = () => s.user ?? s.level;

  function shape() {
    const level = lvl();
    blob.morphTargetInfluences[0] = s.squeeze * bulgeAt(level);
    blob.morphTargetInfluences[1] = s.squeeze * depthAt(level);
    PRESS.forEach((d, i) => {
      // Each fingertip rides the bottom of its own dent, so the dent is where the finger is.
      const r = lump(...d) * radius(d, s.squeeze, level) + 0.13 + HOVER * (1 - s.squeeze);
      tips[i].position.set(d[0] * r * SHAPE.x, d[1] * r * SHAPE.y, d[2] * r * SHAPE.z);
    });
    s.drawn = s.squeeze;
  }

  st.frame((dt) => {
    const held = s.held || s.pulse > 0;
    s.pulse = Math.max(0, s.pulse - dt);
    s.squeeze = st.reduced ? (held ? 1 : 0) : squeezeStep(s.squeeze, held, dt);
    const want = LEVELS[lvl()].color;
    const k = st.reduced ? 1 : 1 - Math.exp(-dt * 5);
    s.color.lerp(new THREE.Color(want), k);
    putty.color.copy(s.color);
    core.color.set(cssVar('--rose') || '#E0457B').multiplyScalar(0.9 + s.squeeze * 1.6); // the tendon light: brighter the harder you squeeze
    if (Math.abs(s.squeeze - s.drawn) > 1e-4) shape();
    s.ppx = lerp(s.ppx, s.px, 1 - Math.exp(-dt * 4));
    s.ppy = lerp(s.ppy, s.py, 1 - Math.exp(-dt * 4));
    root.rotation.set(0.12 + s.ppy * 0.08, 0.9 + s.ppx * 0.3, 0); // fingers press into the right silhouette, thumb at the front
    const key = `${lvl()}:${Math.round(s.squeeze * 100)}`;
    if (key !== s.last) {
      s.last = key;
      onState?.({ level: lvl(), name: LEVELS[lvl()].name, squeeze: s.squeeze, chosen: s.user !== null });
    }
  });
  st.resized((w, h) => {
    const aspect = w / h;
    const wide = aspect > 1.15;
    // The fingertips sit on the right silhouette, ~2.3 units from the centre: keep them in frame.
    root.position.set(wide ? 0.5 : -0.25, wide ? -0.1 : 0.55, 0);
    const dist = (wide ? 4.4 : 6 / aspect) / (2 * Math.tan(THREE.MathUtils.degToRad(15)));
    st.camera.position.set(0, 0.45, Math.max(6, dist));
    st.camera.lookAt(0, 0, 0);
  });

  const redraw = () => { if (st.reduced) st.render(); };
  const press = (on) => { s.held = on; redraw(); };
  const down = (e) => {
    press(true);
    try { canvas.setPointerCapture(e.pointerId); } catch { /* the release is caught on window anyway */ }
  };
  const up = () => press(false);
  const move = (e) => {
    const r = canvas.getBoundingClientRect();
    s.px = ((e.clientX - r.left) / r.width) * 2 - 1;
    s.py = ((e.clientY - r.top) / r.height) * 2 - 1;
  };
  const keyDown = (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); press(true); }
    const step = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    if (step) { e.preventDefault(); s.user = clamp(lvl() + step, 0, LEVELS.length - 1); s.pulse = 0.7; redraw(); }
  };
  const keyUp = (e) => { if (e.key === ' ' || e.key === 'Enter') press(false); };
  const noMenu = (e) => e.preventDefault(); // a long press on a phone is a squeeze, not a context menu
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('contextmenu', noMenu);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  canvas.addEventListener('keydown', keyDown);
  canvas.addEventListener('keyup', keyUp);
  canvas.addEventListener('blur', up);
  shape();
  st.start();

  return {
    setProgress(p) {
      const level = levelAt(p);
      if (level !== s.level) { s.level = level; if (s.user === null && !st.reduced) s.pulse = 0.7; } // a new putty arrives with one squeeze
      redraw();
    },
    dispose() {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('contextmenu', noMenu);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      canvas.removeEventListener('keydown', keyDown);
      canvas.removeEventListener('keyup', keyUp);
      canvas.removeEventListener('blur', up);
      st.dispose();
    },
  };
}
