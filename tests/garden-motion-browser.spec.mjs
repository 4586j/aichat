import { test, expect } from './ui-test.mjs';

const nav = (page, name) => page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name, exact: true });
const replay = page => page.getByRole('button', { name: '重播入场', exact: true });
const skip = page => page.getByRole('button', { name: '跳过入场', exact: true });
const scenes = page => page.locator('.garden-controls [data-garden-action="scenes"]');
const sceneSwitch = page => page.locator('.garden-memory [data-garden-action="scenes"]');

async function createPersona(page, offline, name) {
  const response = await page.request.post(`${offline.url}/api/personas`, {
    data: { name, description: '园林动效测试角色。', systemPrompt: '清晰简洁地回答。' },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).persona;
}

async function settled(page) {
  await expect(page.locator('#startup-screen')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveClass(/is-entering-(pre|post)/);
  await expect(skip(page)).toBeHidden();
}

async function triggerReplay(page) {
  const btn = replay(page);
  if (await btn.isVisible()) {
    await btn.click();
  } else {
    await page.evaluate(() => {
      if (typeof window.__replayGardenEntrance === 'function') {
        window.__replayGardenEntrance();
      } else {
        document.querySelector('[data-garden-action="entrance"]')?.click();
      }
    });
  }
}

async function startReplay(page) {
  await triggerReplay(page);
  await expect(page.locator('#startup-screen')).toHaveCount(1);
  await expect(page.locator('#startup-screen')).toHaveClass(/is-active/);
  await expect(page.locator('#startup-screen')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('body')).toHaveClass(/is-entering-pre/);
}

// Real activation time anchors screenshots independently of navigation and bootstrap timing.
async function observeEntrance(page) {
  await page.addInitScript(() => {
    window.__gardenEntrance = { starts: [], stages: [] };
    let active = false;
    let previousStage = 'settled';
    new MutationObserver(() => {
      const now = performance.now();
      const nextActive = Boolean(document.querySelector('#startup-screen.is-active'));
      if (nextActive && !active) window.__gardenEntrance.starts.push(now);
      active = nextActive;
      const stage = document.body?.classList.contains('is-entering-pre') ? 'pre'
        : document.body?.classList.contains('is-entering-post') ? 'post' : 'settled';
      if (stage !== previousStage) {
        window.__gardenEntrance.stages.push({ stage, at: now });
        previousStage = stage;
      }
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  });
}

const entranceElapsed = page => page.evaluate(() => {
  const start = window.__gardenEntrance.starts.at(-1);
  return start === undefined ? -1 : performance.now() - start;
});

async function atEntranceTime(page, milliseconds) {
  await expect.poll(() => entranceElapsed(page), {
    message: `real entrance elapsed time reaches ${milliseconds}ms`,
    intervals: [25, 50], timeout: 12000,
  }).toBeGreaterThanOrEqual(milliseconds);
}

async function beat(page, selector, animationName) {
  return page.locator(selector).first().evaluate((element, name) => {
    const style = getComputedStyle(element);
    const animation = element.getAnimations().find(item => item.animationName === name);
    const timing = animation?.effect.getComputedTiming();
    return {
      opacity: Number(style.opacity), transform: style.transform, clipPath: style.clipPath,
      playState: animation?.playState ?? null, progress: timing?.progress ?? null,
      currentTime: animation?.currentTime ?? null, delay: timing?.delay ?? null,
    };
  }, animationName);
}

async function checkpoint(page, testInfo, name, earliest, latest, check) {
  await test.step(name, async () => {
    await atEntranceTime(page, earliest);
    expect(await entranceElapsed(page), `${name}: checkpoint was not missed`).toBeLessThan(latest);
    await check();
    await page.screenshot({ path: testInfo.outputPath(`${name}.png`), animations: 'allow' });
    // Slow captures must fail rather than silently labeling a later act as this act.
    expect(await entranceElapsed(page), `${name}: capture stayed inside the act`).toBeLessThan(latest);
  });
}

async function pauseJSTimers(page) {
  // Only lifecycle/timer assertions use this clock; it is NOT evidence of CSS progress.
  await page.clock.install({ time: new Date('2026-10-26T08:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-26T08:00:01Z'));
}

const decorativeTargets = [
  { selector: '#garden-pond .koi-fish-red', animation: 'koi-swim-1' },
  { selector: '#garden-pond .koi-fish-gold', animation: 'koi-swim-2' },
  { selector: '.garden-memory .incense-smoke-wisp', animation: 'incense-smoke-rise' },
  { selector: '.ambient-bamboo', animation: 'bamboo-sway' },
  { selector: '.palace-lantern-mini svg', animation: 'lantern-sway' },
  { selector: '.brand-seal', animation: 'seal-shimmer' },
  // The canopy is static; check for any runtime pseudo animations without inventing one.
  { selector: '.weather-light-canopy', animation: null },
];

async function sampleDecorations(page) {
  return page.evaluate(targets => ({
    at: performance.now(),
    targets: targets.map(target => ({
      ...target,
      elements: [...document.querySelectorAll(target.selector)].map(element => ({
        animations: element.getAnimations({ subtree: true }).map(animation => ({
          name: animation.animationName || animation.id,
          pseudo: animation.effect?.pseudoElement || '',
          state: animation.playState, pending: animation.pending, time: animation.currentTime,
        })),
        styles: ['', '::before', '::after'].map(pseudo => {
          const style = getComputedStyle(element, pseudo || null);
          return {
            pseudo, animation: style.animationName, state: style.animationPlayState,
            visual: [style.transform, style.opacity, style.filter, style.backgroundPosition],
          };
        }),
      })),
    })),
  }), decorativeTargets);
}

// Intermediate real-time samples detect motion that endpoint comparisons could miss.
async function measureDecorations(page) {
  const first = await sampleDecorations(page);
  const samples = [];
  await expect.poll(async () => {
    const sample = await sampleDecorations(page);
    samples.push(sample);
    return sample.at - first.at;
  }, { intervals: [50], timeout: 2500 }).toBeGreaterThanOrEqual(300);
  return { first, samples, last: samples.at(-1) };
}

function motionStateProblems(sample, state) {
  return sample.targets.flatMap(target => [
    ...(target.elements.length ? [] : [`${target.selector}: missing element`]),
    ...target.elements.flatMap((element, index) => [
      ...(target.animation && !element.animations.some(animation => animation.name === target.animation)
        ? [`${target.selector}[${index}]: missing ${target.animation}`] : []),
      ...element.animations.filter(animation => animation.state !== state || animation.pending)
        .map(animation => `${target.selector}[${index}] ${animation.name}${animation.pseudo}: ${animation.state}, pending=${animation.pending}`),
      ...element.styles.filter(style => style.animation !== 'none' && style.state.split(',').some(value => value.trim() !== state))
        .map(style => `${target.selector}[${index}]${style.pseudo}: ${style.state}`),
    ]),
  ]);
}

function compareMotion(before, after, moving) {
  expect(after.targets.map(target => target.selector)).toEqual(before.targets.map(target => target.selector));
  before.targets.forEach((target, targetIndex) => {
    const next = after.targets[targetIndex];
    expect(next.elements.length, target.selector).toBe(target.elements.length);
    target.elements.forEach((element, index) => {
      const later = next.elements[index];
      const label = `${target.selector}[${index}]`;
      expect(later.animations.map(a => [a.name, a.pseudo]), label).toEqual(element.animations.map(a => [a.name, a.pseudo]));
      element.animations.forEach((animation, animationIndex) => {
        const delta = later.animations[animationIndex].time - animation.time;
        expect(typeof animation.time, `${label} ${animation.name}: numeric animation clock`).toBe('number');
        if (moving) expect.soft(delta, `${label} ${animation.name}: resumes without restarting`).toBeGreaterThan(100);
        else expect.soft(Math.abs(delta), `${label} ${animation.name}: frozen animation clock`).toBeLessThanOrEqual(1);
      });
      element.styles.forEach((style, styleIndex) => {
        const visual = later.styles[styleIndex].visual;
        if (!moving) expect.soft(visual, `${label}${style.pseudo}: frozen computed visual`).toEqual(style.visual);
        else if (style.animation !== 'none') expect.soft(visual, `${label}${style.pseudo}: actual visual progress`).not.toEqual(style.visual);
      });
    });
  });
}

test.describe('fresh garden entrance', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('one real five-act timeline has visual checkpoints and an interactive ending', async ({ page, offlineApp: offline }, testInfo) => {
    await createPersona(page, offline, '五幕入园');
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await observeEntrance(page);
    await page.goto(offline.url, { waitUntil: 'domcontentloaded' });

    await checkpoint(page, testInfo, 'act-1-dawn-and-plaque', 1800, 2600, async () => {
      await expect(page.locator('#startup-screen')).toHaveClass(/is-active/);
      expect((await beat(page, '.ext-layer-far', 'dawn-ridge-rise')).opacity).toBe(1);
      expect((await beat(page, '.startup-center', 'plaque-descend-overshoot')).opacity).toBe(1);
      const knocker = await beat(page, '.knocker-ring', 'knocker-strike');
      expect(knocker.playState).toBe('running');
      expect(knocker.progress).toBeGreaterThan(0);
      expect(knocker.progress).toBeLessThan(1);
    });
    await checkpoint(page, testInfo, 'act-2-curtain-and-doors', 4000, 4800, async () => {
      const curtain = await beat(page, '.curtain-slats-body', 'curtain-clip-roll-up');
      expect(curtain.opacity).toBe(0);
      expect(curtain.clipPath).toContain('99%');
      const door = await beat(page, '.garden-door-left', 'palace-door-open-left');
      expect(door.playState).toBe('running');
      expect(door.progress).toBeGreaterThan(0);
      expect(door.progress).toBeLessThan(1);
      expect(door.transform).toContain('matrix3d');
    });
    await checkpoint(page, testInfo, 'act-3-hall-unroll', 7300, 8000, async () => {
      await expect(page.locator('body')).toHaveClass(/is-entering-post/);
      await expect(page.locator('#startup-screen')).toHaveAttribute('aria-hidden', 'true');
      const hall = await beat(page, '.chat-panel', 'main-hall-scroll-unroll');
      expect(hall.progress).toBeGreaterThan(0);
      expect(hall.progress).toBeLessThan(1);
      expect(hall.clipPath.match(/[\d.]+%/g)?.some(value => Number.parseFloat(value) > 0)).toBe(true);
      expect((await beat(page, '#navigation .nav-item', 'bamboo-slip-cascade')).opacity).toBe(1);
      expect((await beat(page, '.petal-leaf', 'petal-breeze-fall')).opacity).toBeGreaterThan(0);
    });
    await checkpoint(page, testInfo, 'act-4-golden-sweep-and-incense', 8500, 9200, async () => {
      const sweep = await beat(page, '.plaque-light-sweep', 'plaque-golden-sweep');
      expect(sweep.playState).toBe('running');
      expect(sweep.opacity).toBeGreaterThan(0);
      for (const [selector, name] of [['.koi-fish-red', 'koi-swim-1'], ['.incense-smoke-wisp', 'incense-smoke-rise']]) {
        const resonance = await beat(page, selector, name);
        expect(resonance.playState).toBe('running');
        expect(resonance.currentTime).toBeGreaterThan(resonance.delay);
        expect(resonance.progress).toBeGreaterThan(0);
      }
      expect((await beat(page, '.ambient-bamboo', 'bamboo-sway')).playState).toBe('paused');
    });
    await checkpoint(page, testInfo, 'act-5-interactive-garden', 9400, 12500, async () => {
      await settled(page);
      await expect(page.locator('#chat-input')).toBeEditable();
      await page.locator('#chat-input').fill('入园后仍可继续写下今天的想法。');
      await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
      expect((await beat(page, '.ambient-bamboo', 'bamboo-sway')).playState).toBe('running');
    });
    const timeline = await page.evaluate(() => window.__gardenEntrance);
    expect(timeline.starts).toHaveLength(1);
    expect(timeline.stages.map(item => item.stage)).toEqual(['pre', 'post', 'settled']);
    expect(offline.calls.model).toHaveLength(0);

    await page.reload();
    await expect(page.locator('#chat-input')).toBeEditable();
    await settled(page);
    expect(await page.evaluate(() => window.__gardenEntrance.starts)).toEqual([]);
  });

  test('unavailable localStorage does not break skip, replay, appearance, or navigation', async ({ page, offlineApp: offline }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await createPersona(page, offline, '无存储入园');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.addInitScript(() => {
      window.__storageAttempts = 0;
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          window.__storageAttempts += 1;
          throw new DOMException('Storage is unavailable in this test', 'SecurityError');
        },
      });
    });
    await page.goto(offline.url);
    await expect(page.locator('#startup-screen')).toHaveClass(/is-active/);
    await skip(page).click();
    await settled(page);
    for (let cycle = 0; cycle < 2; cycle += 1) {
      await startReplay(page);
      await skip(page).click();
      await settled(page);
    }
    await nav(page, '设置').click();
    await page.getByRole('button', { name: '夜雨', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-garden-theme', 'night');
    await scenes(page).click();
    await nav(page, '对话').click();
    await expect(sceneSwitch(page)).toHaveAttribute('aria-checked', 'false');
    await nav(page, '设置').click();
    await scenes(page).click();
    await nav(page, '对话').click();
    await expect(sceneSwitch(page)).toHaveAttribute('aria-checked', 'true');
    await page.locator('#chat-input').fill('存储不可用也不丢失当前草稿。');
    await nav(page, '知识库').click();
    await nav(page, '对话').click();
    await expect(page.locator('#chat-input')).toHaveValue('存储不可用也不丢失当前草稿。');
    expect(await page.evaluate(() => window.__storageAttempts)).toBeGreaterThan(0);
    await page.reload();
    await expect(page.locator('#startup-screen')).toHaveClass(/is-active/);
    await skip(page).click();
    await settled(page);
    await expect(page.locator('#chat-input')).toBeEditable();
    await expect(page.locator('html')).toHaveAttribute('data-garden-theme', 'spring');
    expect(errors).toEqual([]);
    expect(offline.calls.model).toHaveLength(0);
  });

  test('small screens keep entrance controls and the settled composer unobstructed', async ({ page, offlineApp: offline }, testInfo) => {
    await createPersona(page, offline, '小屏入园');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await observeEntrance(page);
    for (const [index, viewport] of [{ width: 320, height: 740 }, { width: 390, height: 844 }].entries()) {
      await page.setViewportSize(viewport);
      if (index === 0) await page.goto(offline.url, { waitUntil: 'domcontentloaded' });
      else await startReplay(page);
      await atEntranceTime(page, 1800);
      expect(await entranceElapsed(page), 'phone capture starts in act I').toBeLessThan(2600);
      await expect(skip(page)).toBeInViewport();
      const plaque = await page.locator('.startup-center').boundingBox();
      const hud = await page.locator('#startup-hud').boundingBox();
      expect(plaque).not.toBeNull();
      expect(hud).not.toBeNull();
      expect(plaque.y + plaque.height).toBeLessThanOrEqual(hud.y);
      await page.screenshot({ path: testInfo.outputPath(`entrance-phone-${viewport.width}.png`), animations: 'allow' });
      await skip(page).click();
      await settled(page);
      await page.locator('#chat-input').fill('小屏幕上的草稿保持可编辑。');
      await expect.poll(() => page.evaluate(() => {
        const problems = [];
        const rect = selector => document.querySelector(selector).getBoundingClientRect();
        if (document.documentElement.scrollWidth > innerWidth + 1 || document.documentElement.scrollHeight > innerHeight + 1) problems.push('document overflows viewport');
        for (const element of document.querySelectorAll('.persona-summary, .garden-memory, .composer-wrap')) {
          if (element.scrollHeight > element.clientHeight + 2 || element.scrollWidth > element.clientWidth + 2) problems.push(`${element.className} clips its content`);
        }
        const pairs = [
          ['.sidebar', '.topbar'], ['.topbar', '.page-heading'],
          ['.page-heading', '.chat-panel'], ['#chat-messages', '.composer-wrap'],
          ['.composer-wrap', '.chat-aside'], ['.persona-summary', '.garden-memory'],
          ['#chat-input', '#chat-form button[type="submit"]'],
        ];
        const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
          && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
        for (const [a, b] of pairs) if (overlaps(rect(a), rect(b))) problems.push(`${a} overlaps ${b}`);
        const controls = [...document.querySelectorAll('#navigation a, .garden-memory button, #chat-input, #chat-form button[type="submit"]')];
        controls.forEach((element, index) => {
          const box = element.getBoundingClientRect();
          const label = element.id || element.textContent.trim();
          if (box.width <= 0 || box.height <= 0 || box.left < -1 || box.top < -1 || box.right > innerWidth + 1 || box.bottom > innerHeight + 1) problems.push(`${label} outside viewport`);
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          if (!hit || !element.contains(hit)) problems.push(`${label} is obstructed`);
          for (const other of controls.slice(index + 1)) if (overlaps(box, other.getBoundingClientRect())) problems.push(`${label} overlaps another control`);
        });
        return problems;
      }), { intervals: [50, 100], timeout: 5000 }).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`garden-phone-${viewport.width}.png`), animations: 'allow' });
      await nav(page, '知识库').click();
      await nav(page, '对话').click();
      await expect(page.locator('#chat-input')).toHaveValue('小屏幕上的草稿保持可编辑。');
      await expect(page.getByRole('button', { name: '发送', exact: true })).toBeInViewport();
    }
    expect(offline.calls.model).toHaveLength(0);
  });
});

