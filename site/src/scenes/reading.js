// "The Reading": Flexion's hero set-piece. A clear-acrylic hand built from the
// 21 MediaPipe landmarks curls in front of a printed goniometer dial; rose tendon
// light inside the glass brightens as the hand works. Plumbing follows the usual
// orbital.js: DPR cap + auto-degrade, offscreen pause, reduced-motion still, dispose.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { gsap } from 'gsap';
import { PERF } from '../config.js';
import { prefersReducedMotion, cssVar } from '../core/env.js';
import { clamp, lerp, smoothstep } from '../core/math.js';
import { landmarks, fingerCurls, BONES, TIPS, radius } from './hand-pose.js';
import { drawDial, DIAL } from './dial.js';
import { glassMaterial, blobTexture } from './studio.js';

const UP = new THREE.Vector3(0, 1, 0);
const REST_CURL = 0.05;
const STILL_CURL = 0.4; // reduced-motion composed frame
const FENCE = 0.85;     // the therapist's limit printed on the dial
// Bounds of the hand and the whole dial at rest, wrist at rig origin, as rendered (the dial at z -3 projects
// smaller): thumb x -2.2, "100" x 6.8, wrist y -0.2, top numbers y 7.6, plus the pointer parallax (0.4 x, 0.3 y).
// The hand alone (x -2.4..3) cut the dial off at ~060.
const HAND = { cx: 2.3, cy: 3.7, w: 9.8, h: 8.4 };
const RIG_Y = -0.6;
const ORDER = [0, 1, 5, 9, 13, 17, 2, 6, 10, 14, 18, 3, 7, 11, 15, 19, 4, 8, 12, 16, 20];
const RANK = ORDER.map((_, i) => ORDER.indexOf(i)); // landmark -> assembly slot
const INTRO = { each: 1.1, stagger: 0.045, delay: 0.15 };



// Fit the hand into the free part of the screen, measured from the layout: right of the copy on landscape
// screens, between the HUD and the copy on narrower ones (so the hand never sits on the wordmark).
// Where the hero copy's text ends, as a fraction of the width: a Range, because the wordmark's glyphs overflow its
// box: a fixed 65 % left half of a 2000 px screen empty and the hand too small. Never right of 65 %.
function copyRight(copy, w) {
  const range = document.createRange();
  if (copy) range.selectNodeContents(copy);
  const right = copy ? range.getBoundingClientRect().right : 0;
  return right > 0 ? Math.min(0.65, right / w + 0.02) : 0.65;
}

function frameFor(w, h, copy, hud) {
  const aspect = w / h;
  const wide = aspect >= 1.2;
  const top = wide ? 0.09 : Math.max(0.1, (hud ? hud.offsetTop + hud.offsetHeight : 0) / h + 0.02);
  const bottom = wide ? 0.96 : Math.min(0.9, (copy ? copy.offsetTop : h) / h - 0.03);
  const [x0, x1] = wide ? [copyRight(copy, w), 0.98] : [0.08, 0.92];
  const visH = Math.max(HAND.h / Math.max(0.3, bottom - top), HAND.w / ((x1 - x0) * aspect));
  return {
    dist: visH / (2 * Math.tan(THREE.MathUtils.degToRad(15))),
    lookX: HAND.cx - ((x0 + x1) / 2 - 0.5) * visH * aspect,
    lookY: HAND.cy + RIG_Y + ((top + bottom) / 2 - 0.5) * visH,
  };
}

