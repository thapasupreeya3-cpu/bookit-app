/* BookIt v65 service explainers.
 *
 * The photograph and text are the dependable experience. Three.js is an
 * optional, user-triggered enhancement: one renderer, one active scene, no
 * animation on reduced-motion/high-contrast/save-data visits, and no hidden
 * route heartbeat.
 */
let THREE = null;
let createServiceScenes = null;
let getCameraGoal = null;
let SERVICES = null;

const rootEl = document.documentElement;
const ROUTE_SERVICE = {
  employment: 'employment',
  'personal-care': 'personal-care',
  transport: 'travel-transport',
  'daily-tasks': 'shared-living',
  household: 'household',
  community: 'community',
};
const TARGET_SECONDS = {
  employment: 18,
  'personal-care': 18,
  'travel-transport': 14,
  'shared-living': 20,
  household: 16,
  community: 17,
};

function routeService() {
  const parts = (location.hash || '').replace(/^#\/?/, '').split(/[/?]/);
  return parts[0] === 'services' ? ROUTE_SERVICE[parts[1]] || null : null;
}
function reducedMotion() {
  return rootEl.getAttribute('data-motion') === 'reduce'
    || !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}
function forcedColours() {
  return rootEl.classList.contains('high-contrast')
    || !!(window.matchMedia && window.matchMedia('(forced-colors: active)').matches);
}
function saveData() { return !!(navigator.connection && navigator.connection.saveData); }
let webGLSupport;
function hasWebGL() {
  if (webGLSupport !== undefined) return webGLSupport;
  try {
    const probe = document.createElement('canvas');
    webGLSupport = !!(probe.getContext('webgl2') || probe.getContext('webgl'));
  } catch (error) { webGLSupport = false; }
  return webGLSupport;
}
function mayAnimate() { return hasWebGL() && !reducedMotion() && !forcedColours() && !saveData(); }

let bootPromise = null;
let engine = null;

async function boot() {
  if (engine) return engine;
  if (!mayAnimate()) return null;
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
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
      return engine;
    } catch (error) {
      console.warn('BookIt care scene stayed on its poster:', error && error.message ? error.message : error);
      engine = null;
      return null;
    }
  })();
  return bootPromise;
}

