import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
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
  const dest = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
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
 await page.locator('nav [data-page="tasks"]:visible').first().click();
 await page.locator('[data-action="new-task"]:visible').first().click();
 const title='Tarefa fictícia de verificação da recuperação';
 await page.locator('#item-title').fill(title);
 await page.locator('#editor-form').getByRole('button',{name:'Salvar',exact:true}).click();
 await page.locator('#editor').waitFor({state:'detached'});
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
 assert.ok(before.tasks.some(x=>x.title===title));
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
   networkOff=true;
   try {
     await page.reload(); await page.locator('#today-title').waitFor();
     assert.deepEqual(await snapshot(page),before);
   } finally { networkOff=false; }
   const sw = await readFile(path.join(folder,'sw.js')).catch(() => readFile(path.join(folder,'r02/sw.js')));
   transitions.push({etapa:name,swSHA256:createHash('sha256').update(sw).digest('hex'),colecoes:11,recargaOffline:true});
 }
 const result = {edge:browser.version(),perfilIsolado:true,transicoes:transitions};
 await writeFile(path.join(evidence,'edge-recuperacao.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
