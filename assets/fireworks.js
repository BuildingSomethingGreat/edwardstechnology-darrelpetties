// Hero fireworks — three.js Points, one draw call, palette-matched to the site.
//
// Self-starting ES module: it finds [data-fireworks] inside the opener section and
// renders behind the hero copy. The hero is position:fixed, so scrolling never moves
// it out of the viewport — an IntersectionObserver would report it visible forever.
// The loop therefore parks itself on scroll position instead, and on tab visibility.
//
// Physics runs on the CPU over a fixed pool (positions/colors/alpha live in typed
// arrays uploaded once per frame); the GPU only draws soft additive points.

import {
  WebGLRenderer, Scene, OrthographicCamera, Points, BufferGeometry,
  BufferAttribute, ShaderMaterial, AdditiveBlending, Color,
} from './vendor/three.module.min.js';

// Cream, gold, amber, bronze — the same ramp the wordmark and eyebrows use.
const PALETTE = ['#EFE9DE', '#EFE9DE', '#D9BE93', '#D9BE93', '#C88B45', '#8A6A34'];

const GRAVITY = 230;      // px/s², tuned so a burst hangs for about a second
const DRAG_K = 1.15;      // air resistance, e^(-k*dt) so it is framerate independent
const TRAIL_EVERY = 0.016;

const VERT = `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uDpr;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uDpr;
  }
`;

const FRAG = `
  precision mediump float;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    // Soft round sprite, no texture needed: a falloff on the point coord.
    float r = length(gl_PointCoord - vec2(0.5)) * 2.0;
    if (r > 1.0) discard;
    float core = 1.0 - r;
    float glow = pow(core, 1.6);
    gl_FragColor = vec4(vColor * (0.62 + 0.85 * glow), vAlpha * glow);
  }
`;

const rand = (a, b) => a + Math.random() * (b - a);

