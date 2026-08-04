/* three + care-core load lazily in boot() — a home or pricing visit never
   fetches them; only a service page does. */
let THREE = null, createServiceScenes = null, getCameraGoal = null, SERVICES = null;

/*
 * Build 35 — the per-service care scenes, on their own pages.
 *
 * One diorama per NDIS service, from Bee's FIXED preview
 * (Care_Services_Preview_FIXED.html / review/fixed/care-core.local.js).
 * This runtime is the site-side twin of the preview's runtime.js: the same
 * renderer settings, the same fog and four-light rig, the same isometric
 * camera goal chase, the same prime-to-0.65s entry — minus the preview's
 * chrome (tabs, tour, view switcher). Each service page pins its own scene.
 *
 * Site disciplines (the care-motion rules apply here too):
 *  - one shared renderer; the canvas is re-parented into the visible page's
 *    stage, because only one service page exists on screen at a time;
 *  - the loop runs only while a service page is the active route, its stage
 *    is near the viewport, and the tab is visible;
 *  - reduce motion = one primed still frame, watched in BOTH directions;
 *  - high contrast / print hide the whole section (CSS);
 *  - any failure before the first scene builds leaves `care-stages-ready`
 *    unset, so the sections simply never appear (headless test browsers,
 *    no-WebGL devices — zero layout change, zero errors surfaced).
 */

const rootEl = document.documentElement;

/* site route slug → care-core service id */
const ROUTE_SERVICE = {
  'employment': 'employment',
  'personal-care': 'personal-care',
  'transport': 'travel-transport',
  'daily-tasks': 'shared-living',
  'household': 'household',
  'community': 'community',
};
const ENTRY_TIME = 0.65; /* the preview's own starting moment */

