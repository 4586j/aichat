/* Five-act 9.2s entrance. ENTRANCE_TIMELINE is the single source of truth: it drives the JS
   stage scheduling and is written back into the --beat-* custom properties entrance.css reads,
   so the two can never drift apart. */
const ENTRANCE_TIMELINE = Object.freeze({
  totalDurationMs: 9200,
  stages: Object.freeze({
    act2PushWindowMs: 2600,
    act3EnterHallMs: 5400,
    act5RestMs: 9200,
  }),
  beats: Object.freeze({
    dawnMountains: { startMs: 0, durationMs: 900, delayVar: '--beat-dawn-mountains-delay', durVar: '--beat-dawn-mountains-dur' },
    groundFog: { startMs: 0, durationMs: 2600, delayVar: '--beat-ground-fog-delay', durVar: '--beat-ground-fog-dur' },
    gateWallRise: { startMs: 300, durationMs: 1000, delayVar: '--beat-gate-wall-delay', durVar: '--beat-gate-wall-dur' },
    lanternLeft: { startMs: 300, durationMs: 1200, delayVar: '--beat-lantern-left-delay', durVar: '--beat-lantern-dur' },
    lanternRight: { startMs: 650, durationMs: 1200, delayVar: '--beat-lantern-right-delay', durVar: '--beat-lantern-dur' },
    plaqueDescend: { startMs: 900, durationMs: 700, delayVar: '--beat-plaque-descend-delay', durVar: '--beat-plaque-descend-dur' },
    sealStamp: { startMs: 1550, durationMs: 500, delayVar: '--beat-seal-stamp-delay', durVar: '--beat-seal-stamp-dur' },
    knockerStrike: { startMs: 1600, durationMs: 475, delayVar: '--beat-knocker-strike-delay', durVar: '--beat-knocker-strike-dur' },
    knockerRipple1: { startMs: 1680, durationMs: 850, delayVar: '--beat-ripple-1-delay', durVar: '--beat-ripple-dur' },
    knockerRipple2: { startMs: 2150, durationMs: 850, delayVar: '--beat-ripple-2-delay', durVar: '--beat-ripple-dur' },
    boltUnlock: { startMs: 2050, durationMs: 850, delayVar: '--beat-bolt-unlock-delay', durVar: '--beat-bolt-unlock-dur' },
    seamLightLeak: { startMs: 2150, durationMs: 450, delayVar: '--beat-seam-light-delay', durVar: '--beat-seam-light-dur' },
    blindRollUp: { startMs: 2600, durationMs: 1000, delayVar: '--beat-blind-roll-delay', durVar: '--beat-blind-roll-dur' },
    doorsSwingOpen: { startMs: 3200, durationMs: 1800, delayVar: '--beat-doors-swing-delay', durVar: '--beat-doors-swing-dur' },
    mistPart: { startMs: 3400, durationMs: 2000, delayVar: '--beat-mist-part-delay', durVar: '--beat-mist-part-dur' },
    vistaDolly: { startMs: 3400, durationMs: 2000, delayVar: '--beat-vista-dolly-delay', durVar: '--beat-vista-dolly-dur' },
    cranesFly: { startMs: 4000, durationMs: 1400, delayVar: '--beat-cranes-fly-delay', durVar: '--beat-cranes-fly-dur' },
    eavesLift: { startMs: 4600, durationMs: 800, delayVar: '--beat-eaves-lift-delay', durVar: '--beat-eaves-lift-dur' },
    matchCutHandover: { startMs: 4800, durationMs: 600, delayVar: '--beat-match-cut-delay', durVar: '--beat-match-cut-dur' },
    cameraSettle: { startMs: 5400, durationMs: 1000, relToAct3: true, delayVar: '--beat-camera-settle-delay', durVar: '--beat-camera-settle-dur' },
    topBeamCouplets: { startMs: 5500, durationMs: 850, relToAct3: true, delayVar: '--beat-beam-drop-delay', durVar: '--beat-beam-drop-dur' },
    navSlip1: { startMs: 6200, durationMs: 600, relToAct3: true, delayVar: '--beat-nav-1-delay', durVar: '--beat-nav-dur' },
    navSlip2: { startMs: 6280, durationMs: 600, relToAct3: true, delayVar: '--beat-nav-2-delay', durVar: '--beat-nav-dur' },
    navSlip3: { startMs: 6360, durationMs: 600, relToAct3: true, delayVar: '--beat-nav-3-delay', durVar: '--beat-nav-dur' },
    navSlip4: { startMs: 6440, durationMs: 600, relToAct3: true, delayVar: '--beat-nav-4-delay', durVar: '--beat-nav-dur' },
    navSlip5: { startMs: 6520, durationMs: 600, relToAct3: true, delayVar: '--beat-nav-5-delay', durVar: '--beat-nav-dur' },
    navSlip6: { startMs: 6600, durationMs: 600, relToAct3: true, delayVar: '--beat-nav-6-delay', durVar: '--beat-nav-dur' },
    headingUnfurl: { startMs: 6600, durationMs: 950, relToAct3: true, delayVar: '--beat-heading-unfurl-delay', durVar: '--beat-heading-unfurl-dur' },
    galleryUnfurl: { startMs: 6750, durationMs: 950, relToAct3: true, delayVar: '--beat-gallery-unfurl-delay', durVar: '--beat-gallery-unfurl-dur' },
    chatHallUnroll: { startMs: 7000, durationMs: 1000, relToAct3: true, delayVar: '--beat-hall-unroll-delay', durVar: '--beat-hall-unroll-dur' },
    asideBloom1: { startMs: 7400, durationMs: 480, relToAct3: true, delayVar: '--beat-aside-1-delay', durVar: '--beat-aside-dur' },
    asideBloom2: { startMs: 7560, durationMs: 480, relToAct3: true, delayVar: '--beat-aside-2-delay', durVar: '--beat-aside-dur' },
    asideBloom3: { startMs: 7720, durationMs: 480, relToAct3: true, delayVar: '--beat-aside-3-delay', durVar: '--beat-aside-dur' },
    musicDockRise: { startMs: 7400, durationMs: 800, relToAct3: true, delayVar: '--beat-dock-rise-delay', durVar: '--beat-dock-rise-dur' },
    petalsDrift: { startMs: 5450, durationMs: 4200, relToAct3: true, delayVar: null, durVar: '--beat-petals-dur' },
    koiAndIncense: { startMs: 8000, durationMs: 1200, relToAct3: true, delayVar: '--beat-resonance-delay', durVar: null },
    plaqueLightSweep: { startMs: 8100, durationMs: 1000, relToAct3: true, delayVar: '--beat-light-sweep-delay', durVar: '--beat-light-sweep-dur' },
  }),
});

