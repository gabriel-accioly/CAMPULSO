import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const { chromium } = createRequire(import.meta.url)('playwright');
const server = await createServer({server:{host:'127.0.0.1',port:0,strictPort:true},logLevel:'error'});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({channel:process.env.CAMPULSO_BROWSER || 'msedge'});
  const page = await browser.newPage();
  await page.goto(new URL('/diagnostic.html', server.resolvedUrls.local[0]).href);
  await page.getByRole('button',{name:'Atualizar diagnóstico'}).click();
  await page.getByText('Contagens relidas do banco Dexie.').waitFor();
  const name = 'campulso-test-' + crypto.randomUUID();
  await page.evaluate(async name => {
    const {openDatabase}=await import('/src/infrastructure/database.ts');
    const db=await openDatabase(name);
    await db.saveSubject({id:'s',name:'Disciplina fictícia',revision:1,createdAtUtc:new Date().toISOString()});
    db.close();
  },name);
  await page.reload();
  const rows=await page.evaluate(async name=>{
    const {openDatabase}=await import('/src/infrastructure/database.ts');
    const db=await openDatabase(name);
    try {return {counts:await db.counts(),snapshot:await db.snapshot()};} finally {db.close();}
  },name);
  assert.equal(Object.keys(rows.counts).length,11);
  assert.equal(rows.snapshot.subjects[0].id,'s');
  assert.equal(rows.counts.subjects,1);
  console.log('Persistência no Edge',browser.version(),': recarga, reabertura, contagens e snapshot de 11 coleções.');

  // Create v1 with the native engine before the Dexie adapter opens it.
  const migrated=await page.evaluate(async stores=>{
    const name='campulso-migration-'+crypto.randomUUID();
    const old=await new Promise((resolve,reject)=>{
      const req=indexedDB.open(name,10); // Dexie version 1 maps to native version 10.
      req.onupgradeneeded=()=>{
        for(const store of stores){
          const table=req.result.createObjectStore(store,{keyPath:store==='appMeta'?'key':'id'});
          if(store==='subjects') table.put({id:'s',name:'Legada',createdAtUtc:'2026-11-21T12:00:00Z'});
          if(store==='tasks') table.put({id:'t',title:'Legada',subjectId:'s'});
        }
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
    });
    old.close();
    const {openDatabase}=await import('/src/infrastructure/database.ts');
    const db=await openDatabase(name);
    try {return {version:db.verno,data:await db.snapshot()};} finally {db.close();}
  },Object.keys(rows.counts));
  assert.equal(migrated.version,2);
  assert.equal(migrated.data.tasks[0].revision,1);
  assert.equal(migrated.data.subjects[0].revision,1);
  assert.equal(migrated.data.tasks[0].subjectId,migrated.data.subjects[0].id);
  console.log('Migração nativa v1 → v2: IDs e vínculo preservados; revisões 1.');

  const rollback=await page.evaluate(async name=>{
    const {openDatabase}=await import('/src/infrastructure/database.ts');
    const db=await openDatabase(name);
    try {
      const before=await db.snapshot();
      const next=structuredClone(before);
      next.subjects[0].name='Substituta';
      next.appMeta.push({key:'falha',value:'fixture'});
      const hook=db.appMeta.hook('creating');
      const fail=()=>{throw Error('falha de teste após as demais gravações');};
      hook.subscribe(fail);
      let message;
      try {await db.replaceSnapshot(next);} catch(error){message=error.message;}
      finally {hook.unsubscribe(fail);}
      return {before,after:await db.snapshot(),message};
    } finally {db.close();}
  }, name);
  assert.match(rollback.message,/falha de teste/);
  assert.deepEqual(rollback.after,rollback.before);
  console.log('Rollback após escrita na última coleção: snapshot anterior integralmente preservado.');
} finally {
  await browser?.close();
  await server.close();
}