function createEngine() {
  const hosts = new Map();
  document.querySelectorAll('.care-stage-block[data-care-stage]').forEach(block => {
    const host = block.querySelector('.care-stage');
    if (host) hosts.set(block.dataset.careStage, host);
  });
  if (!hosts.size) throw new Error('No care-stage hosts found');

  const mobile = matchMedia('(max-width: 699px)').matches;
  const renderer = new THREE.WebGLRenderer({
    antialias: !mobile,
    alpha: true,
    powerPreference: 'high-performance',
    failIfMajorPerformanceCaveat: true,
    preserveDrawingBuffer: false,
  });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.98;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  renderer.domElement.setAttribute('tabindex', '-1');

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xf4efe7, 0.0048);
  const camera = new THREE.OrthographicCamera(-30, 30, 22, -22, 0.1, 260);
  let cameraAspect = 1.6;
  let orthoHalfHeight = 16;
  const targetMatrix = new THREE.Matrix4();
  const targetQuaternion = new THREE.Quaternion();

  const hemisphere = new THREE.HemisphereLight(0xfbf7ee, 0x6e8d87, 2.25);
  const key = new THREE.DirectionalLight(0xfff0d8, 4.2);
  key.position.set(-10, 18, 12);
  key.castShadow = true;
  key.shadow.mapSize.set(mobile ? 768 : 1024, mobile ? 768 : 1024);
  key.shadow.camera.left = -72; key.shadow.camera.right = 72;
  key.shadow.camera.top = 52; key.shadow.camera.bottom = -52;
  key.shadow.camera.near = 0.5; key.shadow.camera.far = 130;
  key.shadow.bias = -0.00035;
  const fill = new THREE.DirectionalLight(0x9dc6d4, 1.15);
  fill.position.set(14, 8, -10);
  const rim = new THREE.DirectionalLight(0xd8b3c5, 0.72);
  rim.position.set(3, 10, -15);
  scene.add(hemisphere, key, fill, rim);

  let activeId = null;
  let activeScene = null;
  let activeHost = null;
  let localTime = 0;
  let rafId = 0;
  let userPaused = true;
  let stageOnScreen = false;
  let contextLost = false;
  let firstFrame = true;
  let lastChapterUpdate = 0;
  const clock = new THREE.Clock();

  function disposeMaterial(material) {
    if (!material) return;
    Object.values(material).forEach(value => {
      if (value && value.isTexture && value.dispose) value.dispose();
    });
    if (material.dispose) material.dispose();
  }
  function disposeSceneObject(serviceScene) {
    if (!serviceScene) return;
    if (serviceScene.dispose) serviceScene.dispose();
    if (serviceScene.root) {
      scene.remove(serviceScene.root);
      serviceScene.root.traverse(object => {
        if (object.geometry && object.geometry.dispose) object.geometry.dispose();
        if (Array.isArray(object.material)) object.material.forEach(disposeMaterial);
        else disposeMaterial(object.material);
      });
    }
  }
  function createOnlyScene(id) {
    disposeSceneObject(activeScene);
    const created = createServiceScenes(scene, id);
    const next = created.get(id);
    if (!next) throw new Error('Unable to create care scene: ' + id);
    return next;
  }
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
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, width < 700 ? 1 : 1.25));
    renderer.setSize(width, height, false);
    cameraAspect = width / height;
    const goal = getCameraGoal('isometric', cameraAspect, activeId || 'employment');
    orthoHalfHeight = Math.max(8.8, (goal.orthoHalfHeight || 18) * 0.86);
    camera.left = -orthoHalfHeight * cameraAspect;
    camera.right = orthoHalfHeight * cameraAspect;
    camera.top = orthoHalfHeight;
    camera.bottom = -orthoHalfHeight;
    camera.updateProjectionMatrix();
  }
  function aim(rawDelta) {
    const goal = getCameraGoal('isometric', cameraAspect, activeId || 'employment');
    const targetHalfHeight = Math.max(8.8, (goal.orthoHalfHeight || 18) * 0.86);
    const blend = firstFrame ? 1 : 1 - Math.exp(-Math.max(rawDelta, 0.016) * 4.2);
    camera.position.lerp(goal.position, blend);
    orthoHalfHeight = THREE.MathUtils.lerp(orthoHalfHeight, targetHalfHeight, blend);
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
  function paint(rawDelta) {
    if (!activeScene || contextLost) return;
    aim(rawDelta);
    renderer.render(scene, camera);
    activeHost.classList.add('care-stage-live');
    rootEl.classList.add('care-stages-ready');
  }
  function currentBlock() { return activeHost && activeHost.closest('.care-stage-block'); }
  function updateControls() {
    const block = currentBlock();
    if (!block) return;
    const toggle = block.querySelector('[data-care-toggle]');
    if (toggle) {
      toggle.textContent = userPaused ? 'Play' : 'Pause';
      toggle.setAttribute('aria-pressed', userPaused ? 'false' : 'true');
    }
  }
  function updateChapter() {
    const block = currentBlock();
    if (!block) return;
    const buttons = Array.from(block.querySelectorAll('[data-care-seek]'));
    let selected = buttons[0] || null;
    buttons.forEach(button => {
      if (Number(button.dataset.careSeek) <= localTime + 0.02) selected = button;
      button.removeAttribute('aria-current');
    });
    if (selected) selected.setAttribute('aria-current', 'step');
  }
  function activate(id, options = {}) {
    const host = hosts.get(id);
    if (!host) return false;
    if (activeId !== id) {
      try {
        activeScene = createOnlyScene(id);
        activeId = id;
      } catch (error) {
        activeScene = null;
        activeId = null;
        host.classList.remove('care-stage-live');
        console.warn('BookIt care scene stayed on its poster:', error && error.message ? error.message : error);
        return false;
      }
    }
    activeScene.root.visible = true;
    if (activeHost !== host) {
      if (activeHost) activeHost.classList.remove('care-stage-live');
      host.appendChild(renderer.domElement);
      activeHost = host;
    }
    localTime = Math.max(0, Math.min(options.time == null ? 0.65 : options.time, activeScene.duration - 0.001));
    primeScene(activeScene, localTime);
    firstFrame = true;
    stageOnScreen = host.getBoundingClientRect().bottom > -200 && host.getBoundingClientRect().top < innerHeight + 200;
    userPaused = options.play !== true;
    resize();
    paint(0.016);
    updateControls();
    updateChapter();
    if (!userPaused) wake();
    return true;
  }
  function shouldRun() {
    return !!activeScene && routeService() === activeId && stageOnScreen && !userPaused
      && !document.hidden && mayAnimate() && !contextLost;
  }
  function tick(now) {
    rafId = 0;
    if (!shouldRun()) return;
    const rawDelta = Math.min(clock.getDelta(), 0.05);
    const target = TARGET_SECONDS[activeId] || 18;
    const playbackRate = activeScene.duration / target;
    localTime += rawDelta * playbackRate;
    if (localTime >= activeScene.duration) {
      localTime %= activeScene.duration;
      activeScene.reset();
    }
    activeScene.update(localTime, rawDelta * playbackRate);
    paint(rawDelta);
    if (now - lastChapterUpdate > 200) { lastChapterUpdate = now; updateChapter(); }
    rafId = requestAnimationFrame(tick);
  }
  function wake() {
    if (rafId || !shouldRun()) return;
    clock.getDelta();
    rafId = requestAnimationFrame(tick);
  }
  function pause() { userPaused = true; updateControls(); }
  function play() {
    if (!mayAnimate() || !activeScene) return false;
    userPaused = false; updateControls(); wake(); return true;
  }
  function seek(time, options = {}) {
    if (!activeScene) return null;
    localTime = Math.max(0, Math.min(Number(time) || 0, activeScene.duration - 0.001));
    primeScene(activeScene, localTime);
    firstFrame = true;
    paint(0.016);
    updateChapter();
    if (options.play && mayAnimate()) play();
    return localTime;
  }
  function replay() { seek(0.001); return play(); }
  function syncRoute() {
    const id = routeService();
    if (!id || !hosts.has(id) || !document.getElementById('stage-' + id)?.classList.contains('stage-open')) {
      pause();
      return;
    }
    if (activeId !== id) activate(id);
    else { resize(); paint(0.016); }
  }

  renderer.domElement.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    contextLost = true;
    pause();
    if (activeHost) activeHost.classList.remove('care-stage-live');
  });
  renderer.domElement.addEventListener('webglcontextrestored', () => {
    contextLost = false;
    if (activeScene) { firstFrame = true; resize(); paint(0.016); }
  });
  window.addEventListener('hashchange', () => setTimeout(syncRoute, 0));
  window.addEventListener('resize', () => { if (activeHost) { resize(); paint(0.016); wake(); } }, { passive: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
  const motionMedia = matchMedia('(prefers-reduced-motion: reduce)');
  const forcedColorsMedia = matchMedia('(forced-colors: active)');
  const syncMotionEnvironment = () => {
    if (!mayAnimate()) {
      pause();
      if (activeHost) activeHost.classList.remove('care-stage-live');
    }
  };
  if (motionMedia.addEventListener) motionMedia.addEventListener('change', syncMotionEnvironment);
  if (forcedColorsMedia.addEventListener) forcedColorsMedia.addEventListener('change', syncMotionEnvironment);
  new MutationObserver(syncMotionEnvironment).observe(rootEl, { attributes: true, attributeFilter: ['class', 'data-motion'] });
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.target === activeHost) {
          stageOnScreen = entry.isIntersecting;
          if (stageOnScreen) wake();
        }
      });
    }, { rootMargin: '400px 0px', threshold: [0, 0.05] });
    hosts.forEach(host => observer.observe(host));
  }

  window.__careStages = {
    state: () => ({ ready: true, service: activeId, running: !!rafId, paused: userPaused,
      time: +localTime.toFixed(2), duration: activeScene ? activeScene.duration : 0, onScreen: stageOnScreen }),
    show: id => activate(id),
    prime: time => seek(time),
    pause,
    play,
    replay,
    chapter(index) {
      const button = currentBlock()?.querySelectorAll('[data-care-seek]')[index];
      return button ? seek(button.dataset.careSeek, { play: !userPaused }) : null;
    },
    services: SERVICES.filter(service => service.id !== 'all').map(service => service.id),
  };
  return { activate, pause, play, replay, seek, syncRoute };
}

