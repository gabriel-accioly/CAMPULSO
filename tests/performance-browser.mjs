import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium, firefox } from 'playwright';
import { preview } from 'vite';

// esbuild faz parte da instalação travada do Vite. O módulo de benchmark só existe no contexto de teste.
const require = createRequire(import.meta.url);
const esbuild = createRequire(require.resolve('vite/package.json'))('esbuild');
const channel = process.env.CAMPULSO_BROWSER || 'msedge';
const evidence = process.env.CAMPULSO_EVIDENCE_DIR || 'docs/etapa6/evidencias/desempenho';
const viewport = { width: 1440, height: 900 };
const contextOptions = { locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', viewport };
const sha256 = data => createHash('sha256').update(data).digest('hex');
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];

async function assets(root, subdir = '') {
  const files = [];
  for (const entry of await readdir(path.join(root, subdir), { withFileTypes: true })) {
    const name = path.posix.join(subdir, entry.name);
    if (entry.isDirectory()) files.push(...await assets(root, name));
    else {
      const bytes = await readFile(path.join(root, name));
      files.push({ name, bytes: bytes.length, gzipBytes: gzipSync(bytes).length, sha256: sha256(bytes) });
    }
  }
  return files.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

function installObservers() {
  const state = window.__perf = { readyMs: null, lcpMs: null, shifts: [], events: [], firstInputMs: null, supported: PerformanceObserver.supportedEntryTypes };
  const observer = new MutationObserver(() => {
    if (document.querySelector('main[aria-busy="false"] #today-title')) {
      state.readyMs = performance.now();
      observer.disconnect();
    }
  });
  observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-busy'] });
  const observe = (type, fn, options = {}) => {
    if (state.supported.includes(type)) {
      new PerformanceObserver(list => list.getEntries().forEach(fn)).observe({ type, buffered: true, ...options });
    }
  };
  observe('largest-contentful-paint', entry => { state.lcpMs = entry.startTime; });
  observe('layout-shift', entry => { if (!entry.hadRecentInput) state.shifts.push([entry.startTime, entry.value]); });
  observe('event', entry => { if (entry.interactionId) state.events.push([entry.interactionId, entry.duration]); }, { durationThreshold: 16 });
  observe('first-input', entry => { state.firstInputMs = entry.duration; });
}

function largestShiftWindow(shifts) {
  let first = -Infinity, last = -Infinity, windowScore = 0, maximum = 0;
  for (const [time, score] of shifts) {
    if (time - last >= 1000 || time - first >= 5000) { first = time; windowScore = 0; }
    windowScore += score;
    maximum = Math.max(maximum, windowScore);
    last = time;
  }
  return maximum;
}

async function coldJourney(browser, origin) {
  const context = await browser.newContext(contextOptions);
  try {
    await context.addInitScript(installObservers);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(new URL('/r02/index.html?scenario=local', origin).href);
    await page.locator('#today-title').waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => window.__perf.readyMs !== null);
    if (channel !== 'firefox') await page.waitForFunction(() => window.__perf.lcpMs !== null);
    const route = name => page.locator('nav [data-page="' + name + '"]:visible').first();
    for (const name of ['tasks', 'agenda', 'subjects', 'today', 'tasks']) {
      await route(name).click();
      await page.locator('#' + name + '-title').waitFor();
    }
    await page.locator('[data-action="new-task"]:visible').first().click();
    await page.locator('#item-title').pressSequentially('Tarefa');
    await page.keyboard.press('Escape');
    await page.locator('#editor').waitFor({ state: 'detached' });
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    const measurement = await page.evaluate(async () => {
      // Permite a entrega de entradas assíncronas do último evento e da última pintura.
      await new Promise(resolve => setTimeout(resolve, 250));
      const nav = performance.getEntriesByType('navigation')[0];
      return { ...window.__perf, dclMs: nav.domContentLoadedEventEnd, loadMs: nav.loadEventEnd, interactionCount: performance.interactionCount ?? null };
    });
    const cdp = channel === 'firefox' ? null : await context.newCDPSession(page);
    const heap = cdp ? await cdp.send('Runtime.getHeapUsage') : null;
    const cls = measurement.supported.includes('layout-shift') ? largestShiftWindow(measurement.shifts) : null;
    const durations = [...measurement.events.map(([, duration]) => duration), measurement.firstInputMs].filter(value => value !== null);
    // Menos de 50 interações neste roteiro. Event Timing omite durações abaixo do piso de 16 ms.
    assert.ok(measurement.interactionCount === null || measurement.interactionCount < 50);
    const inpLabUpperBoundMs = durations.length ? Math.max(16, ...durations) : null;
    if (channel !== 'firefox') assert.ok(inpLabUpperBoundMs !== null && cls !== null, 'APIs de estabilidade/interação necessárias');
    assert.deepEqual(errors, []);
    return { ...measurement, cls, inpLabUpperBoundMs, heap };
  } finally { await context.close(); }
}

