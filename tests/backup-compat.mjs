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
  const baseline = await vite.ssrLoadModule('/reference/poc002-domain/backup.ts');
  const fixture=previous.emptyBackupData();
  const date='2026-11-21T12:00:00.000Z';
  fixture.subjects.push({id:'s',name:'Disciplina',createdAtUtc:date,revision:1});
  fixture.deadlines.push({id:'d',title:'Entrega',subjectId:'s',dueDate:'2026-11-23',revision:1});
  fixture.tasks.push({id:'t',title:'Tarefa',subjectId:'s',deadlineId:'d',estimateMinutes:30,remainingMinutes:30,importance:'media',status:'aberta',createdAtUtc:date,updatedAtUtc:date,revision:1});
  fixture.preferences.push({id:'local',mode:'normal',locale:'pt-BR',timeZone:'America/Sao_Paulo',updatedAtUtc:date});
  fixture.commitments.push({id:'c',title:'Aula',subjectId:'s',startAtUtc:date,endAtUtc:'2026-11-21T13:00:00.000Z',timeZone:'UTC',isFixed:true,revision:1});
  fixture.availabilityRules.push({id:'a',weekday:1,startLocalTime:'10:00',endLocalTime:'11:00',timeZone:'UTC',enabled:true});
  fixture.availabilityExceptions.push({id:'x',localDate:'2026-11-23',type:'disponivel'});
  fixture.planRuns.push({id:'r',createdAtUtc:date,algorithmVersion:'poc',inputRevision:1,mode:'normal',status:'aplicado',summary:'Plano',reasonCodes:[]});
  fixture.planBlocks.push({id:'b',taskId:'t',planRunId:'r',startAtUtc:date,endAtUtc:'2026-11-21T12:30:00.000Z',source:'manual',revision:1});
  fixture.planDecisions.push({id:'p',planRunId:'r',taskId:'t',code:'teste',messageKey:'teste',parameters:{}});
  fixture.appMeta.push({key:'schemaVersion',value:'2'});
  const legacy=await previous.createBackup(fixture);
  const currentReader=await current.validateBackup(JSON.parse(JSON.stringify(legacy)));
  const exported=await current.createBackup(currentReader.data,{exportedAtUtc:date,appVersion:'0.2.1'});
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
    const c002File = await current.createBackup(validated.data, { exportedAtUtc: date, appVersion: '0.2.1' });
    for (const reader of [previous, baseline]) {
      const result = await reader.validateBackup(c002File);
      assert.deepEqual(result.data, original);
      assert.deepEqual(result.integrity, poc001File.integrity);
    }
  }
  console.log('POC-001 e POC-002 leram as reexportações da Correção 002: 8 tipos, 11 coleções e integridade preservados.');
  console.log('POC-001 → Correção 002 → POC-001: 11 coleções preenchidas; IDs, relações e digest preservados.',oldReader.integrity.dataDigestHex);
} finally {await vite.close();}