function setChapterPosterState(block, button) {
  block.querySelectorAll('[data-care-seek]').forEach(item => item.removeAttribute('aria-current'));
  button.setAttribute('aria-current', 'step');
}
async function openStage(button) {
  const id = button.dataset.careOpen;
  const block = document.getElementById('stage-' + id);
  if (!block) return;
  const opening = !block.classList.contains('stage-open');
  document.querySelectorAll('.care-stage-block.stage-open').forEach(other => {
    if (other !== block) other.classList.remove('stage-open');
  });
  document.querySelectorAll('[data-care-open]').forEach(other => {
    if (other !== button) { other.setAttribute('aria-expanded', 'false'); other.textContent = 'See a typical support session'; }
  });
  block.classList.toggle('stage-open', opening);
  button.setAttribute('aria-expanded', String(opening));
  button.textContent = opening ? 'Hide support session' : 'See a typical support session';
  if (!opening) { if (engine) engine.pause(); return; }
  const first = block.querySelector('[data-care-seek]');
  if (first) setChapterPosterState(block, first);
  /* Desktop can play immediately because opening the module was explicit.
     Mobile keeps the still until its separate Play button is pressed. */
  if (mayAnimate() && innerWidth >= 700) {
    const activeEngine = await boot();
    if (activeEngine) activeEngine.activate(id, { play: true });
  }
}

