import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve('dist');
const evidence=process.env.CAMPULSO_EVIDENCE_DIR || 'proof';
await mkdir(evidence,{recursive:true});
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
const manifestId=origin+'/r02/';
let ctx, session, installed=false;
try {
  const profile=await mkdtemp(path.join(tmpdir(),'CAMPULSO-PWA002-'));
  ctx=await chromium.launchPersistentContext(profile,{channel:'msedge',headless:false,viewport:null,locale:'pt-BR',
    args:['--no-first-run','--no-default-browser-check','--disable-background-networking']});
  const page=ctx.pages()[0] || await ctx.newPage();
  await page.goto(origin+'/?scenario=local');
  await page.locator('#today-title').waitFor();
  await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
  session=await ctx.newCDPSession(page);
  const manifest=await session.send('Page.getAppManifest');
  assert.equal(manifest.errors.length,0);
  const reasons=await session.send('Page.getInstallabilityErrors');
  assert.deepEqual(reasons.installabilityErrors,[]);
  await session.send('PWA.install',{manifestId,installUrlOrBundleUrl:origin+'/?scenario=local'});
  installed=true;
  const os=await session.send('PWA.getOsAppState',{manifestId});
  await session.send('PWA.changeAppUserSettings',{manifestId,displayMode:'standalone'});
  const {targetId}=await session.send('PWA.launch',{manifestId});
  assert.ok(targetId);
  let app;
  for (let i=0;i<60&&!app;i++){
    for (const p of ctx.pages()) {
      if(p!==page && await p.evaluate(()=>matchMedia('(display-mode: standalone)').matches).catch(()=>false)){app=p;break;}
    }
    if(!app)await new Promise(resolve=>setTimeout(resolve,200));
  }
  if(!app){
    console.log('launch',targetId,await session.send('Target.getTargetInfo',{targetId}));
    for (const p of ctx.pages()) console.log('window',await p.evaluate(()=>({path:location.pathname,title:document.title,mode:['browser','standalone','minimal-ui','window-controls-overlay'].filter(m=>matchMedia('(display-mode: '+m+')').matches)})).catch(()=>null));
  }
  assert.ok(app,'janela standalone');
  await app.locator('#today-title').waitFor();
  assert.equal(new URL(app.url()).pathname,'/');
  const registration=await app.evaluate(async()=>({scope:new URL((await navigator.serviceWorker.ready).scope).pathname,worker:new URL(navigator.serviceWorker.controller.scriptURL).pathname}));
  assert.deepEqual(registration,{scope:'/',worker:'/sw.js'});
  await app.screenshot({path:path.join(evidence,'edge-standalone.png')});
  networkOff=true;
  await app.reload();
  await app.locator('#today-title').waitFor();
  await app.goto(origin+'/agenda');
  await app.locator('#today-title').waitFor();
  await app.screenshot({path:path.join(evidence,'edge-offline.png')});
  const result={edge:ctx.browser().version(),install:'PWA.install',registeredOS:Boolean(os),launch:'PWA.launch',profileDisplayPreference:'standalone',standalone:true,installabilityErrors:[],start:'/?scenario=local',...registration,networkUnavailableReload:true,offlineNavigationFallback:true};
  await writeFile(path.join(evidence,'edge-install.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
} finally {
  networkOff=false;
  try {if(installed)await session.send('PWA.uninstall',{manifestId});}
  finally {await ctx?.close();await new Promise(resolve=>server.close(resolve));}
}
