/* ============================================================
   oo-scrub.js — BookIt v63 film engine
   ------------------------------------------------------------
   The visitor's scroll plays the hero film. One continuous clip,
   scrubbed forward AND backward, any frame holdable as a still.

   Disciplines carried over from the v62 care runtime:
   - zero work until the film section is near the viewport;
   - reduce-motion / high-contrast users get the poster + all
     chapter copy, and the video is NEVER fetched;
   - the loop runs only while the home route is active, the
     section is near the viewport, and the tab is visible;
   - full teardown (blob URL revoked) when the page hides.

   Markup contract (see index.html):
   <section class="oo-film" id="ooFilm"
            data-clip="/assets/world/fit.mp4"
            data-clip-mobile="/assets/world/fit-mobile.mp4"
            data-poster="/assets/world/fit-poster.jpg"
            data-poster-mobile="/assets/world/fit-mobile-poster.jpg">
     <div class="oo-film-sticky">
       <video class="oo-film-video" muted playsinline preload="none"></video>
       <div class="oo-chapters">
         <article class="oo-ch" data-from="0.00" data-to="0.27">…</article>
         … (chapters in reading order)
       </div>
       <svg class="oo-progress">…</svg>
     </div>
   </section>
   ============================================================ */
(() => {
  'use strict';

  const rootEl = document.documentElement;
  const section = document.getElementById('ooFilm');
  if (!section) return;

  const sticky   = section.querySelector('.oo-film-sticky');
  const video    = section.querySelector('.oo-film-video');
  const chapters = Array.from(section.querySelectorAll('.oo-ch'));
  const progress = section.querySelector('.oo-progress');
  const ringA    = progress ? progress.querySelector('.pr-a') : null;
  const ringB    = progress ? progress.querySelector('.pr-b') : null;
  const prTick   = progress ? progress.querySelector('.pr-tick') : null;
  if (!sticky || !video) return;

  /* ---------- media selection ---------- */
  const mqMobile = window.matchMedia('(max-width: 768px)');
  const saveData = navigator.connection && navigator.connection.saveData;
  const useMobile = () => saveData || mqMobile.matches;
  const clipSrc   = () => (useMobile() && section.dataset.clipMobile) || section.dataset.clip;
  const posterSrc = () => (useMobile() && section.dataset.posterMobile) || section.dataset.poster;

  /* ---------- motion policy (mirrors the v62 rules) ---------- */
  const osReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reduceMotion = () =>
    rootEl.getAttribute('data-motion') === 'reduce'
    || rootEl.classList.contains('high-contrast')
    || osReduce.matches;

  /* Static path: poster + every chapter readable, zero video work. */
  function goStatic() {
    section.classList.add('oo-static');
    section.classList.remove('oo-live');
    video.removeAttribute('src');
    video.load && video.load();
    sticky.style.backgroundImage = `url("${posterSrc()}")`;
    chapters.forEach(ch => { ch.classList.add('is-active'); ch.removeAttribute('aria-hidden'); });
    stopLoop();
  }

  /* ---------- engine state ---------- */
  let booted = false;      /* clip requested                        */
  let ready  = false;      /* metadata loaded, duration known       */
  let live   = false;      /* first real frame painted              */
  let primed = false;      /* iOS gesture priming done              */
  let blobUrl = null;
  let duration = 0;
  let desired = 0;         /* target playhead, seconds              */
  let shown   = -1;        /* last time actually committed          */
  let seekBusy = false;
  let rafId = 0;
  let nearViewport = false;
  let routeActive = true;  /* #page-home visible                    */
  let activeCh = -1;

  const EPS = 1 / 30;      /* commit threshold ≈ one frame          */
  const TAIL = 0.05;       /* keep off the very last frame          */

  /* ---------- poster first, always ---------- */
  video.poster = posterSrc();
  video.muted = true;
  video.setAttribute('muted', '');
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.preload = 'none';

  /* ---------- clip boot (lazy; blob-backed for reliable seeks) ---------- */
  async function boot() {
    if (booted || reduceMotion()) return;
    booted = true;
    const src = clipSrc();
    try {
      const res = await fetch(src, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('http ' + res.status);
      const blob = await res.blob();
      blobUrl = URL.createObjectURL(blob);
      video.src = blobUrl;
    } catch (_) {
      /* file:// preview or offline — plain src still seeks, just less smoothly */
      video.src = src;
    }
    video.addEventListener('loadedmetadata', () => {
      duration = video.duration || 0;
      ready = duration > 0.5;
      if (ready) commit(true);
    }, { once: true });
    video.addEventListener('seeked', () => {
      seekBusy = false;
      if (!live) firstFrame();
    });
    video.load();
  }

  function firstFrame() {
    live = true;
    section.classList.add('oo-live');
  }

  /* iOS refuses to paint seek targets until the element has been "played"
     once inside a user gesture. Cheapest unlock: play→pause, muted. */
  function prime() {
    if (primed || !ready || reduceMotion()) return;
    primed = true;
    const p = video.play();
    if (p && p.then) p.then(() => video.pause()).catch(() => {});
  }
  ['touchstart', 'pointerdown', 'wheel', 'keydown'].forEach(ev =>
    window.addEventListener(ev, prime, { once: true, passive: true }));

  /* ---------- scroll → time ---------- */
  function fraction() {
    const rect = section.getBoundingClientRect();
    const track = rect.height - window.innerHeight;
    if (track <= 0) return 0;
    return Math.min(1, Math.max(0, -rect.top / track));
  }

  function commit(force) {
    if (!ready) return;
    const p = fraction();
    desired = p * Math.max(0, duration - TAIL);
    /* gentle chase keeps fast flicks silky without falling behind */
    const next = force ? desired : shown + (desired - shown) * 0.55;
    if (!seekBusy && (force || Math.abs(next - shown) > EPS)) {
      seekBusy = true;
      shown = next;
      try { video.currentTime = next; } catch (_) { seekBusy = false; }
    }
    setChapter(p);
    setProgress(p);
  }

  /* ---------- chapters ---------- */
  function setChapter(p) {
    let idx = 0;
    for (let i = 0; i < chapters.length; i++) {
      const from = parseFloat(chapters[i].dataset.from || '0');
      if (p >= from) idx = i;
    }
    if (idx === activeCh) return;
    activeCh = idx;
    chapters.forEach((ch, i) => {
      const on = i === idx;
      ch.classList.toggle('is-active', on);
      if (on) ch.removeAttribute('aria-hidden');
      else ch.setAttribute('aria-hidden', 'true');
    });
  }

  /* ---------- the signature: two rings that link ---------- */
  function setProgress(p) {
    if (!ringA || !ringB) return;
    /* rings start 34px apart and meet at the standard oo overlap */
    const travel = 17 * (1 - p);
    ringA.style.transform = `translateX(${-travel}px)`;
    ringB.style.transform = `translateX(${travel}px)`;
    const linked = p >= 0.985;
    progress.classList.toggle('is-linked', linked);
    if (prTick) prTick.style.strokeDashoffset = linked ? '0' : '34';
  }

  /* ---------- run only when it matters ---------- */
  function loop() {
    rafId = 0;
    if (!nearViewport || !routeActive || document.hidden || reduceMotion()) return;
    commit(false);
    rafId = requestAnimationFrame(loop);
  }
  function startLoop() { if (!rafId) rafId = requestAnimationFrame(loop); }
  function stopLoop()  { if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } }

  const io = new IntersectionObserver((entries) => {
    nearViewport = entries.some(e => e.isIntersecting);
    if (nearViewport && routeActive && !reduceMotion()) { boot(); startLoop(); }
    else stopLoop();
  }, { rootMargin: '60% 0px 60% 0px' });
  io.observe(section);

  /* The SPA router hides #page-home when another route is active. */
  function syncRoute() {
    const seg = (location.hash || '#/').replace(/^#\/?/, '').split(/[/?]/)[0];
    routeActive = seg === '' || seg === 'home';
    if (routeActive && nearViewport && !reduceMotion()) startLoop();
    else stopLoop();
  }
  window.addEventListener('hashchange', syncRoute);
  syncRoute();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopLoop(); else if (nearViewport && routeActive) startLoop();
  });

  /* ---------- policy changes, both directions ---------- */
  function applyPolicy() {
    if (reduceMotion()) { goStatic(); return; }
    section.classList.remove('oo-static');
    if (!booted && nearViewport) boot();
    if (nearViewport && routeActive) startLoop();
  }
  osReduce.addEventListener ? osReduce.addEventListener('change', applyPolicy)
                            : osReduce.addListener(applyPolicy);
  new MutationObserver(applyPolicy)
    .observe(rootEl, { attributes: true, attributeFilter: ['data-motion', 'class'] });

  /* source swap on breakpoint change (only before the clip is fetched) */
  mqMobile.addEventListener && mqMobile.addEventListener('change', () => {
    if (!booted) video.poster = posterSrc();
  });

  window.addEventListener('pagehide', () => {
    stopLoop();
    if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
  });

  if (reduceMotion()) goStatic();

  /* ============================================================
     Section reveals (transform-only) + plate parallax.
     Everything is gated by the same reduce-motion policy and all
     content is fully rendered before any class is added.
     ============================================================ */
  const rv = Array.from(document.querySelectorAll('.rv'));
  if (rv.length) {
    if (reduceMotion()) rv.forEach(el => el.classList.add('is-in'));
    else {
      const rio = new IntersectionObserver((es) => {
        es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-in'); rio.unobserve(e.target); } });
      }, { rootMargin: '0px 0px -8% 0px' });
      rv.forEach(el => rio.observe(el));
    }
  }

  const plates = Array.from(document.querySelectorAll('.scene-window img'));
  if (plates.length && !reduceMotion()) {
    let pRaf = 0;
    const drift = () => {
      pRaf = 0;
      const vh = window.innerHeight;
      plates.forEach(img => {
        const r = img.parentElement.getBoundingClientRect();
        if (r.bottom < 0 || r.top > vh) return;
        const t = (r.top + r.height / 2 - vh / 2) / vh; /* -0.5 … 0.5-ish */
        img.style.transform = `scale(1.08) translateY(${(-t * 4).toFixed(2)}%)`;
      });
    };
    window.addEventListener('scroll', () => { if (!pRaf) pRaf = requestAnimationFrame(drift); }, { passive: true });
    drift();
  }
})();
