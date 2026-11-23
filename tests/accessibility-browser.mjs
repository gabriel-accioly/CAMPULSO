import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Run from a built candidate. axe-core is a separate, pinned testing tool.
const project = resolve(process.env.CAMPULSO_TEST_ROOT || '.');
const require = createRequire(join(project, 'package.json'));
const { chromium } = require('playwright');
const { preview } = await import(pathToFileURL(require.resolve('vite/package.json').replace(/package\.json$/, 'dist/node/index.js')));
const axeFile = process.env.CAMPULSO_AXE_PATH || require.resolve('axe-core/axe.min.js');
const output = resolve(process.env.CAMPULSO_A11Y_OUTPUT || 'docs/etapa6/acessibilidade');
await mkdir(output, { recursive: true });
const server = await preview({ root: project, configFile: false, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const origin = new URL('/?scenario=planned', server.resolvedUrls.local[0]);
const routes = ['today', 'agenda', 'tasks', 'subjects', 'availability', 'light', 'preview', 'settings', 'data', 'restore', 'help'];
const screens = [], keyboard = [], tabOrder = [], zoom = [], failures = [];
const launchOptions = process.env.CAMPULSO_BROWSER_PATH ? { executablePath: process.env.CAMPULSO_BROWSER_PATH } : { channel: 'msedge' };
let browser, page;

async function openRoute(route) {
  await page.goto(origin.href + '#' + (route === 'preview' ? 'today' : route));
  if (route === 'preview') await page.locator('[data-action="preview-normal"]:visible').first().click();
  await page.locator('#' + route + '-title').waitFor();
  await page.evaluate(() => document.fonts.ready);
}
async function scan(label) {
  await page.addScriptTag({ path: axeFile });
  const result = await page.evaluate(async () => {
    const audit = await window.axe.run(document, {
      runOnly: {type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22a','wcag22aa']},
    });
    const details = rules => rules.map(rule => ({
      id: rule.id, impact: rule.impact, help: rule.helpUrl,
      nodes: rule.nodes.map(node => ({ target: node.target, summary: node.failureSummary, checks: [...node.any, ...node.all, ...node.none].map(check => ({id: check.id, message: check.message, data: check.data})) })),
    }));
    return { axe: audit.testEngine.version, width: innerWidth, documentWidth: document.documentElement.scrollWidth,
      passed: audit.passes.map(rule => rule.id), notApplicable: audit.inapplicable.map(rule => rule.id),
      violations: details(audit.violations), incomplete: details(audit.incomplete) };
  });
  screens.push({ label, ...result });
  if (result.violations.length || result.documentWidth > result.width) failures.push(label + ': ' + result.violations.map(rule => rule.id) + ' ' + result.documentWidth + '/' + result.width);
  console.log(label, result.width, result.violations.map(rule => rule.id), result.documentWidth);
}
async function tabTo(target, reverse = false) {
  for (let step = 0; step < 180; step++) {
    await page.keyboard.press(reverse ? 'Shift+Tab' : 'Tab');
    if (await target.evaluate(el => el === document.activeElement)) return;
  }
  throw Error('Controle não alcançado pelo teclado: ' + target);
}
async function activate(target) {
  await tabTo(target);
  await page.keyboard.press('Enter');
}
async function traceFocus(route, width) {
  const count = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('a[href], button, input, select, textarea, summary')].filter(el =>
      el.getClientRects().length && !el.matches(':disabled') && !el.closest('[hidden]') &&
      (!el.closest('details:not([open])') || el.matches('details > summary')) && el.tabIndex >= 0);
    nodes.forEach((el,index) => el.setAttribute('data-audit-tab',String(index)));
    return nodes.length;
  });
  const visited = new Set(), sequence = [];
  for (let index=0; index<count*3+8 && visited.size<count; index++) {
    await page.keyboard.press('Tab');
    const entry = await page.evaluate(async () => {
      const el = document.activeElement, token = el.getAttribute('data-audit-tab');
      if (token === null) return null;
      let exposed = false;
      for (let frame=0; frame<35 && !exposed; frame++) {
        await new Promise(requestAnimationFrame);
        const box = el.getBoundingClientRect();
        const left = Math.max(0,box.left), right = Math.min(innerWidth,box.right);
        const top = Math.max(0,box.top), bottom = Math.min(innerHeight,box.bottom);
        if (right <= left || bottom <= top) continue;
        exposed = [0.1,0.5,0.9].some(fraction => el.contains(document.elementFromPoint((right+left)/2,top+(bottom-top)*fraction)));
      }
      return { token, name:el.getAttribute('aria-label') || el.labels?.[0]?.textContent?.trim() || el.innerText?.trim() || el.id,
        exposed, outline:getComputedStyle(el).outlineWidth };
    });
    if (!entry || visited.has(entry.token)) continue;
    visited.add(entry.token); sequence.push(entry);
  }
  tabOrder.push({ route,width,count,sequence });
  const missed = sequence.filter(entry => !entry.exposed || parseFloat(entry.outline) < 2);
  if (missed.length || count !== visited.size) failures.push('Tab '+route+' '+width+' '+visited.size+'/'+count+' '+JSON.stringify(missed));
}
async function check(label, action) {
  try { await action(); keyboard.push({ label, passou: true }); }
  catch (e) { failures.push(label + ': ' + e.message); keyboard.push({ label, passou: false, erro: e.message }); }
}
const btn = name => page.getByRole('button', { name, exact: true }).first();
try {
  browser = await chromium.launch(launchOptions);
  page = await browser.newPage({ viewport: { width: 1280, height: 1024 }, locale: 'pt-BR', serviceWorkers: 'block', reducedMotion:'reduce' });
  page.setDefaultTimeout(5000);
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: width === 320 ? 640 : 1024 });
    for (const route of routes) {
      await openRoute(route);
      await scan(route);
      if (['subjects','today','agenda','preview'].includes(route)) {
        const section = route === 'subjects' ? page.locator('.course-card').first() : page.locator('main');
        await section.screenshot({ path: join(output, route + '-' + width + '.png'), animations: 'disabled' });
      }
      await traceFocus(route,width);
    }
  }
  await check('Mais, Escape, destino e foco no título', async () => {
    await openRoute('today');
    const more = page.locator('#more-btn');
    await activate(more);
    assert.equal(await more.getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Tab');
    assert.ok(await page.locator('#more-menu').evaluate(el => el.contains(document.activeElement)));
    await page.keyboard.press('Escape');
    assert.ok(await more.evaluate(el => el === document.activeElement));
    await page.keyboard.press('Enter');
    await activate(page.locator('#more-menu').getByRole('button', { name:'Disciplinas' }));
    await page.waitForFunction(() => document.activeElement?.id === 'subjects-title');
  });
  await check('Disciplinas, contagem e rótulo sem quebra dentro das palavras a 320 px', async () => {
    await openRoute('subjects');
    assert.ok(await page.getByText('1 tarefa aberta', { exact: true }).count());
    const cut = await btn('Ver tarefas').evaluate(el => {
      const node = [...el.childNodes].find(n => n.nodeType === 3 && n.textContent.includes('tarefas'));
      const range = document.createRange(), start = node.textContent.indexOf('tarefas');
      range.setStart(node,start); range.setEnd(node,start+7);
      return range.getClientRects().length;
    });
    assert.equal(cut, 1);
  });
  await page.setViewportSize({ width:1280, height:1024 });
  await check('Atalho de conteúdo e foco visível', async () => {
    await page.goto(origin.href); await page.locator('#today-title').waitFor(); await page.keyboard.press('Tab');
    const skip = page.locator('.skip-link');
    assert.ok(await skip.evaluate(el => el === document.activeElement && el.matches(':focus-visible') && parseFloat(getComputedStyle(el).outlineWidth) >= 2));
    await page.keyboard.press('Enter'); assert.equal(await page.evaluate(() => document.activeElement.id), 'main');
  });
  await check('Agenda, alternância semanal, dia e avanço de período', async () => {
    await openRoute('agenda'); await activate(btn('Semana')); assert.equal(await btn('Semana').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('.week-day').count(), 7);
    await activate(page.locator('.week-day .btn').first()); assert.equal(await btn('Dia').getAttribute('aria-pressed'), 'true');
    const period = page.locator('.date-nav strong'), before = await period.innerText();
    await activate(btn('Próximo período')); assert.notEqual(await period.innerText(),before);
  });
  await check('Filtro de tarefas e estado pressionado', async () => {
    await openRoute('tasks'); await activate(btn('Concluídas')); assert.equal(await btn('Concluídas').getAttribute('aria-pressed'), 'true');
  });
  await check('Desfazer permanece disponível além de 9 segundos e pode ser dispensado', async () => {
    await openRoute('tasks');
    await activate(btn('Abertas'));
    await page.clock.install();
    const task = page.locator('[data-action="toggle-task"]').first();
    await activate(task); await btn('Desfazer').waitFor();
    await page.clock.fastForward(16000);
    assert.ok(await btn('Desfazer').isVisible());
    await activate(btn('Fechar aviso de conclusão'));
    assert.equal(await btn('Desfazer').count(),0);
    assert.equal(await page.evaluate(() => document.activeElement.id),'tasks-title');
    await page.goto(origin.href);
  });
  await check('Editor, obrigatório, foco no diálogo, Escape e retorno à origem', async () => {
    await openRoute('today'); const opener = btn('Nova tarefa'); await activate(opener);
    const dialog = page.getByRole('dialog', { name:'Nova tarefa' }); await dialog.waitFor();
    await scan('editor-tarefa'); await dialog.screenshot({ path: join(output,'dialogo-tarefa.png') });
    await activate(dialog.locator('button[type="submit"]'));
    assert.ok(await page.locator('#item-title').evaluate(el => el === document.activeElement && el.validity.valueMissing));
    for (let i=0; i<26; i++) {
      await page.keyboard.press('Tab');
      assert.ok(await dialog.evaluate(el => el.contains(document.activeElement) || document.activeElement === document.body));
    }
    await page.keyboard.press('Escape'); await dialog.waitFor({state:'detached'});
    assert.ok(await opener.evaluate(el => document.activeElement === el));
  });
  await check('Planejamento, revisão e descarte pelo teclado', async () => {
    await openRoute('today'); await activate(page.locator('[data-action="preview-normal"]').first());
    await page.waitForFunction(() => document.activeElement?.id === 'preview-title');
    await activate(page.locator('[data-action="discard-proposal"]'));
    await page.waitForFunction(() => document.activeElement?.id === 'today-title');
  });
  for (const [route, name] of [['agenda','Novo compromisso'], ['subjects','Nova disciplina'], ['tasks','Novo prazo'], ['availability','Nova janela'], ['availability','Nova exceção']]) {
    await check(name + ' pelo teclado', async () => {
      await openRoute(route); const opener = btn(name); await activate(opener);
      await page.getByRole('dialog').waitFor(); await scan(name);
      await page.keyboard.press('Escape');
      assert.ok(await opener.evaluate(el => el === document.activeElement));
    });
  }
  await check('Apagar dados exige confirmação explícita', async () => {
    await openRoute('data'); await activate(page.locator('details summary'));
    const checkbox = page.locator('details input[type=checkbox]');
    const confirm = btn('Confirmar remoção dos dados');
    assert.ok(await confirm.isDisabled()); await tabTo(checkbox); await page.keyboard.press('Space');
    assert.ok(await confirm.isEnabled()); await page.keyboard.press('Space'); assert.ok(await confirm.isDisabled());
  });
  await check('Restauração anuncia rejeição e descreve o limite do arquivo', async () => {
    await openRoute('restore');
    const file = page.getByLabel('Arquivo JSON do CAMPULSO');
    assert.equal(await file.getAttribute('aria-describedby'), 'backup-file-hint');
    await file.setInputFiles({ name:'vazio.json', mimeType:'application/json', buffer:Buffer.from('{}') });
    await page.getByRole('alert').first().waitFor(); await scan('erro de restauração');
  });
  await check('Hoje e Tarefas paginam 105 registros, transferem o foco e reiniciam os filtros', async () => {
    await page.goto(new URL('?scenario=local#today',origin).href);
    await page.locator('#today-title').waitFor();
    await page.evaluate(() => new Promise((resolve,reject) => {
      const open = indexedDB.open('campulso-poc002-r02');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction('tasks','readwrite');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
        for (let i=1; i<=105; i++) {
          const id = String(i).padStart(3,'0'), now = new Date().toISOString();
          tx.objectStore('tasks').add({ id, title:'Pesquisa '+id, estimateMinutes:15, remainingMinutes:15,
            importance:'media', status:'aberta', createdAtUtc:now, updatedAtUtc:now, revision:1 });
        }
      };
    }));
    await page.reload(); await page.locator('.task-row').first().waitFor();
    for (const route of ['today','tasks']) {
      if (route==='tasks') await activate(page.locator('.sidebar [data-page="tasks"]'));
      const rows = page.locator('.task-row');
      assert.equal(await rows.count(),50);
      for (const [start,end] of [[50,100],[100,105]]) {
        await activate(btn('Mostrar mais tarefas'));
        assert.equal(await rows.count(),end);
        const first = rows.nth(start);
        assert.ok(await first.evaluate(el => el.contains(document.activeElement)));
        assert.equal(await first.getAttribute('aria-posinset'),String(start+1));
        assert.equal(await first.getAttribute('aria-setsize'),'105');
      }
      assert.equal(await btn('Mostrar mais tarefas').count(),0);
    }
    await btn('Concluídas').press('Enter');
    assert.equal(await page.locator('.task-row').count(),0);
    await activate(btn('Todas'));
    assert.equal(await page.locator('.task-row').count(),50);
  });
  for (const factor of [2,4]) {
    const profile = await mkdtemp(join(tmpdir(),'campulso-a11y-zoom-'));
    await mkdir(join(profile,'Default'));
    await writeFile(join(profile,'Default','Preferences'),JSON.stringify({
      partition:{ default_zoom_level:{ x:Math.log(factor)/Math.log(1.2) } },
    }));
    const ctx = await chromium.launchPersistentContext(profile,{ ...launchOptions, headless:true, viewport:null,
      args:['--window-size=1280,1024','--force-device-scale-factor=1'], serviceWorkers:'block', reducedMotion:'reduce' });
    try {
      page = ctx.pages()[0]; page.setDefaultTimeout(5000);
      for (const route of routes) {
        await openRoute(route);
        const metrics = await page.evaluate(() => ({ dpr:devicePixelRatio, width:innerWidth, height:innerHeight, documentWidth:document.documentElement.scrollWidth }));
        zoom.push({ route, factor, ...metrics });
        assert.ok(Math.abs(metrics.dpr-factor)<0.01,'Escala nativa diferente da esperada: '+JSON.stringify(metrics));
        assert.ok(metrics.documentWidth<=metrics.width,'Overflow com zoom: '+route);
      }
      await openRoute('today'); await activate(page.locator('#more-btn'));
      await tabTo(page.locator('#more-menu button').last());
      const onTop = await page.locator('#more-menu button').last().evaluate(el => {
        const box = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2));
      });
      assert.ok(onTop);
      const cdp = await ctx.newCDPSession(page);
      const capture = await cdp.send('Page.captureScreenshot',{ format:'png', fromSurface:true, captureBeyondViewport:false });
      await writeFile(join(output,'menu-zoom-'+factor+'00.png'),Buffer.from(capture.data,'base64'));
    } finally { await ctx.close(); }
  }
} finally {
  await writeFile(join(output, 'resultado.json'), JSON.stringify({ dataUTC:new Date().toISOString(), browser:browser?.version(), screens, keyboard, tabOrder, zoom, failures }, null, 2));
  await browser?.close();
  await server.httpServer.close();
}
assert.deepEqual(failures, []);
