import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [directory, port, output] = process.argv.slice(2);
assert.ok(directory && /^\d+$/.test(port) && output, 'node tests/pages-release.mjs DIST PORT RESULTADO.json');
const origin = 'http://127.0.0.1:' + port;
const files = await readdir(directory, { withFileTypes: true, recursive: true });
const observations = [];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function observe(url) {
  const res = await fetch(origin + url, { redirect: 'manual' });
  const row = { url, status: res.status, headers: Object.fromEntries(res.headers), sha256: sha(Buffer.from(await res.arrayBuffer())) };
  observations.push(row);
  return row;
}
try {
  for (const file of files.filter(f => f.isFile())) {
    const name = path.relative(directory, path.join(file.parentPath, file.name)).split(path.sep).join('/');
    if (['_headers', '404.html'].includes(name)) continue;
    const row = await observe(name.endsWith('index.html') ? '/' + name.slice(0,-10) : '/' + name);
    assert.equal(row.status, 200, name);
    assert.equal(row.sha256, sha(await readFile(path.join(directory, name))), name);
    assert.equal(row.headers['x-content-type-options'], 'nosniff');
    assert.equal(row.headers['referrer-policy'], 'no-referrer');
    assert.equal(row.headers['x-frame-options'], 'DENY');
    assert.match(row.headers['content-security-policy'], /script-src 'self'/);
    assert.match(row.headers['strict-transport-security'], /max-age=31536000/);
    assert.match(row.headers['cache-control'], name.startsWith('assets/') ? /immutable/ : /no-cache/);
    assert.ok(!row.headers['set-cookie']);
  }
  const redirect = await observe('/index.html?scenario=local');
  assert.equal(redirect.status, 308);
  assert.equal(new URL(redirect.headers.location, origin).href, origin + '/?scenario=local');
  for (const url of ['/fonte-inexistente.js.map','/package-lock.json','/backup-inexistente.json','/brand/matriz.svg','/caminho-inexistente','/_headers']) {
    const row = await observe(url);
    assert.equal(row.status, 404, url);
    assert.equal(row.sha256, sha(await readFile(path.join(directory, '404.html'))), url);
  }
} finally {
  await writeFile(output, JSON.stringify(observations, null, 2) + '\n');
}
console.log(observations.length + ' respostas locais verificadas.');
