import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { createBackup } from '../reference/poc001-domain/backup.js';
import { populatedWorkspace } from './backup-fixture.mjs';
import { chromium } from 'playwright';

const previous = path.resolve(process.env.CAMPULSO_PREVIOUS_DIST);
const candidate = path.resolve(process.env.CAMPULSO_TEST_DIST || 'dist');
const evidence = process.env.CAMPULSO_EVIDENCE_DIR || 'proof';
await mkdir(evidence, { recursive: true });
let root = previous;
const mime = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.otf':'font/otf', '.webmanifest':'application/manifest+json'};
let networkOff = false;
const server = createServer(async (req,res) => {
  if (networkOff) {req.socket.destroy(); return;}
  const url = new URL(req.url, 'http://localhost');
  const dest = path.resolve(root, '.' + (decodeURIComponent(url.pathname) + (url.pathname.endsWith('/') ? 'index.html' : '')));
  if (!dest.startsWith(root + path.sep)) {res.writeHead(404).end(); return;}
  try {
    const body = await readFile(dest);
    res.writeHead(200, {'Content-Type':mime[path.extname(dest)] || 'text/plain','Cache-Control':'no-store'}).end(body);
  } catch {res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
let browser;
try {
 browser=await chromium.launch({channel:'msedge'});
 const ctx=await browser.newContext({locale:'pt-BR'});
 const page=await ctx.newPage();
 const previousRoot = await readFile(path.join(previous,'index.html'), 'utf8');
 const entry = previousRoot.includes('app-root') ? '/' : '/r02/index.html';
 await page.goto(origin + entry + '?scenario=local');
 await page.locator('#today-title').waitFor();
 await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
 async function download(p, label) {
   const pending = p.waitForEvent('download');
   await p.getByRole('button', {name: label, exact: true}).click();
   const file = await pending;
   assert.equal(await file.failure(), null);
   return readFile(await file.path());
 }
 async function restore(p, bytes) {
   await p.goto(origin + '/?scenario=local#restore');
   await p.locator('#backup-file').setInputFiles({name:'ensaio.json', mimeType:'application/json', buffer:bytes});
   await p.getByText('Arquivo validado', {exact:true}).waitFor();
   await download(p, 'Baixar cópia antes de substituir');
   await p.getByLabel('Guardei minha cópia e confirmo a substituição de todos os dados deste espaço.').check();
   await p.getByRole('button',{name:'Confirmar restauração',exact:true}).click();
   await p.locator('#data-title').waitFor();
 }
 async function exportFile(p) {
   await p.goto(origin + '/?scenario=local#data');
   return download(p, 'Exportar JSON');
 }
 const sample = populatedWorkspace('2026-11-21T12:00:00.000Z');
 await restore(page, Buffer.from(JSON.stringify(await createBackup(sample))));
 const originalFile = await exportFile(page);
 async function snapshot(p){
   return p.evaluate(async()=>{
     const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('campulso-poc002-r02');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
     try {
       const stores=[...db.objectStoreNames];const tx=db.transaction(stores);
       return Object.fromEntries(await Promise.all(stores.map(name=>new Promise((resolve,reject)=>{const r=tx.objectStore(name).getAll();r.onsuccess=()=>resolve([name,r.result]);r.onerror=()=>reject(r.error);}))));
     }finally{db.close();}
   });
 }
 const before=await snapshot(page);assert.equal(Object.keys(before).length,11);
 assert.ok(Object.values(before).every(rows => rows.length > 0));
 const candidateVersion = JSON.parse(await readFile('package.json')).version;
 const previousVersion = JSON.parse(originalFile).appVersion;
 let incoming = originalFile;
 const transitions = [];
 for (const [name, folder] of [['candidata',candidate], ['rollback',previous], ['recuperação',candidate]]) {
   root = folder;
   await page.evaluate(async () => { await (await navigator.serviceWorker.ready).update(); });
   const update = page.getByRole('button',{name:'Atualizar aplicativo',exact:true});
   await update.waitFor();
   await Promise.all([page.waitForEvent('domcontentloaded'),update.click()]);
   await page.goto(origin + (folder === previous ? entry : '/') + '?scenario=local');
   await page.locator('#today-title').waitFor();
   assert.deepEqual(await snapshot(page),before);
   const activeVersion = folder === previous ? previousVersion : candidateVersion;
   const backupContext = await browser.newContext({locale:'pt-BR'});
   try {
     const freshPage = await backupContext.newPage();
     await restore(freshPage, incoming);
     const restored = await snapshot(freshPage);
     const comparable = data => ({...data,appMeta:data.appMeta.filter(row=>row.key!=='r02.revision')});
     assert.deepEqual(comparable(restored), comparable(before));
     const reexport = await exportFile(freshPage);
     const envelope = JSON.parse(reexport);
     assert.equal(envelope.appVersion,activeVersion);
     assert.equal(envelope.backupFormatVersion,1);
     assert.equal(envelope.dbSchemaVersion,2);
     incoming = reexport;
   } finally { await backupContext.close(); }
   let offlineHTMLSHA256;
   networkOff=true;
   try {
     await page.reload(); await page.locator('#today-title').waitFor();
     assert.deepEqual(await snapshot(page),before);
     offlineHTMLSHA256 = await page.evaluate(async () => {
       const response = await fetch('/');
       const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
       return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,'0')).join('');
     });
     assert.equal(offlineHTMLSHA256,createHash('sha256').update(await readFile(path.join(folder,'index.html'))).digest('hex'));
   } finally { networkOff=false; }
   const sw = await readFile(path.join(folder,'sw.js')).catch(() => readFile(path.join(folder,'r02/sw.js')));
   transitions.push({etapa:name,swSHA256:createHash('sha256').update(sw).digest('hex'),versao:activeVersion,offlineHTMLSHA256,colecoes:11,contagens:Object.fromEntries(Object.entries(before).map(([k,v])=>[k,v.length])),snapshotSHA256:createHash('sha256').update(JSON.stringify(before)).digest('hex'),restauracaoEmPerfilVazio:true,backupSHA256:createHash('sha256').update(incoming).digest('hex'),recargaOffline:true});
 }
 const result = {edge:browser.version(),versaoAnterior:previousVersion,versaoCandidata:candidateVersion,perfilIsolado:true,transicoes:transitions};
 await writeFile(path.join(evidence,'edge-recuperacao.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