function start(host) {
  const MOBILE = Math.min(window.innerWidth, window.innerHeight) < 700;
  const MAX = MOBILE ? 700 : 1500;

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
  host.appendChild(canvas);

  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power' });
  } catch (err) {
    canvas.remove();
    return null;
  }
  renderer.setClearAlpha(0);

  const scene = new Scene();
  let w = host.clientWidth || window.innerWidth;
  let h = host.clientHeight || window.innerHeight;
  // Pixel-space camera with y running down the screen, so the physics below reads
  // in the same units as the layout.
  const camera = new OrthographicCamera(0, w, 0, h, -1, 1);

  const positions = new Float32Array(MAX * 3);
  const colors = new Float32Array(MAX * 3);
  const sizes = new Float32Array(MAX);
  const alphas = new Float32Array(MAX);
  const vx = new Float32Array(MAX);
  const vy = new Float32Array(MAX);
  const life = new Float32Array(MAX);
  const maxLife = new Float32Array(MAX);
  const kind = new Uint8Array(MAX); // 0 dead, 1 rocket, 2 spark, 3 trail
  const targetY = new Float32Array(MAX);

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new BufferAttribute(sizes, 1));
  geometry.setAttribute('aAlpha', new BufferAttribute(alphas, 1));

  const material = new ShaderMaterial({
    uniforms: { uDpr: { value: 1 } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: AdditiveBlending,
  });

  const points = new Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);

  const tint = new Color();
  let cursor = 0;

  function spawn() {
    // Ring buffer: the oldest slot is the least missed if we ever run dry.
    for (let i = 0; i < MAX; i++) {
      const idx = (cursor + i) % MAX;
      if (kind[idx] === 0) { cursor = (idx + 1) % MAX; return idx; }
    }
    const idx = cursor;
    cursor = (cursor + 1) % MAX;
    return idx;
  }

  function put(i, x, y, dx, dy, size, secs, hex, k) {
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = 0;
    tint.set(hex);
    colors[i * 3] = tint.r;
    colors[i * 3 + 1] = tint.g;
    colors[i * 3 + 2] = tint.b;
    vx[i] = dx;
    vy[i] = dy;
    sizes[i] = size;
    alphas[i] = 1;
    life[i] = secs;
    maxLife[i] = secs;
    kind[i] = k;
  }

  function launch() {
    const i = spawn();
    const x = rand(w * 0.16, w * 0.84);
    const hex = PALETTE[(Math.random() * PALETTE.length) | 0];
    put(i, x, h + 12, rand(-26, 26), rand(-720, -560), 4.6, 4, hex, 1);
    targetY[i] = rand(h * 0.12, h * 0.4);
  }

  function burst(x, y, hex) {
    const f = spawn();
    put(f, x, y, 0, 0, 74, 0.26, '#EFE9DE', 4); // flash, kind 4: no gravity
    const n = MOBILE ? ((rand(46, 68)) | 0) : ((rand(92, 140)) | 0);
    const speed = rand(230, 540);
    const secs = rand(1.3, 2.3);
    for (let k = 0; k < n; k++) {
      const i = spawn();
      const a = Math.random() * Math.PI * 2;
      // sqrt keeps the burst shell-weighted rather than clumping at the centre
      const m = speed * (0.35 + 0.65 * Math.sqrt(Math.random()));
      const c = Math.random() < 0.22 ? '#EFE9DE' : hex;
      put(i, x, y, Math.cos(a) * m, Math.sin(a) * m * 0.92, rand(3.4, 6.6), secs * rand(0.7, 1), c, 2);
    }
  }

  let trailClock = 0;
  let next = rand(0.4, 1.1);
  let last = performance.now();
  let raf = 0;
  let paused = false;

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (paused) return;

    const decay = Math.exp(-DRAG_K * dt);

    next -= dt;
    if (next <= 0) {
      launch();
      // Every so often a second shell chases the first.
      if (Math.random() < 0.22) setTimeout(launch, 240);
      next = rand(1.6, 3.2);
    }
    trailClock += dt;
    const dropTrail = trailClock >= TRAIL_EVERY;
    if (dropTrail) trailClock = 0;

    for (let i = 0; i < MAX; i++) {
      const k = kind[i];
      if (k === 0) continue;

      life[i] -= dt;
      if (life[i] <= 0) { kind[i] = 0; alphas[i] = 0; sizes[i] = 0; continue; }

      const p = i * 3;
      if (k === 1) {
        vy[i] += GRAVITY * 0.92 * dt;
        positions[p] += vx[i] * dt;
        positions[p + 1] += vy[i] * dt;
        alphas[i] = 1;
        if (dropTrail) {
          const t = spawn();
          put(t, positions[p] + rand(-1.5, 1.5), positions[p + 1] + rand(0, 6),
              rand(-14, 14), rand(8, 40), rand(1.7, 3.0), rand(0.28, 0.55), '#D9BE93', 3);
        }
        // Apex, or the height it was aiming for — whichever lands first.
        if (vy[i] >= -40 || positions[p + 1] <= targetY[i]) {
          tint.setRGB(colors[p], colors[p + 1], colors[p + 2]);
          burst(positions[p], positions[p + 1], '#' + tint.getHexString());
          kind[i] = 0;
          alphas[i] = 0;
          sizes[i] = 0;
        }
      } else {
        if (k === 4) {
          const t4 = life[i] / maxLife[i];
          sizes[i] = 74 * (0.35 + 0.65 * t4);
          alphas[i] = t4 * t4 * 0.5;
          continue;
        }
        vy[i] += GRAVITY * dt;
        vx[i] *= decay;
        vy[i] *= decay;
        positions[p] += vx[i] * dt;
        positions[p + 1] += vy[i] * dt;
        const t = life[i] / maxLife[i];
        // Late fade with a flicker on the sparks, so embers twinkle out.
        alphas[i] = k === 2 ? t * t * (0.78 + 0.22 * Math.sin(now * 0.02 + i)) : t * 0.5;
      }
    }

    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.aColor.needsUpdate = true;
    geometry.attributes.aSize.needsUpdate = true;
    geometry.attributes.aAlpha.needsUpdate = true;
    renderer.render(scene, camera);
  }

  function resize() {
    w = host.clientWidth || window.innerWidth;
    h = host.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    camera.right = w;
    camera.bottom = h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    material.uniforms.uDpr.value = dpr;
  }

  // The hero is fixed, so "off screen" is a scroll question, not an intersection one.
  function updatePaused() {
    paused = document.hidden || window.scrollY > window.innerHeight * 0.9;
  }

  resize();
  updatePaused();
  raf = requestAnimationFrame(frame);

  const ro = new ResizeObserver(resize);
  ro.observe(host);
  window.addEventListener('scroll', updatePaused, { passive: true });
  document.addEventListener('visibilitychange', updatePaused);
  // A lost context would otherwise leave a blank canvas spinning a dead loop.
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); cancelAnimationFrame(raf); });

  return {
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('scroll', updatePaused);
      document.removeEventListener('visibilitychange', updatePaused);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}

function boot() {
  if (window.__heroFireworks) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const host = document.querySelector('[data-fireworks]');
  if (!host) return;
  window.__heroFireworks = start(host) || undefined;
}

// The host arrives with the bundler's render swap, which may land after this module
// evaluates — poll briefly rather than racing it.
let tries = 0;
(function waitForHost() {
  boot();
  if (!window.__heroFireworks && tries++ < 120) requestAnimationFrame(waitForHost);
})();
