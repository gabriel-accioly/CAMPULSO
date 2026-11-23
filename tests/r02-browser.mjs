import assert from 'node:assert/strict';
import path from 'node:path';
import {writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {preview} from 'vite';

const {chromium}=createRequire(import.meta.url)('playwright');
const server=await preview({preview:{host:'127.0.0.1',port:0},logLevel:'error'});
let browser;
try {
  browser=await chromium.launch({channel:process.env.CAMPULSO_BROWSER||'msedge'});
  const ctx=await browser.newContext({timezoneId:'America/Sao_Paulo',locale:'pt-BR'});
  ctx.setDefaultTimeout(8000);
  const url=new URL('/r02/index.html',server.resolvedUrls.local[0]).href;
  const p=await ctx.newPage(), original=await ctx.newPage();
  const errors=[];
  p.on('pageerror',e=>errors.push(e.message));
  const originalPath=process.env.CAMPULSO_R02_HTML||path.resolve('../../UI/CAMPULSO_UI_ALTA_FIDELIDADE_R02.html');
  await original.route('**/referencia.html',route=>route.fulfill({path:originalPath,contentType:'text/html; charset=utf-8'}));
  async function ready(page){
    await page.waitForFunction(()=>window.CAMPULSO_DEMO && !!document.getElementById('today-title'));
    await page.evaluate(()=>document.fonts.ready);
  }
  await p.goto(url);await ready(p);
  await original.goto(new URL('/referencia.html',url).href);await ready(original);
  const screenshotResults=[];
  for(const viewport of [{width:1440,height:960},{width:390,height:844}]){
    for(const page of [p,original])await page.setViewportSize(viewport);
    const capture=page=>page.screenshot({animations:'disabled',caret:'hide'});
    const a=await capture(original),b=await capture(p);
    if(process.env.CAMPULSO_PROVAS){
      await writeFile(path.join(process.env.CAMPULSO_PROVAS,'original-'+viewport.width+'.png'),a);
      await writeFile(path.join(process.env.CAMPULSO_PROVAS,'integrada-'+viewport.width+'.png'),b);
    }
    const maskControl=page=>page.screenshot({animations:'disabled',caret:'hide',mask:[page.locator('#demo-scenario')]});
    const equal=a.equals(b);
    const equalOutsideSelector=equal || (await maskControl(original)).equals(await maskControl(p));
    assert.ok(equalOutsideSelector,'Diferença visual fora do seletor de ensaio em '+viewport.width+' px.');
    screenshotResults.push({width:viewport.width,equal,equalOutsideSelector});
    for(const page of [original,p]){
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    }
  }
  console.log('Comparação de pixels de Meu dia (referência/integração):',JSON.stringify(screenshotResults));
  console.log('Verificando destinos');
  const pages=await original.locator('.page').evaluateAll(nodes=>nodes.map(n=>n.id.slice(5)));
  assert.equal(pages.length,11);
  for(const name of pages){
    for(const page of [original,p])await page.evaluate(n=>window.go(n),name);
    assert.equal(await p.locator('#page-'+name).innerText(),await original.locator('#page-'+name).innerText());
  }
  assert.deepEqual(await p.evaluate(()=>window.CAMPULSO_DEMO.getState()),await original.evaluate(()=>window.CAMPULSO_DEMO.getState()));
  const dbNames=()=>p.evaluate(async()=>(await indexedDB.databases()).map(d=>d.name));
  assert.deepEqual(await dbNames(),[]);
  await p.setViewportSize({width:1440,height:960});
  await p.bringToFront();
  console.log('Verificando cenários');
  await p.selectOption('#demo-scenario','empty');await p.waitForURL(/scenario=empty/);await ready(p);
  assert.equal(await p.evaluate(()=>window.CAMPULSO_DEMO.getState().tasks.length),0);
  await p.selectOption('#demo-scenario','overloaded');await p.waitForURL(/scenario=overloaded/);await ready(p);
  await p.locator('.overload-notice:visible').first().waitFor();
  assert.deepEqual(await dbNames(),[]);
  await p.selectOption('#demo-scenario','local');await p.waitForURL(/scenario=local/);await ready(p);

  const state=()=>p.evaluate(()=>window.CAMPULSO_DEMO.getState());
  async function nav(name){
    const target=p.locator('[data-page="'+name+'"]:visible').first();
    if(!await target.count()) await p.locator('[data-page="settings"]:visible').first().click();
    await target.click();
  }
  const act=name=>p.locator('[data-action="'+name+'"]:visible').first().click();
  const revision=async n=>p.waitForFunction(v=>window.CAMPULSO_DEMO.getState().revision===v,n);
  const native=()=>p.evaluate(async()=>{
    const db=await new Promise((ok,fail)=>{const r=indexedDB.open('campulso-poc002-r02');r.onsuccess=()=>ok(r.result);r.onerror=()=>fail(r.error);});
    try{
      const names=[...db.objectStoreNames];
      const tx=db.transaction(names);
      return Object.fromEntries(await Promise.all(names.map(name=>new Promise((ok,fail)=>{
        const r=tx.objectStore(name).getAll();r.onsuccess=()=>ok([name,r.result]);r.onerror=()=>fail(r.error);
      }))));
    }finally{db.close();}
  });
  assert.equal((await state()).tasks.length,0);
  await act('new-task');await p.locator('#item-title').fill('Prova de integração');
  await p.locator('#item-course').fill('Disciplina fictícia');await p.locator('#item-date').fill('2027-02-01');
  await p.locator('#item-duration').fill('30');await p.locator('#editor-form [type=submit]').click();await revision(2);
  console.log('Tarefa local persistida');
  const id=(await state()).tasks[0].id;
  await p.reload();await ready(p);
  await nav('tasks');
  await act('edit-task');await p.locator('#item-title').fill('Prova revisada');await p.locator('#editor-form [type=submit]').click();await revision(3);
  await act('toggle-task');await revision(4);assert.ok((await state()).tasks[0].done);
  await p.getByRole('button',{name:'Desfazer'}).click();await revision(5);
  assert.ok(!(await state()).tasks[0].done);
  await nav('agenda');await act('new-commitment');
  await p.locator('#item-title').fill('Aula de ensaio');await p.locator('#item-course').fill('disciplina fictícia');
  await p.locator('[name=time]').fill('09:00');await p.locator('#item-duration').fill('60');
  await p.locator('#editor-form [type=submit]').click();await revision(6);
  await nav('availability');await p.fill('#availability-start','14:00');await p.fill('#availability-end','16:00');
  await p.locator('#availability-form [type=submit]').click();await revision(7);
  console.log('Agenda e janela persistidas');
  const before=await native();
  await nav('light');await act('preview-light');await act('discard-proposal');assert.deepEqual(await native(),before);
  await nav('light');await act('preview-light');await act('apply-proposal');await revision(8);
  await p.reload();await ready(p);
  const after=await native(),view=await state();
  assert.equal(view.tasks[0].id,id);assert.equal(view.tasks[0].due,'2027-02-01');
  assert.equal(view.tasks[0].title,'Prova revisada');assert.equal(after.subjects.length,1);
  assert.equal(after.tasks[0].deadlineId,after.deadlines[0].id);
  assert.equal(after.tasks[0].subjectId,after.commitments[0].subjectId);
  assert.deepEqual(after.commitments,before.commitments);assert.deepEqual(after.deadlines,before.deadlines);
  assert.equal(view.lightMode,true);assert.equal(after.preferences[0].mode,'leve');
  assert.equal(after.planRuns.length,1);assert.equal(after.planBlocks.length,1);
  assert.equal(after.planBlocks[0].taskId,id);assert.equal(view.blocks[0].start,840);
  console.log('Verificando duas abas');
  const second=await ctx.newPage();await second.goto(url+'?scenario=local');await ready(second);
  await nav('tasks');await act('toggle-task');await revision(9);
  await second.locator('[data-action=toggle-task]:visible').first().click();
  await second.getByText(/Outra aba alterou os dados/).waitFor();
  assert.equal((await native()).tasks[0].status,'concluida');
  await p.selectOption('#demo-scenario','planned');await p.waitForURL(/scenario=planned/);await ready(p);
  assert.equal((await state()).tasks.length,4);
  await p.selectOption('#demo-scenario','local');await p.waitForURL(/scenario=local/);await ready(p);
  assert.equal((await state()).tasks.length,1);assert.equal((await state()).tasks[0].id,id);
  assert.deepEqual(await dbNames(),['campulso-poc002-r02']);assert.deepEqual(errors,[]);
  console.log('R02 build/Edge',browser.version(),': 11 destinos, 3 cenários em memória, tarefa/edição/conclusão/desfazer, disciplina e prazo, compromisso, janela, descarte, aplicação, modo leve, recarga e concorrência aprovados.');
} finally {
  await browser?.close();await server.close();
}
