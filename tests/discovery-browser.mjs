import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const [dist,origin,out]=process.argv.slice(2);
const {version} = JSON.parse(fs.readFileSync('package.json', 'utf8'));
assert.ok(['127.0.0.1','localhost'].includes(new URL(origin).hostname), 'Use o emulador local.');
const sha=x=>createHash('sha256').update(x).digest('hex');
const routes=[], started=new Date().toISOString();
const actual=p=>new URL(p,origin).href;
const files=fs.readdirSync(dist,{recursive:true}).filter(f=>fs.statSync(path.join(dist,f)).isFile()).map(f=>f.replaceAll('\\','/')).sort();
assert.equal(files.length,23);
for(const file of files.filter(x=>x!=='_headers')){
 const route=file==='404.html'?'/pagina-ausente-do-campulso':file.endsWith('index.html')?'/'+file.slice(0,-10):'/'+file;
 const resp=await fetch(actual(route),{redirect:'manual',signal:AbortSignal.timeout(15000)});
 assert.equal(resp.status,file==='404.html'?404:200,route);
 const bytes=Buffer.from(await resp.arrayBuffer());
 assert.equal(sha(bytes),sha(fs.readFileSync(path.join(dist,file))),route);
 assert.match(resp.headers.get('content-security-policy')||'',/script-src 'self'/);
 if(['/','/sobre/','/privacidade/'].includes(route))assert.doesNotMatch(resp.headers.get('x-robots-tag')||'',/noindex/i);
 if(route==='/sw.js')assert.match(resp.headers.get('x-robots-tag')||'',/noindex/i);
 routes.push({route,status:resp.status,bytes:bytes.length,sha256:sha(bytes),robots:resp.headers.get('x-robots-tag')});
}
const browser=await chromium.launch({channel:'msedge'});try{
 const ctx=await browser.newContext({locale:'pt-BR'}),page=await ctx.newPage();
 const errors=[],thirdParty=[];page.on('pageerror',e=>errors.push(e.message));ctx.on('request',r=>{if(r.url().startsWith('http')&&new URL(r.url()).origin!==new URL(origin).origin)thirdParty.push(new URL(r.url()).hostname)});
 await page.goto(actual('/'));await page.locator('#today-title').waitFor();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 const cache=await page.evaluate(async()=>{const k=(await caches.keys()).find(x=>x.startsWith('campulso-r02-static-'));return {name:k,urls:(await (await caches.open(k)).keys()).map(r=>new URL(r.url).pathname)}});
 assert.equal(cache.urls.length,14);
 const plain=await ctx.newPage();await plain.goto(actual('/#privacy'));const originalText=await plain.getByRole('article').innerText();const normalize=s=>s.replace(/\s+/g,' ').trim();
 const previews=[];for(const [route,type] of [['/','WebApplication'],['/sobre/','AboutPage'],['/privacidade/','WebPage']]){
 await page.goto(actual(route));const structured=await page.locator('script[type="application/ld+json"]').textContent();assert.equal(JSON.parse(structured)['@type'],type);
 if(route==='/') assert.equal(JSON.parse(structured).softwareVersion,version);
 if(route==='/sobre/') assert.ok((await page.locator('main').innerText()).includes('Versão do aplicativo: '+version));
 const canonical=await page.locator('link[rel=canonical]').getAttribute('href');assert.equal(canonical,'https://campulso.pages.dev'+route);
 assert.equal(await page.locator('meta[property="og:url"]').getAttribute('content'),canonical);
 const image=await page.locator('meta[property="og:image"]').getAttribute('content');assert.ok(routes.some(x=>x.route===new URL(image).pathname));
 for(const href of await page.locator('a[href]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')))){
  if(href.startsWith('/'))assert.ok(routes.some(row=>row.route===href.split('#')[0]),href);
 }
 previews.push({route,type,canonical,image});
 }
 assert.equal(normalize(await page.locator('main').innerText()),normalize(originalText));
 await page.setViewportSize({width:320,height:800});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await ctx.setOffline(true);for(const route of ['/sobre/','/privacidade/','/']){await page.goto(actual(route));await page.locator(route==='/'?'#today-title':'main h1').waitFor();if(route==='/privacidade/')assert.equal(normalize(await page.locator('main').innerText()),normalize(originalText));}
 assert.deepEqual(errors,[]);assert.deepEqual(thirdParty,[]);
 const report={started,origin,browser:browser.version(),files:files.length,routes,previews,cache,policyTextIdentical:true,offline:['/','/sobre/','/privacidade/'],errors,thirdParty};
 fs.writeFileSync(out,JSON.stringify(report,null,2));console.log('PASS',routes.length,'corpos HTTP; 3 canonicals; 14 recursos offline; política integral; 320 px.');
}finally{await browser.close();}
