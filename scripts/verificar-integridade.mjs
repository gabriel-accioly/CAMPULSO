import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const lines = (await readFile(path.join(root, 'SHA256SUMS.txt'), 'utf8')).trimEnd().split(/\r?\n/);
const seen = new Set();
for (const line of lines) {
  const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
  assert.ok(match, 'Entrada inválida no manifesto.');
  const [, expected, relative] = match;
  assert.ok(!seen.has(relative) && !path.isAbsolute(relative) && !relative.split(/[\\/]/).includes('..'), 'Caminho inválido ou duplicado.');
  seen.add(relative);
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path.join(root, relative))) hash.update(bytes);
  assert.equal(hash.digest('hex'), expected, 'Arquivo divergente: ' + relative);
}
console.log('SHA-256 conferido para ' + seen.size + ' arquivos.');
