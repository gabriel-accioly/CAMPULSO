import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { preview } from 'vite';

const evidence = process.env.CAMPULSO_EVIDENCE_DIR || 'proof';
const axePath = process.env.CAMPULSO_AXE_PATH;
assert.ok(axePath, 'Informe CAMPULSO_AXE_PATH com o axe.min.js a utilizar.');
await mkdir(evidence, { recursive: true });
const source = await readFile('PRIVACY.md', 'utf8');
const normalize = text => text.replace(/\s+/g, ' ').trim();
const expectedText = normalize(source.replace(/^#{1,2} |^- /gm, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'));
const expectedLinks = Array.from(source.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g), m => [m[1], m[2]]);
const server = await preview({ preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
let serverClosed = false;
let browser;
try {
  browser = await chromium.launch({ channel: process.env.CAMPULSO_BROWSER || 'msedge' });
  const context = await browser.newContext({ locale: 'pt-BR', viewport: { width: 1280, height: 900 } });
  const origin = server.resolvedUrls.local[0];
  const unexpected = [];
  const errors = [];
  context.on('request', req => {
    if (new URL(req.url()).origin !== new URL(origin).origin || req.method() !== 'GET' || req.postDataBuffer()) unexpected.push(req.url());
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const link = page.locator('a[href="#privacy"]');
  const article = page.getByRole('article');
  await page.goto(origin);
  await page.locator('#today-title').waitFor();
  assert.match(await page.locator('main .privacy-notice').innerText(), /neste navegador.*backup JSON/s);
  let tabCount = 0;
  while (tabCount < 100 && !(await link.evaluateAll(nodes => nodes.includes(document.activeElement)))) {
    await page.keyboard.press('Tab');
    tabCount++;
  }
  assert.ok(tabCount < 100, 'Link alcançado pela ordem de tabulação.');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.id === 'privacy-title');
  await page.keyboard.press('Tab');
  assert.equal(await page.locator(':focus').getAttribute('href'), 'mailto:accioly.ga@hotmail.com');
  assert.equal(await page.title(), 'CAMPULSO · Política de Privacidade');
  assert.equal(await page.locator('html').getAttribute('lang'), 'pt-BR');
  assert.equal(normalize(await article.innerText()), expectedText);
  const links = await article.getByRole('link').evaluateAll(nodes => nodes.map(n => [n.textContent, n.getAttribute('href')]));
  assert.deepEqual(links, expectedLinks);
  const sections = await article.getByRole('heading', { level: 2 }).allTextContents();
  assert.deepEqual(sections, source.split(/\r?\n/).filter(line => line.startsWith('## ')).map(line => line.slice(3)));
  assert.equal(await article.getByRole('listitem').count(), 11);
  const accessibility = await article.ariaSnapshot();
  assert.match(accessibility, /heading .*\[level=1\]/);
  assert.match(accessibility, /listitem/);
  await writeFile(path.join(evidence, 'politica-arvore-acessivel.txt'), accessibility + '\n');
  await page.goBack();
  await page.locator('#today-title').waitFor();
  const routes = ['today', 'agenda', 'tasks', 'subjects', 'availability', 'preview', 'light', 'settings', 'data', 'restore', 'help'];
  for (const route of routes) {
    await page.goto(origin + '#' + route);
    await page.locator('#' + route + '-title').waitFor();
    assert.ok(await page.locator('footer a[href="#privacy"]').isVisible());
  }
  await page.goto(origin + '#data');
  await page.locator('#data-title').waitFor();
  assert.match(await page.locator('main .note-box').first().innerText(), /não é criptografado/);
  await page.locator('main a[href="#privacy"]').click();
  await article.waitFor();
  const screens = [];
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => document.fonts.ready);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.addScriptTag({ path: axePath });
    const findings = await page.evaluate(async () => {
      const result = await window.axe.run(document);
      return { version: result.testEngine.version, violations: result.violations.map(x => x.id), incomplete: result.incomplete.map(x => x.id) };
    });
    assert.deepEqual(findings.violations, []);
    screens.push({ width, ...findings });
    await page.screenshot({ path: path.join(evidence, 'politica-' + width + '.png') });
  }
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const cache = await page.evaluate(async () => {
    const name = (await caches.keys()).find(key => key.startsWith('campulso-r02-static-'));
    return { name, assets: (await (await caches.open(name)).keys()).map(req => new URL(req.url).pathname).sort() };
  });
  assert.equal(cache.assets.length, 11);
  await server.close();
  serverClosed = true;
  await context.setOffline(true);
  await page.reload();
  await article.waitFor();
  assert.equal(normalize(await article.innerText()), expectedText);
  await page.goto(origin + '#data');
  await page.locator('main a[href="#privacy"]').click();
  await article.waitFor();
  assert.equal(normalize(await article.innerText()), expectedText);
  assert.deepEqual(unexpected, []);
  assert.deepEqual(errors, []);
  const report = { status: 'PASS', browser: browser.version(), policySHA256: createHash('sha256').update(source).digest('hex'), tabCount, routes, sections, links, screens, cache, fullTextMatched: true, serverClosedDuringOfflineCheck: true, unexpected, errors };
  await writeFile(path.join(evidence, 'privacidade-browser.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  if (!serverClosed) await server.close();
}