test('skip/replay generations survive older handover and completion deadlines', async ({ page, offlineApp: offline }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(offline.url);
  await settled(page);
  await pauseJSTimers(page);

  await startReplay(page); // A: handover 5400, completion 9200.
  await page.clock.runFor(1700);
  await skip(page).click();
  await settled(page);
  await startReplay(page); // B: handover 7100, completion 10900.
  await page.clock.runFor(3800); // 5500: A must not push B into post.
  await expect(page.locator('body')).toHaveClass(/is-entering-pre/);
  await skip(page).click();
  await settled(page);
  await startReplay(page); // C: handover 10900, completion 14700.
  await page.clock.runFor(3900); // 9400: past A completion and B handover.
  await expect(page.locator('body')).toHaveClass(/is-entering-pre/);
  await expect(page.locator('#startup-screen')).toHaveClass(/is-active/);
  await page.clock.runFor(1600); // 11000: B completion must not settle C.
  await expect(page.locator('body')).toHaveClass(/is-entering-post/);
  await skip(page).click(); // Exercise the persistent HUD after overlay handover too.
  await settled(page);
  await startReplay(page); // D: handover 16400, completion 20200.
  await page.clock.runFor(5500);
  await expect(page.locator('body')).toHaveClass(/is-entering-post/);
  await expect(page.locator('#startup-screen')).toHaveCount(1);
  await page.clock.runFor(3800);
  await settled(page);
  await page.clock.runFor(10000);
  await settled(page);
  expect(offline.calls.model).toHaveLength(0);
});

