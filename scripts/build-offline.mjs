import { createHash } from 'node:crypto';
import { copyFile, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
for (const name of ['LICENSE', 'NOTICE']) {
  await copyFile(fileURLToPath(new URL('../' + name, import.meta.url)), path.join(root, name));
}
const files = ['index.html', 'manifest.webmanifest', 'r02/icons/icone-192.png', 'r02/icons/icone-512.png'];
for (const file of (await readdir(path.join(root, 'assets'))).sort()) {
  if (/\.(?:js|css|otf|ttf|woff2?|svg|png|ico)$/.test(file)) files.push('assets/' + file);
}
files.sort();
const digest = createHash('sha256');
digest.update(await readFile(fileURLToPath(import.meta.url)));
const integrity = {};
for (const file of files) {
  const bytes = await readFile(path.join(root, file));
  const url = file === 'index.html' ? '/' : '/' + file;
  digest.update(url).update('\0').update(bytes);
  integrity[url] = 'sha256-' + createHash('sha256').update(bytes).digest('base64');
}
const release = digest.digest('hex').slice(0, 20);
const assets = Object.keys(integrity);
const worker = `/* Generated from the verified build; no timestamps or personal data. */
'use strict';
const CACHE_PREFIX = 'campulso-r02-static-';
const CACHE_NAME = CACHE_PREFIX + '${release}';
const ASSETS = ${JSON.stringify(assets)};
const SHELL = '/';
const INTEGRITY = ${JSON.stringify(integrity)};
const allowed = new Set(ASSETS);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // addAll commits atomically. Reject redirects and bytes outside this build.
    await cache.addAll(ASSETS.map(url => new Request(url, {
      cache: 'reload', redirect: 'error', mode: 'same-origin', integrity: INTEGRITY[url],
    })));
    // An update waits; there is deliberately no skipWaiting here.
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'CAMPULSO_ACTIVATE_UPDATE') event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const ownCaches = (await caches.keys()).filter(name => name.startsWith(CACHE_PREFIX));
    // Retain the previous static generation for another tab with an open form.
    const previous = ownCaches.filter(name => name !== CACHE_NAME).at(-1);
    await Promise.all(ownCaches.filter(name => name !== CACHE_NAME && name !== previous).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate' && url.pathname === '/index.html') {
    url.pathname = SHELL;
    event.respondWith(Response.redirect(url.href, 308));
    return;
  }
  if (request.mode === 'navigate' && [SHELL, '/r02/', '/r02/index.html'].includes(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match(SHELL)) || fetch(request);
    })());
    return;
  }
  if (url.search) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    if (allowed.has(url.pathname)) return (await cache.match(url.pathname)) || fetch(request);
    if (request.mode === 'navigate' && !url.pathname.split('/').pop().includes('.')) {
      try { return await fetch(request); } catch { return await cache.match(SHELL) || Response.error(); }
    }
    // Only previously precached URLs can be read here. Unknown responses,
    // downloads, JSON backups, APIs, and form submissions are never cached.
    if (!url.pathname.startsWith('/assets/')) return fetch(request);
    const ownCaches = (await caches.keys()).filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME);
    for (const name of ownCaches) {
      const hit = await (await caches.open(name)).match(request);
      if (hit) return hit;
    }
    return fetch(request);
  })());
});
`;
// Keep the previous worker URL updateable for existing same-origin installations.
await writeFile(path.join(root, 'sw.js'), worker, 'utf8');
await writeFile(path.join(root, 'r02/sw.js'), worker, 'utf8');
console.log(`Offline shell: ${files.length} static files; release ${release}.`);