const SEEN_KEY = 'qiyi-entrance-seen';
let generation = 0;
let timers = [];
let controlsBound = false;
// The overlay is removed once it has played; replaying re-inserts this detached copy.
let overlayTemplate = null;

function syncTimelineToCSS() {
  const rootStyle = document.documentElement.style;
  const act3Base = ENTRANCE_TIMELINE.stages.act3EnterHallMs;
  for (const beat of Object.values(ENTRANCE_TIMELINE.beats)) {
    if (beat.delayVar) {
      const offsetMs = beat.relToAct3 ? beat.startMs - act3Base : beat.startMs;
      rootStyle.setProperty(beat.delayVar, `${(offsetMs / 1000).toFixed(3)}s`);
    }
    if (beat.durVar) rootStyle.setProperty(beat.durVar, `${(beat.durationMs / 1000).toFixed(3)}s`);
  }
}

function clearTimers() {
  for (const timer of timers) clearTimeout(timer);
  timers = [];
}

function alreadySeen() {
  try { return localStorage.getItem(SEEN_KEY) === 'true'; } catch { return false; }
}

function markSeen() {
  try { localStorage.setItem(SEEN_KEY, 'true'); } catch { /* Private storage may be unavailable. */ }
}

function settle() {
  clearTimers();
  document.body.classList.remove('is-entering-pre', 'is-entering-post');
  document.getElementById('startup-screen')?.remove();
}

function restartPetals() {
  for (const leaf of document.querySelectorAll('#post-window-petals .petal-leaf')) {
    leaf.style.animation = 'none';
    void leaf.offsetWidth;
    leaf.style.animation = '';
  }
}

function bindControls() {
  if (controlsBound) return;
  controlsBound = true;
  const abort = () => { generation += 1; settle(); };
  document.getElementById('btn-skip-entrance')?.addEventListener('click', abort);
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', event => {
    if (event.matches) abort();
  });
}

export function startEntrance({ force = false } = {}) {
  let screen = document.getElementById('startup-screen');
  if (screen) overlayTemplate ??= screen.cloneNode(true);
  else if (force && overlayTemplate) {
    screen = overlayTemplate.cloneNode(true);
    document.body.prepend(screen);
  }
  if (!screen) return;

  syncTimelineToCSS();
  bindControls();

  const myGeneration = ++generation;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || (alreadySeen() && !force)) {
    settle();
    return;
  }
  markSeen();

  clearTimers();
  document.body.classList.remove('is-entering-pre', 'is-entering-post');
  screen.classList.remove('is-active');
  restartPetals();
  void screen.offsetWidth;

  document.body.classList.add('is-entering-pre');
  screen.classList.add('is-active');
  screen.setAttribute('aria-hidden', 'false');

  timers.push(setTimeout(() => {
    if (generation !== myGeneration) return;
    document.body.classList.remove('is-entering-pre');
    document.body.classList.add('is-entering-post');
    screen.classList.remove('is-active');
    screen.setAttribute('aria-hidden', 'true');
  }, ENTRANCE_TIMELINE.stages.act3EnterHallMs));

  timers.push(setTimeout(() => {
    if (generation !== myGeneration) return;
    settle();
  }, ENTRANCE_TIMELINE.stages.act5RestMs));
}
