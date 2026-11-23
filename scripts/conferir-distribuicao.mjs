import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.resolve(process.argv[2] || path.join(root, 'dist'));
const profile = process.argv[3] || 'base';
assert.ok(['base', 'descoberta'].includes(profile), 'Perfil esperado: base ou descoberta');
const manifestName = profile === 'descoberta' ? 'SHA256SUMS_DESCOBERTA.txt' : 'SHA256SUMS_DISTRIBUICAO.txt';
const manifest = await readFile(path.join(root, 'docs', manifestName), 'utf8');
const expected = new Map();
for (const line of manifest.trimEnd().split(/\r?\n/)) {
  const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
  assert.ok(match, 'Linha inválida no manifesto');
  const [, hash, filename] = match;
  assert.ok(!expected.has(filename), 'Caminho duplicado');
  expected.set(filename, hash);
}
const found = [];
for (const item of await readdir(dist, {recursive:true, withFileTypes:true})) {
  if (item.isDirectory()) continue;
  assert.ok(item.isFile(), 'Entrada não regular no pacote');
  const file = path.join(item.parentPath, item.name);
  const name = path.relative(dist, file).split(path.sep).join('/');
  assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'), expected.get(name), name);
  found.push(name);
}
assert.deepEqual(found.sort(), [...expected.keys()].sort());
console.log(found.length + ' arquivos conferidos por SHA-256.');