function routeService() {
  const segs = (location.hash || '').replace(/^#\/?/, '').split(/[/?]/);
  return (segs[0] === 'services' && ROUTE_SERVICE[segs[1]]) || null;
}
function reduceMotion() {
  return rootEl.getAttribute('data-motion') === 'reduce'
    || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}
function highContrast() { return rootEl.classList.contains('high-contrast'); }

let booted = false, engine = null;

async function boot() {
  if (booted) return;
  booted = true;
  try {
    const [three, care] = await Promise.all([
      import('./three.module.min.js'),
      import('./care-core.local.js'),
    ]);
    THREE = three;
    createServiceScenes = care.createServiceScenes;
    getCameraGoal = care.getCameraGoal;
    SERVICES = care.SERVICES;
    engine = createEngine();
  } catch (error) {
    /* no WebGL, no scenes — the sections stay display:none */
    engine = null;
  }
  if (engine) {
    rootEl.classList.add('care-stages-ready');
    engine.syncRoute();
  }
}

function createEngine() {
  const hosts = new Map(); /* service id → .care-stage element */
  document.querySelectorAll('.care-stage-block[data-care-stage]').forEach(block => {
    const stage = block.querySelector('.care-stage');
    if (stage) hosts.set(block.getAttribute('data-care-stage'), stage);
  });
  if (!hosts.size) throw new Error('no stages');

  /* ---- the preview runtime's exact stage ---- */
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.98;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute('aria-hidden', 'true');

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xf4efe7, 0.0048);
  const camera = new THREE.OrthographicCamera(-30, 30, 22, -22, 0.1, 260);
  let cameraAspect = 1.6, orthoHalfHeight = 20;
  const targetMatrix = new THREE.Matrix4();
  const targetQuaternion = new THREE.Quaternion();

  const hemisphere = new THREE.HemisphereLight(0xfbf7ee, 0x6e8d87, 2.25);
  const key = new THREE.DirectionalLight(0xfff0d8, 4.2);
  key.position.set(-10, 18, 12);
  key.castShadow = true;
  key.shadow.mapSize.set(1536, 1536);
  key.shadow.camera.left = -72; key.shadow.camera.right = 72;
  key.shadow.camera.top = 52; key.shadow.camera.bottom = -52;
  key.shadow.camera.near = 0.5; key.shadow.camera.far = 130;
  key.shadow.bias = -0.00035;
  const fill = new THREE.DirectionalLight(0x9dc6d4, 1.15);
  fill.position.set(14, 8, -10);
  const rim = new THREE.DirectionalLight(0xd8b3c5, 0.72);
  rim.position.set(3, 10, -15);
  scene.add(hemisphere, key, fill, rim);

  const serviceScenes = new Map();
  function ensureServiceScene(id) {
    if (serviceScenes.has(id)) return serviceScenes.get(id);
    const created = createServiceScenes(scene, id);
    const serviceScene = created.get(id);
    if (!serviceScene) throw new Error('Unable to create service scene: ' + id);
    serviceScene.root.visible = false;
    serviceScenes.set(id, serviceScene);
    return serviceScene;
  }

  let activeId = null, activeScene = null, activeHost = null, localTime = 0;

  function primeScene(sceneObject, targetTime) {
    sceneObject.reset();
    const target = Math.max(0, Math.min(targetTime, sceneObject.duration - 0.001));
    let t = 0;
    const step = 1 / 45;
    while (t + step < target) { t += step; sceneObject.update(t, step); }
    const remainder = target - t;
    if (remainder > 0) sceneObject.update(target, remainder);
  }

  function resize() {
    if (!activeHost) return;
    const width = Math.max(1, activeHost.clientWidth);
    const height = Math.max(1, activeHost.clientHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, width < 720 ? 1.15 : 1.5));
    renderer.setSize(width, height, false);
    cameraAspect = width / height;
    const goal = getCameraGoal('isometric', cameraAspect, activeId || 'employment');
    orthoHalfHeight = goal.orthoHalfHeight || 18;
    camera.left = -orthoHalfHeight * cameraAspect;
    camera.right = orthoHalfHeight * cameraAspect;
    camera.top = orthoHalfHeight;
    camera.bottom = -orthoHalfHeight;
    camera.updateProjectionMatrix();
  }

  let firstFrame = true;
  function aim(rawDelta) {
    const goal = getCameraGoal('isometric', cameraAspect, activeId || 'employment');
    const blend = firstFrame ? 1 : 1 - Math.exp(-Math.max(rawDelta, 0.016) * 4.2);
    camera.position.lerp(goal.position, blend);
    orthoHalfHeight = THREE.MathUtils.lerp(orthoHalfHeight, goal.orthoHalfHeight, blend);
    camera.left = -orthoHalfHeight * cameraAspect;
    camera.right = orthoHalfHeight * cameraAspect;
    camera.top = orthoHalfHeight;
    camera.bottom = -orthoHalfHeight;
    targetMatrix.lookAt(camera.position, goal.target, camera.up);
    targetQuaternion.setFromRotationMatrix(targetMatrix);
    camera.quaternion.slerp(targetQuaternion, blend);
    camera.updateProjectionMatrix();
    firstFrame = false;
  }

  function paint(rawDelta) { aim(rawDelta); renderer.render(scene, camera); }

  function activate(id) {
    const host = hosts.get(id);
    if (!host) return false;
    ensureServiceScene(id); /* may throw on very first call — caught by boot */
    serviceScenes.forEach(s => { s.root.visible = false; });
    activeId = id;
    activeScene = serviceScenes.get(id);
    activeScene.root.visible = true;
    if (activeHost !== host) { host.appendChild(renderer.domElement); activeHost = host; }
    localTime = Math.max(0, Math.min(ENTRY_TIME, activeScene.duration - 0.001));
    primeScene(activeScene, localTime);
    firstFrame = true;
    resize();
    paint(0.016);
    return true;
  }

  /* ---- run/pause management ---- */
  let rafId = 0, stageOnScreen = true;
  const clock = new THREE.Clock();
  function shouldRun() {
    return !!activeScene && routeService() === activeId && stageOnScreen
      && !document.hidden && !reduceMotion() && !highContrast();
  }
  function tick() {
    rafId = 0;
    if (!shouldRun()) return;
    const rawDelta = Math.min(clock.getDelta(), 0.05);
    localTime += rawDelta;
    if (localTime >= activeScene.duration) { localTime %= activeScene.duration; activeScene.reset(); }
    activeScene.update(localTime, rawDelta);
    paint(rawDelta);
    rafId = requestAnimationFrame(tick);
  }
  function wake() {
    if (rafId || !shouldRun()) return;
    clock.getDelta();
    rafId = requestAnimationFrame(tick);
  }

  function syncRoute() {
    const id = routeService();
    if (!id || !hosts.has(id)) return; /* not a service page — loop simply stops */
    if (id !== activeId) activate(id);
    else { resize(); paint(0.016); }
    wake();
  }

  /* every listener registered unconditionally (the v57 lesson) */
  window.addEventListener('hashchange', () => setTimeout(syncRoute, 0));
  window.addEventListener('resize', () => { if (activeHost) { resize(); paint(0.016); wake(); } }, { passive: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
  const media = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  if (media && media.addEventListener) media.addEventListener('change', () => { wake(); if (activeScene) paint(0.016); });
  new MutationObserver(() => { wake(); }).observe(rootEl, { attributes: true, attributeFilter: ['class', 'data-motion'] });
  if (typeof IntersectionObserver === 'function') {
    const io = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.target === activeHost) { stageOnScreen = entry.isIntersecting; if (stageOnScreen) wake(); }
      });
    }, { rootMargin: '200px 0px', threshold: [0, 0.05] });
    hosts.forEach(host => io.observe(host));
  }

  const api = { syncRoute, activate, wake, resize };
  /* deterministic hooks for drives */
  window.__careStages = {
    state() {
      return { ready: true, service: activeId, running: !!rafId, time: +localTime.toFixed(2),
               duration: activeScene ? activeScene.duration : 0, onScreen: stageOnScreen };
    },
    show(id) { if (hosts.has(id)) { activate(id); wake(); } return activeId; },
    prime(t) { if (!activeScene) return null; localTime = Math.max(0, Math.min(t, activeScene.duration - 0.001)); primeScene(activeScene, localTime); firstFrame = true; paint(0.016); return localTime; },
    services: SERVICES.filter(s => s.id !== 'all').map(s => s.id),
  };
  return api;
}

/* Boot lazily: only once a service page is actually visited. */
function maybeBoot() {
  if (booted || !routeService()) return;
  /* Automated browsers (test suites) skip the stages entirely: their
     software-GL path can stall page screenshots. Dev drives opt back in
     with window.__careAllow before load. */
  if (navigator.webdriver && !window.__careAllow) return;
  setTimeout(boot, 250);
}
window.addEventListener('hashchange', () => { maybeBoot(); });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', maybeBoot, { once: true });
else maybeBoot();