async function runPlanner(browser, origin) {
  const result = await esbuild.build({ entryPoints: ['tests/performance-fixture.mjs'], bundle: true, minify: true, format: 'iife', globalName: 'PerfFixture', write: false });
  const context = await browser.newContext(contextOptions);
  try {
    const page = await context.newPage();
    await page.route('**/benchmark-isolado', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Benchmark</title>' }));
    await page.goto(new URL('/benchmark-isolado', origin).href);
    await page.addScriptTag({ content: result.outputFiles[0].text });
    const cdp = channel === 'firefox' ? null : await context.newCDPSession(page);
    const heapBefore = cdp ? await cdp.send('Runtime.getHeapUsage') : null;
    const bench = await page.evaluate(() => window.PerfFixture.benchmark());
    const heapAfter = cdp ? await cdp.send('Runtime.getHeapUsage') : null;
    assert.equal(bench.counts.tasks, 2000);
    assert.equal(bench.counts.commitments, 500);
    assert.equal(bench.counts.subjects, 50);
    assert.equal(Object.keys(bench.counts).length, 11);
    await page.evaluate(() => window.PerfFixture.seedLargeWorkspace());
    await page.addInitScript(installObservers);
    await page.goto(new URL('/r02/index.html?scenario=local', origin).href);
    await page.locator('#today-title').waitFor();
    const tasksButton = page.locator('nav [data-page="tasks"]:visible').first();
    await tasksButton.evaluate(node => node.addEventListener('click', () => {
      const start = performance.now();
      requestAnimationFrame(() => requestAnimationFrame(() => { window.__perf.tasksOpenToSecondFrameMs = performance.now() - start; }));
    }, { capture: true, once: true }));
    await tasksButton.click();
    await page.locator('.task-row').first().waitFor();
    await page.waitForFunction(() => window.__perf.tasksOpenToSecondFrameMs !== undefined);
    const large = await page.evaluate(() => {
      return { readyMs: window.__perf.readyMs, tasksOpenToSecondFrameMs: window.__perf.tasksOpenToSecondFrameMs,
        visibleListItems: document.querySelectorAll('.task-row').length, documentElements: document.querySelectorAll('*').length };
    });
    large.heap = cdp ? await cdp.send('Runtime.getHeapUsage') : null;
    assert.equal(large.visibleListItems, 50);
    assert.equal(await page.locator('.task-row').first().getAttribute('aria-setsize'), '2000');
    await page.getByRole('button', { name: 'Mostrar mais tarefas' }).click();
    large.expandedRows = await page.locator('.task-row').count();
    assert.equal(large.expandedRows, 100);
    assert.ok(await page.locator('.task-row').nth(50).locator('.task-title-button').evaluate(node => node === document.activeElement));
    await page.locator('#task-course-filter').selectOption('s0000');
    await page.getByRole('button', { name: 'Tarefa 0', exact: true }).click();
    await page.locator('#editor').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('#editor').waitFor({ state: 'detached' });
    large.filteredRows = await page.locator('.task-row').count();
    assert.equal(large.filteredRows, 40);
    return { ...bench, p95Ms: percentile(bench.samples, .95), heapBefore, heapAfter, large };
  } finally { await context.close(); }
}

const server = await preview({ preview: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'error' });
let browser;
try {
  const origin = server.resolvedUrls.local[0];
  browser = channel === 'firefox' ? await firefox.launch() : await chromium.launch({ channel });
  const planner = await runPlanner(browser, origin);
  console.log(channel, 'RNF-12 p95 ms', planner.p95Ms);
  const samples = [];
  for (let i = 0; i < 7; i++) samples.push(await coldJourney(browser, origin));
  const dist = await assets('dist');
  const p75 = {};
  for (const field of ['lcpMs', 'inpLabUpperBoundMs', 'cls', 'readyMs', 'dclMs', 'loadMs']) {
    const values = samples.map(sample => sample[field]);
    p75[field] = values.includes(null) ? null : percentile(values, .75);
  }
  const report = { measuredAtUtc: new Date().toISOString(), packageVersion: JSON.parse(await readFile('package.json', 'utf8')).version,
    channel, browserVersion: browser.version(), viewport, os: os.type() + ' ' + os.release(), arch: os.arch(),
    cpu: os.cpus()[0].model, logicalCPUs: os.cpus().length, ramBytes: os.totalmem(), node: process.version,
    dist, totalBytes: dist.reduce((sum, file) => sum + file.bytes, 0), totalGzipBytes: dist.reduce((sum, file) => sum + file.gzipBytes, 0),
    p75, samples, planner };
  await mkdir(evidence, { recursive: true });
  await writeFile(path.join(evidence, 'desempenho-' + channel + '.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(channel, report.browserVersion, p75, 'RNF-12 p95 ms', planner.p95Ms);
  assert.ok(planner.p95Ms <= 500, 'RNF-12 excedido: ' + planner.p95Ms + ' ms');
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