test('changing reduced motion cancels both entrance phases and allows explicit replay later', async ({ page, offlineApp: offline }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(offline.url);
  await settled(page);
  await pauseJSTimers(page);
  for (const phase of ['pre', 'post']) {
    await startReplay(page);
    if (phase === 'post') await page.clock.runFor(5500);
    await expect(page.locator('body')).toHaveClass(new RegExp(`is-entering-${phase}`));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await settled(page);
    await expect(page.locator('.ambient-bamboo')).toHaveCSS('animation-name', 'none');
    await expect(page.locator('.koi-fish-red')).toHaveCSS('animation-name', 'none');
    await triggerReplay(page); // Explicit replay must also respect the current preference.
    await settled(page);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await settled(page); // Restoring motion is not an unsolicited replay.
    await page.clock.runFor(10000);
    await settled(page); // Cancelled generations cannot return after their deadlines.
  }
  await startReplay(page);
  await skip(page).click();
  await settled(page);
  expect(offline.calls.model).toHaveLength(0);
});

test('replay preserves the selected route, persona, conversation key, and unsent draft', async ({ page, offlineApp: offline }) => {
  const persona = await createPersona(page, offline, '重播保留草稿');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(`${offline.url}/#chat`);
  await settled(page);
  await page.getByLabel('选择聊天角色', { exact: true }).selectOption(persona.id);
  await page.getByRole('button', { name: '新建对话', exact: true }).click();
  await expect(page.locator('#chat-messages')).not.toHaveAttribute('data-conversation', /^new:/);
  await expect(page.getByRole('button', { name: '新建对话', exact: true })).toBeEnabled();
  const draft = '第一行尚未发送。\n第二行在重播和导航后仍然保留。';
  await page.locator('#chat-input').fill(draft);
  const conversation = await page.locator('#chat-messages').getAttribute('data-conversation');
  const saved = await (await page.request.get(`${offline.url}/api/conversations/${conversation}`)).json();
  expect(saved.conversation).toMatchObject({ id: conversation, personaId: persona.id });
  await pauseJSTimers(page);
  await nav(page, '知识库').click();
  await expect(nav(page, '知识库')).toHaveAttribute('aria-current', 'page');
  await startReplay(page);
  await page.clock.runFor(5500);
  await skip(page).click();
  await settled(page);
  await expect(page).toHaveURL(/#knowledge$/);
  await expect(nav(page, '知识库')).toHaveAttribute('aria-current', 'page');
  await nav(page, '对话').click();
  await expect(page.locator('#chat-input')).toHaveValue(draft);
  await startReplay(page);
  await page.clock.runFor(9300);
  await settled(page);
  await expect(page).toHaveURL(/#chat$/);
  await expect(page.getByLabel('选择聊天角色', { exact: true })).toHaveValue(persona.id);
  await expect(page.locator('#chat-messages')).toHaveAttribute('data-conversation', conversation);
  await expect(page.locator('#chat-input')).toHaveValue(draft);
  await expect(page.locator('#chat-input')).toBeEditable();
  await nav(page, '知识库').click();
  await nav(page, '对话').click();
  await expect(page.locator('#chat-input')).toHaveValue(draft);
  expect(offline.calls.model).toHaveLength(0);
});

test('scene controls freeze actual decorative animation clocks and visuals, then resume them', async ({ page, offlineApp: offline }) => {
  await page.setViewportSize({ width: 1440, height: 960 }); // The miniature lantern is hidden on phones.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(offline.url);
  if (await skip(page).isVisible({ timeout: 1000 }).catch(() => false)) {
    await skip(page).click();
  }
  await settled(page);
  await expect(sceneSwitch(page)).toHaveAttribute('aria-checked', 'true');
  const initial = await sampleDecorations(page);
  for (const target of initial.targets) {
    expect(target.elements.length, `${target.selector} must really match the production DOM`).toBeGreaterThan(0);
    for (const element of target.elements) {
      if (target.animation) expect(element.animations.map(animation => animation.name), target.selector).toContain(target.animation);
    }
  }
  await expect.poll(async () => motionStateProblems(await sampleDecorations(page), 'running'), { intervals: [50], timeout: 2500 }).toEqual([]);
  const running = await measureDecorations(page);
  compareMotion(running.first, running.last, true);

  await sceneSwitch(page).click();
  await expect(sceneSwitch(page)).toHaveAttribute('aria-checked', 'false');
  // Soft checks retain every target's evidence while still exercising resume.
  const soft = expect.configure({ soft: true });
  await soft.poll(async () => motionStateProblems(await sampleDecorations(page), 'paused'), {
    message: 'all decorative animations, including the lantern and any canopy pseudos, pause',
    intervals: [50, 100], timeout: 1500,
  }).toEqual([]);
  const frozen = await measureDecorations(page);
  for (const sample of frozen.samples) compareMotion(frozen.first, sample, false);

  await sceneSwitch(page).click(); // Resume on chat so the existing DOM elements keep their animation clocks.
  await expect(sceneSwitch(page)).toHaveAttribute('aria-checked', 'true');
  await expect.poll(async () => motionStateProblems(await sampleDecorations(page), 'running'), { intervals: [50], timeout: 2500 }).toEqual([]);
  const resumed = await measureDecorations(page);
  compareMotion(frozen.last, resumed.last, true);
  compareMotion(resumed.first, resumed.last, true);

  // Synchronize with settings:
  await nav(page, '设置').click();
  await expect(scenes(page)).toHaveAttribute('aria-pressed', 'true');
  await scenes(page).click();
  await expect(scenes(page)).toHaveAttribute('aria-pressed', 'false');
  await nav(page, '对话').click();
  await expect(sceneSwitch(page)).toHaveAttribute('aria-checked', 'false');
  expect(offline.calls.model).toHaveLength(0);
});