document.addEventListener('click', async event => {
  const open = event.target.closest('[data-care-open]');
  if (open) { await openStage(open); return; }
  const toggle = event.target.closest('[data-care-toggle]');
  if (toggle) {
    const block = toggle.closest('.care-stage-block');
    if (!block) return;
    const id = block.dataset.careStage;
    if (!mayAnimate()) return;
    const activeEngine = await boot();
    if (!activeEngine) return;
    if (!window.__careStages || window.__careStages.state().service !== id) activeEngine.activate(id);
    if (window.__careStages.state().paused) activeEngine.play(); else activeEngine.pause();
    return;
  }
  const replay = event.target.closest('[data-care-replay]');
  if (replay) {
    const block = replay.closest('.care-stage-block');
    if (!block || !mayAnimate()) return;
    const activeEngine = await boot();
    if (!activeEngine) return;
    if (window.__careStages.state().service !== block.dataset.careStage) activeEngine.activate(block.dataset.careStage);
    activeEngine.replay();
    return;
  }
  const chapter = event.target.closest('[data-care-seek]');
  if (chapter) {
    const block = chapter.closest('.care-stage-block');
    if (!block) return;
    setChapterPosterState(block, chapter);
    if (!engine || !mayAnimate()) return;
    if (window.__careStages.state().service !== block.dataset.careStage) engine.activate(block.dataset.careStage);
    engine.seek(chapter.dataset.careSeek, { play: !window.__careStages.state().paused });
  }
});

window.addEventListener('hashchange', () => {
  document.querySelectorAll('.care-stage-block.stage-open').forEach(block => block.classList.remove('stage-open'));
  document.querySelectorAll('[data-care-open]').forEach(button => {
    button.setAttribute('aria-expanded', 'false');
    button.textContent = 'See a typical support session';
  });
  if (engine) engine.syncRoute();
});

/* Explicit opt-in remains available for deterministic visual tests. */
function syncStaticOnly() { rootEl.classList.toggle('care-static-only', !mayAnimate()); }
syncStaticOnly();
const staticMotionMedia = matchMedia('(prefers-reduced-motion: reduce)');
const staticForcedColorsMedia = matchMedia('(forced-colors: active)');
if (staticMotionMedia.addEventListener) staticMotionMedia.addEventListener('change', syncStaticOnly);
if (staticForcedColorsMedia.addEventListener) staticForcedColorsMedia.addEventListener('change', syncStaticOnly);
new MutationObserver(syncStaticOnly).observe(rootEl, { attributes: true, attributeFilter: ['class', 'data-motion'] });
window.__careBoot = boot;
