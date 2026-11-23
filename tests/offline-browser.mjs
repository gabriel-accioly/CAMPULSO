import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, firefox } from 'playwright';
import { preview } from 'vite';

const workerPath = fileURLToPath(new URL('../dist/sw.js', import.meta.url));
const originalWorker = await readFile(workerPath, 'utf8');
const staticFiles = JSON.parse(originalWorker.match(/const ASSETS = (\[[^;]+\]);/)[1]);
assert.ok(staticFiles.includes('/'));
assert.ok(staticFiles.every(file => !file.endsWith('.map') && !file.includes('?')));
assert.ok(staticFiles.every(file => file.startsWith('/assets/') || ['/', '/manifest.webmanifest', '/r02/icons/icone-192.png', '/r02/icons/icone-512.png'].includes(file)));
const server = await preview({ preview: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'error' });
let browser;
try {
  browser = process.env.CAMPULSO_BROWSER === 'firefox' ? await firefox.launch() : await chromium.launch(process.env.CAMPULSO_BROWSER_PATH
    ? { executablePath: process.env.CAMPULSO_BROWSER_PATH }
    : { channel: process.env.CAMPULSO_BROWSER || 'chromium' });
  const context = await browser.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', serviceWorkers: 'allow' });
  context.setDefaultTimeout(12000);
  const origin = server.resolvedUrls.local[0];
  const url = new URL('/index.html?scenario=local', origin).href;
  const external = [], errors = [];
  context.on('request', request => {
    const u = new URL(request.url());
    if (u.protocol.startsWith('http') && u.origin !== new URL(origin).origin) external.push(request.url());
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.locator('#today-title').waitFor();
  // This requires production entry to register the actual application worker.
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const cacheKeys = () => page.evaluate(async () => {
    const rows = [];
    for (const name of await caches.keys()) {
      if (name.startsWith('campulso-r02-static-')) {
        const cache = await caches.open(name);
        rows.push({ name, urls: (await cache.keys()).map(request => new URL(request.url).pathname).sort() });
      }
    }
    return rows;
  });
  const firstCaches = await cacheKeys();
  assert.equal(firstCaches.length, 1);
  assert.deepEqual(firstCaches[0].urls.sort(), [...staticFiles].sort());
  const databaseName = 'campulso-offline-test-' + crypto.randomUUID();
  await page.evaluate(async name => {
    await caches.open('other-project-do-not-delete');
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('records');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const transaction = db.transaction('records', 'readwrite');
      transaction.objectStore('records').put('before-offline', 'marker');
      await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error); });
    } finally { db.close(); }
    await fetch('/campulso-private-probe?value=do-not-cache');
  }, databaseName);
  assert.deepEqual(await cacheKeys(), firstCaches);

  await context.setOffline(true);
  await page.reload();
  await page.locator('#today-title').waitFor();
  await page.evaluate(() => document.fonts.ready);
  assert.ok(await page.locator('img[alt="CAMPULSO"]').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)));
  await page.evaluate(async name => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const transaction = db.transaction('records', 'readwrite');
      const table = transaction.objectStore('records');
      const before = await new Promise((resolve, reject) => { const request = table.get('marker'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      if (before !== 'before-offline') throw new Error('Offline read lost the prior value.');
      table.put('written-offline', 'marker');
      await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error); });
    } finally { db.close(); }
  }, databaseName);
  const second = await context.newPage();
  second.on('pageerror', error => errors.push(error.message));
  await second.goto(url + '#agenda');
  await second.locator('h1').first().waitFor();
  const readMarker = async target => target.evaluate(async name => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open(name, 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try { return await new Promise((resolve, reject) => { const request = db.transaction('records').objectStore('records').get('marker'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
    finally { db.close(); }
  }, databaseName);
  assert.equal(await readMarker(second), 'written-offline');

  await context.setOffline(false);
  await second.locator('nav [data-page="tasks"]:visible').first().click();
  const newTask = second.locator('[data-action="new-task"]:visible').first();
  await newTask.click();
  await second.locator('#item-title').fill('Tarefa anterior à atualização');
  await second.locator('#editor-form').getByRole('button', { name: 'Salvar', exact: true }).click();
  await second.locator('#editor').waitFor({ state: 'detached' });
  await newTask.click();
  await second.locator('#item-title').fill('Rascunho durante a atualização');
  await second.evaluate(() => {
    window.__offlineControllerChanges = 0;
    navigator.serviceWorker.addEventListener('controllerchange', () => window.__offlineControllerChanges++);
  });
  const changedWorker = originalWorker.replace(/const CACHE_NAME = CACHE_PREFIX \+ '[^']+';/, "const CACHE_NAME = CACHE_PREFIX + 'test-update-accepted';");
  await writeFile(workerPath, changedWorker, 'utf8');
  await page.evaluate(async () => { const registration = await navigator.serviceWorker.getRegistration('/'); await registration.update(); });
  const updateAction = target => target.getByRole('button', { name: 'Atualizar aplicativo', exact: true });
  await updateAction(page).waitFor();
  await updateAction(second).waitFor({ state: 'attached' });
  assert.ok(await updateAction(page).isEnabled());
  assert.ok(await updateAction(second).isDisabled());
  assert.ok(await page.evaluate(async () => Boolean((await navigator.serviceWorker.ready).waiting)));
  assert.equal(await second.evaluate(() => window.__offlineControllerChanges), 0);
  assert.equal(await readMarker(page), 'written-offline');
  await Promise.all([page.waitForEvent('domcontentloaded'), updateAction(page).click()]);
  await page.locator('#today-title').waitFor();
  await second.waitForFunction(() => window.__offlineControllerChanges > 0);
  assert.equal(await second.locator('#item-title').inputValue(), 'Rascunho durante a atualização');
  await page.locator('nav [data-page="tasks"]:visible').first().click();
  await page.getByRole('button', { name: 'Tarefa anterior à atualização', exact: true }).waitFor();
  const afterCaches = await cacheKeys();
  assert.equal(afterCaches.length, 2);
  assert.ok(afterCaches.some(row => row.name === firstCaches[0].name));
  assert.ok(afterCaches.some(row => row.name.endsWith('test-update-accepted')));
  assert.ok(await page.evaluate(async () => (await caches.keys()).includes('other-project-do-not-delete')));
  assert.equal(await readMarker(second), 'written-offline');
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ browser: browser.version(), offline: 'PASS', checks: ['allowlist static cache', 'query and private response not cached', 'reload offline', 'new tab offline', 'fonts and brand offline', 'IndexedDB read/write/reopen offline', 'update waits for consent', 'update preserves both open documents and drafts', 'update preserves IndexedDB', 'prior static generation retained', 'unrelated cache preserved', 'no third-party request', 'no page exception'], staticFiles: staticFiles.length }, null, 2));
} finally {
  await writeFile(workerPath, originalWorker, 'utf8');
  await browser?.close();
  await server.close();
}
