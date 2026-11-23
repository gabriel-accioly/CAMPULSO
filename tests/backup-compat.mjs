import { populatedWorkspace } from './backup-fixture.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {createServer} from 'vite';

const previousModule = process.env.CAMPULSO_POC001
  ? pathToFileURL(path.resolve(process.env.CAMPULSO_POC001, 'public/domain/backup.js'))
  : new URL('../reference/poc001-domain/backup.js', import.meta.url);
const previous = await import(previousModule.href);
const vite=await createServer({server:{middlewareMode:true,hmr:false},logLevel:'error'});
try {
  const current=await vite.ssrLoadModule('/src/domain/backup.ts');
  const { APP_VERSION } = await vite.ssrLoadModule('/src/application/workspace.ts');
  const baseline = await vite.ssrLoadModule('/reference/poc002-domain/backup.ts');
  const date='2026-11-21T12:00:00.000Z';
  const fixture=populatedWorkspace(date);
  const legacy=await previous.createBackup(fixture);
  const currentReader=await current.validateBackup(JSON.parse(JSON.stringify(legacy)));
  const exported=await current.createBackup(currentReader.data,{exportedAtUtc:date,appVersion:APP_VERSION});
  const oldReader=await previous.validateBackup(JSON.parse(JSON.stringify(exported)));
  assert.deepEqual(oldReader.data,fixture);
  assert.deepEqual(oldReader.integrity,legacy.integrity);
  for (const type of ['disponivel','r02-janela','replacement','replace','available','unavailable','blocked','block']) {
    const original = structuredClone(fixture);
    original.availabilityExceptions[0].type = type;
    const poc001File = await previous.createBackup(original);
    const poc002Read = await baseline.validateBackup(poc001File);
    const poc002File = await baseline.createBackup(poc002Read.data, { exportedAtUtc: date, appVersion: '0.1.0-poc002' });
    const validated = await current.validateBackup(poc002File);
    const c002File = await current.createBackup(validated.data, { exportedAtUtc: date, appVersion: APP_VERSION });
    for (const reader of [previous, baseline]) {
      const result = await reader.validateBackup(c002File);
      assert.deepEqual(result.data, original);
      assert.deepEqual(result.integrity, poc001File.integrity);
    }
  }
  console.log('POC-001 e POC-002 leram as reexportações da versão ' + APP_VERSION + ': 8 tipos, 11 coleções e integridade preservados.');
  console.log('POC-001 → ' + APP_VERSION + ' → POC-001: 11 coleções preenchidas; IDs, relações e digest preservados.',oldReader.integrity.dataDigestHex);
} finally {await vite.close();}

