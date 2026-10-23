// Shared plumbing for Flexion's WebGL set-pieces: one renderer, studio light,
// selective bloom, the acrylic material, and the house rules (DPR cap + one-time
// degrade, offscreen/hidden pause, reduced motion renders on demand, full dispose).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { gsap } from 'gsap';
import { PERF } from '../config.js';
import { prefersReducedMotion } from '../core/env.js';

export function glassMaterial(thickness, extra = {}) {
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.05, metalness: 0, transmission: 1, thickness, ior: 1.47,
    dispersion: 3, iridescence: 0.5, iridescenceIOR: 1.3, iridescenceThicknessRange: [120, 480],
    clearcoat: 1, clearcoatRoughness: 0.03, attenuationColor: new THREE.Color('#c9dfeb'),
    attenuationDistance: 2.6, specularIntensity: 1, envMapIntensity: 1.4, ...extra,
  });
}

export function blobTexture(rgb, alpha) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, `rgba(${rgb},${alpha})`);
  grad.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A printed backdrop: draw(ctx, pxPerUnit, w, h) onto a canvas mapped to a plane.
export function printedPlane(studio, { width, height, px = 2048, z = -1, draw }) {
  const c = document.createElement('canvas');
  c.width = px;
  c.height = Math.round((px * height) / width);
  draw(c.getContext('2d'), px / width, c.width, c.height);
  const tex = studio.keep(new THREE.CanvasTexture(c));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = studio.renderer.capabilities.getMaxAnisotropy();
  const mesh = new THREE.Mesh(studio.keep(new THREE.PlaneGeometry(width, height)), studio.keep(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }))); // print = exact ground colour, so its edge never shows
  mesh.position.z = z;
  return mesh;
}

// The band of a pinned stage left free between its copy (top) and readout (bottom), as fractions of the height,
// measured from the layout so the scene never sits under text. `reserve` px keeps room for a readout that grows.
export function freeBand(canvas, reserve = 0) {
  const col = canvas.parentElement?.querySelector('.piece-col');
  const copy = col?.querySelector('.piece-copy');
  const readout = col?.querySelector('.readout');
  const h = canvas.clientHeight;
  if (!copy || !readout || !h) return { top: 0.15, bottom: 0.85 };
  const top = (col.offsetTop + copy.offsetTop + copy.offsetHeight) / h + 0.02;
  const bottom = (col.offsetTop + readout.offsetTop - reserve) / h - 0.02;
  return { top, bottom: Math.max(bottom, top + 0.2) };
}

export function createStudio(canvas, { background, bloom = [0.85, 0.55, 0.95], fov = 30 } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  } catch {
    canvas.parentElement?.classList.add('no-webgl');
    return null;
  }
  const reduced = prefersReducedMotion();
  let dpr = Math.min(window.devicePixelRatio, PERF.dprMax);
  renderer.setPixelRatio(dpr);
  renderer.toneMapping = THREE.NeutralToneMapping;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 200);
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), ...bloom);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  const disposables = [env, pmrem];
  const keep = (x) => (disposables.push(x), x);
  const size = { w: 0, h: 0 };
  let onFrame = () => {};
  let onResize = () => {};
  let running = false;
  let visible = false;

  const render = (dt = 1 / 60) => {
    if (!size.w) return;
    onFrame(dt);
    composer.render(dt);
  };
  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return; // hidden or zero-size viewport
    size.w = w;
    size.h = h;
    renderer.setSize(w, h, false);
    composer.setPixelRatio(dpr);
    composer.setSize(w, h);
    bloomPass.resolution.set(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    onResize(w, h);
    if (!running) render();
  }

  let n = 0;
  let acc = 0;
  let degraded = false;
  const tick = (time, deltaMs) => {
    render(Math.min(deltaMs / 1000, 1 / 20));
    n += 1;
    if (degraded || n > PERF.sampleFrames) return;
    acc += deltaMs;
    if (n === PERF.sampleFrames && acc / n > PERF.degradeFrameMs) {
      degraded = true;
      dpr = PERF.dprDegraded;
      renderer.setPixelRatio(dpr);
      resize();
    }
  };
  const sync = () => {
    const want = visible && !document.hidden && !reduced;
    if (want && !running) gsap.ticker.add(tick);
    if (!want && running) gsap.ticker.remove(tick);
    running = want;
  };
  const ro = new ResizeObserver(resize);
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; sync(); });

  return {
    scene, camera, renderer, keep, reduced, size, render,
    frame(fn) { onFrame = fn; },
    resized(fn) { onResize = fn; },
    start() {
      ro.observe(canvas);
      io.observe(canvas);
      document.addEventListener('visibilitychange', sync);
      resize();
    },
    dispose() {
      gsap.ticker.remove(tick);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', sync);
      scene.traverse((o) => { o.geometry?.dispose?.(); });
      disposables.forEach((d) => d.dispose?.());
      composer.dispose();
      renderer.dispose();
    },
  };
}