export function createReading(canvas, { onReading, anchors = [] } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  } catch {
    canvas.parentElement?.classList.add('no-webgl');
    return { setProgress() {}, dispose() {}, intro() {} };
  }
  const reduced = prefersReducedMotion();
  const stage = canvas.closest('.hero-sticky');
  const copy = stage?.querySelector('.hero-copy');
  const hud = stage?.querySelector('.hud');
  const color = (name, fallback) => new THREE.Color(cssVar(name) || fallback);
  const ground = color('--ground', '#E3EBF0');
  const ink = color('--ink', '#0F1B2D');
  const rose = color('--rose', '#E0457B');
  let dpr = Math.min(window.devicePixelRatio, PERF.dprMax);
  renderer.setPixelRatio(dpr);
  renderer.toneMapping = THREE.NeutralToneMapping;

  const scene = new THREE.Scene();
  scene.background = ground;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 120);
  const disposables = [env, pmrem];
  const keep = (x) => (disposables.push(x), x);

  // Printed dial behind the hand: opaque, so the glass refracts its ink.
  const dialTex = keep(new THREE.CanvasTexture(drawDial({ ground: `#${ground.getHexString()}`, ink: `#${ink.getHexString()}`, fence: FENCE })));
  dialTex.colorSpace = THREE.SRGBColorSpace;
  dialTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  // The plane is 3x the print and clamp-to-edge stretches the print's rim over the rest, so a camera pulled far
  // back on a near-square window never finds the dial's border (a grey block with a hard edge).
  dialTex.repeat.set(3, 3);
  dialTex.offset.set(-1, -1);
  const dial = new THREE.Mesh(keep(new THREE.PlaneGeometry(DIAL.size * 3, DIAL.size * 3)), keep(new THREE.MeshBasicMaterial({ map: dialTex, toneMapped: false })));
  dial.position.z = -3;
  const rig = new THREE.Group(); // dial + hand share the wrist as origin
  scene.add(rig);
  rig.add(dial);

  // Live needle and peak tick on the dial.
  const needleGeo = keep(new THREE.BoxGeometry(0.06, DIAL.rOuter, 0.02).translate(0, DIAL.rOuter / 2, 0));
  const needleMat = keep(new THREE.MeshBasicMaterial({ color: rose.clone().multiplyScalar(1.5) }));
  const needle = new THREE.Mesh(needleGeo, needleMat);
  needle.position.z = -2.95;
  const peakGeo = keep(new THREE.BoxGeometry(0.05, 0.7, 0.02).translate(0, DIAL.rOuter - 0.2, 0));
  const peak = new THREE.Mesh(peakGeo, keep(new THREE.MeshBasicMaterial({ color: ink })));
  peak.position.z = -2.95;
  rig.add(needle, peak);
  const shadowMat = keep(new THREE.MeshBasicMaterial({ map: keep(blobTexture('15,27,45', 0.22)), transparent: true, depthWrite: false }));
  const glowMat = keep(new THREE.MeshBasicMaterial({ map: keep(blobTexture('224,69,123', 0.28)), transparent: true, depthWrite: false }));
  const shadow = new THREE.Mesh(keep(new THREE.PlaneGeometry(8, 9)), shadowMat);
  shadow.position.set(0.6, 2.6, -2.97);
  const caustic = new THREE.Mesh(keep(new THREE.PlaneGeometry(5, 5)), glowMat);
  caustic.position.set(0.2, 3.4, -2.96);
  rig.add(shadow, caustic);

  // The hand: glass beads per landmark, glass bones, a glass palm, rose light inside.
  const hand = new THREE.Group();
  rig.add(hand);
  const beadGlass = keep(glassMaterial(0.9));
  const boneGlass = keep(glassMaterial(0.5));
  const tendonMat = keep(new THREE.MeshBasicMaterial({ color: rose.clone() }));
  const sphere = keep(new THREE.SphereGeometry(1, 48, 32));
  const core = keep(new THREE.SphereGeometry(0.075, 20, 14));
  const rest = landmarks(0);
  const beads = rest.map((p, i) => {
    const m = new THREE.Mesh(sphere, beadGlass);
    m.userData.r = radius(i);
    if (TIPS.includes(i)) {
      const dot = new THREE.Mesh(core, tendonMat);
      dot.scale.setScalar(1 / m.userData.r); // world-size core inside a scaled bead
      m.add(dot);
    }
    hand.add(m);
    return m;
  });
  const bones = BONES.map(([a, b]) => {
    const len = Math.hypot(...rest[a].map((v, k) => v - rest[b][k]));
    const m = new THREE.Mesh(keep(new THREE.CapsuleGeometry(0.12, Math.max(0.01, len - 0.24), 6, 20)), boneGlass);
    const palmEdge = a === 0 || (a % 4 === 1 && b % 4 === 1);
    if (!palmEdge) m.add(new THREE.Mesh(keep(new THREE.CapsuleGeometry(0.035, len * 0.7, 4, 10)), tendonMat));
    hand.add(m);
    return m;
  });
  const palmPts = [0, 17, 13, 9, 5, 1].map((i) => new THREE.Vector2(rest[i][0], rest[i][1]));
  const centroid = palmPts.reduce((s, p) => s.add(p), new THREE.Vector2()).multiplyScalar(1 / palmPts.length);
  const shape = new THREE.Shape().setFromPoints(new THREE.SplineCurve([...palmPts, palmPts[0]].map((p) => p.clone().lerp(centroid, 0.16))).getPoints(64));
  const palmGeo = keep(new THREE.ExtrudeGeometry(shape, { depth: 0.22, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.14, bevelSegments: 5, curveSegments: 48 }).translate(0, 0, -0.22));
  const palmGlass = keep(glassMaterial(0.7));
  hand.add(new THREE.Mesh(palmGeo, palmGlass));
  // Skins: the clear acrylic hand, or the `zaliff` easter egg (Mushoku Tensei's stone prosthesis, faint blue sigil light).
  const glow = rose.clone();
  const glassy = [beadGlass, boneGlass, palmGlass];
  const SKINS = {
    glass: { glow: rose, mat: { transmission: 1, roughness: 0.05, metalness: 0, iridescence: 0.5, clearcoat: 1, color: 0xffffff } },
    zaliff: { glow: new THREE.Color('#7FA8FF'), mat: { transmission: 0, roughness: 0.62, metalness: 0.08, iridescence: 0, clearcoat: 0.25, color: 0x8c9096 } },
  };
  const roseLight = new THREE.PointLight(rose, 0, 9, 1.6);
  roseLight.position.set(0, 3.6, 1.4);
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(-4, 6, 8);
  scene.add(key, roseLight);

  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  // Threshold above 1: only the HDR tendon light and needle bloom, never the light ground (it washed out to white).
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.4, 1.02);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // State: scroll target damped, curl on the needle spring, user offset from drag/keys.
  const k = Number(cssVar('--spring-needle-k')) || 220;
  const c = Number(cssVar('--spring-needle-c')) || 21.4;
  const appear = ORDER.map(() => (reduced ? 1 : 0));
  const s = { target: 0, prog: 0, user: 0, curl: reduced ? STILL_CURL : REST_CURL, vel: 0, peak: 0, px: 0, py: 0, ppx: 0, ppy: 0 };
  let view = { dist: 21, lookX: 0, lookY: 3.2 };
  const tmp = new THREE.Vector3();
  const camFrom = new THREE.Vector3();
  const camTo = new THREE.Vector3();

  function pose(curl, dt) {
    const pts = landmarks(curl);
    beads.forEach((m, i) => {
      m.position.fromArray(pts[i]);
      m.scale.setScalar(m.userData.r * appear[RANK[i]]);
    });
    bones.forEach((m, j) => {
      const [a, b] = BONES[j];
      const pa = beads[a].position;
      const pb = beads[b].position;
      m.position.copy(pa).add(pb).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(UP, tmp.copy(pb).sub(pa).normalize());
      m.scale.setScalar(Math.min(appear[RANK[a]], appear[RANK[b]]));
    });
    const work = clamp(Math.abs(s.vel) * 0.9, 0, 2.2);
    tendonMat.color.copy(glow).multiplyScalar(1.2 + curl * 1.1 + work * 0.5);
    roseLight.intensity = 2 + curl * 7 + work * 3;
    const v = fingerCurls(curl)[1];
    s.peak = Math.max(s.peak, v);
    needle.rotation.z = THREE.MathUtils.degToRad(DIAL.a0 - 90 - DIAL.sweep * v);
    peak.rotation.z = THREE.MathUtils.degToRad(DIAL.a0 - 90 - DIAL.sweep * s.peak);
    caustic.material.opacity = 0.3 + curl * 0.4;
  }

  function frame(dt) {
    s.prog = lerp(s.prog, s.target, 1 - Math.exp(-dt * 6));
    const p = s.prog;
    const goal = reduced ? STILL_CURL : clamp(REST_CURL + smoothstep(0.1, 0.6, p) * 0.9 + s.user, 0, 1);
    if (reduced) s.curl = goal;
    else {
      s.vel += (k * (goal - s.curl) - c * s.vel) * dt;
      s.curl += s.vel * dt;
    }
    pose(clamp(s.curl, 0, 1), dt);
    s.ppx = lerp(s.ppx, s.px, 1 - Math.exp(-dt * 4));
    s.ppy = lerp(s.ppy, s.py, 1 - Math.exp(-dt * 4));
    const orbit = smoothstep(0.12, 0.62, p);
    hand.rotation.set(lerp(0.16, 0.04, orbit) + s.ppy * 0.18, lerp(-0.5, -1.32, orbit) + s.ppx * 0.35, lerp(0.06, 0, orbit));
    // Camera: framed on the hand and dial, then dives to the index finger's middle joint.
    const dive = smoothstep(0.62, 1, p);
    camFrom.set(view.lookX, view.lookY + 0.15, view.dist);
    beads[6].getWorldPosition(camTo);
    camTo.add(tmp.set(0.9, 0.2, 4.6));
    camera.position.lerpVectors(camFrom, camTo, dive * 0.8);
    camera.position.x += s.ppx * 0.4 * (1 - dive);
    camera.position.y += s.ppy * 0.3 * (1 - dive);
    camera.lookAt(tmp.set(lerp(view.lookX, camTo.x - 0.9, dive), lerp(view.lookY, camTo.y - 0.2, dive), lerp(0, camTo.z - 4.6, dive)));
    camera.fov = lerp(30, 24, dive);
    camera.updateProjectionMatrix();
    composer.render(dt);
    placeAnchors();
  }

  const emit = () => onReading?.({ curls: fingerCurls(clamp(s.curl, 0, 1)), peak: s.peak, curl: clamp(s.curl, 0, 1) });

  function placeAnchors() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    anchors.forEach(({ i, el }) => {
      beads[i].getWorldPosition(tmp).project(camera);
      el.style.transform = `translate3d(${((tmp.x + 1) / 2) * w}px, ${((1 - tmp.y) / 2) * h}px, 0)`;
    });
  }

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    view = frameFor(w, h, copy, hud);
    rig.position.set(0, RIG_Y, 0);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(dpr);
    composer.setSize(w, h);
    bloom.resolution.set(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (reduced || !running) { frame(1 / 60); emit(); }
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  // Direct manipulation: drag or arrow keys curl the hand; pointer parallaxes.
  let drag = null;
  const down = (e) => { drag = { y: e.clientY, u: s.user }; canvas.setPointerCapture?.(e.pointerId); };
  const move = (e) => {
    const r = canvas.getBoundingClientRect();
    s.px = ((e.clientX - r.left) / r.width) * 2 - 1;
    s.py = ((e.clientY - r.top) / r.height) * 2 - 1;
    if (drag) s.user = clamp(drag.u + ((e.clientY - drag.y) / r.height) * 1.6, -1, 1);
  };
  const up = () => { drag = null; };
  const keys = (e) => {
    const step = { ArrowDown: 0.1, ArrowUp: -0.1 }[e.key];
    if (step) { s.user = clamp(s.user + step, -1, 1); e.preventDefault(); }
    if (e.key === 'Home') s.user = 0;
  };
  canvas.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move, { passive: true });
  window.addEventListener('pointerup', up);
  canvas.addEventListener('keydown', keys);

  // Loop on the GSAP clock; pause offscreen or hidden; degrade DPR once if slow.
  let running = false;
  let visible = true;
  let n = 0;
  let acc = 0;
  let degraded = false;
  const tick = (time, deltaMs) => {
    const dt = Math.min(deltaMs / 1000, 1 / 20);
    frame(dt);
    if (n % 3 === 0) emit();
    n += 1;
    if (!degraded && n <= PERF.sampleFrames) {
      acc += deltaMs;
      if (n === PERF.sampleFrames && acc / n > PERF.degradeFrameMs) {
        degraded = true;
        dpr = PERF.dprDegraded;
        renderer.setPixelRatio(dpr);
        resize();
      }
    }
  };
  const sync = () => {
    const want = visible && !document.hidden && !reduced;
    if (want && !running) gsap.ticker.add(tick);
    if (!want && running) gsap.ticker.remove(tick);
    running = want;
  };
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; sync(); });
  io.observe(canvas);
  document.addEventListener('visibilitychange', sync);
  resize();
  sync();

  return {
    setProgress(p) { s.target = clamp(p, 0, 1); if (reduced) { frame(1 / 60); emit(); } },
    setSkin(name) {
      const skin = SKINS[name] ?? SKINS.glass;
      glow.copy(skin.glow);
      roseLight.color.copy(skin.glow);
      glassy.forEach((m) => { const { color, ...rest } = skin.mat; Object.assign(m, rest); m.color.set(color); m.needsUpdate = true; });
      if (reduced) { frame(1 / 60); emit(); }
    },
    // Landmarks assemble from the wrist outward, then the hand settles open.
    intro() {
      if (reduced) return Promise.resolve();
      const ease = gsap.parseEase('expo.out');
      const total = INTRO.delay + INTRO.each + INTRO.stagger * (ORDER.length - 1);
      const clock = { t: 0 };
      return new Promise((resolve) => {
        gsap.to(clock, {
          t: total, duration: total, ease: 'none', onComplete: resolve,
          onUpdate: () => ORDER.forEach((_, slot) => { appear[slot] = ease(clamp((clock.t - INTRO.delay - slot * INTRO.stagger) / INTRO.each, 0, 1)); }),
        });
      });
    },
    dispose() {
      gsap.ticker.remove(tick);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', sync);
      canvas.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      canvas.removeEventListener('keydown', keys);
      disposables.forEach((d) => d.dispose?.());
      composer.dispose();
      renderer.dispose();
    },
  };
}
