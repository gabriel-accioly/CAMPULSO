import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';
import { preview } from 'vite';

// Runs only against the production build, in a new isolated browser context.
// Nothing is written into a user's browser profile or an existing CAMPULSO database.
const fixedNow = new Date('2026-11-23T11:00:00.000Z');
const databaseName = 'campulso-poc002-r02';
const results = [];
const errors = [], externalRequests = [];
const requests = [];
const assets = new Set((await readdir('dist', { recursive: true })).map(name => '/' + name.replaceAll('\\', '/')));
assets.add('/');
const server = await preview({ preview: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'error' });
const origin = server.resolvedUrls.local[0];
const url = new URL('/index.html', origin).href;
let browser, context, page;

async function check(name, fn) {
  await fn(); results.push(name); console.log(`PASS ${name}`);
}
async function newPage() {
  const target = await context.newPage();
  target.on('pageerror', error => errors.push(error.message));
  await target.clock.setFixedTime(fixedNow);
  return target;
}
async function ready(target = page) { await target.locator('main h1').first().waitFor(); await target.evaluate(() => document.fonts.ready); }
async function idle(target = page) { await target.locator('#main[aria-busy="false"]').waitFor(); }
const button = (name, target = page) => target.getByRole('button', { name, exact: true });
async function act(action, target = page) { await target.locator(`[data-action="${action}"]:visible`).first().click(); }

async function nav(route, target = page) {
  if (route === 'preview') { await nav('today', target); await act('preview-normal', target); }
  else if (route === 'restore') { await nav('data', target); await target.locator('[data-page="restore"]:visible').first().click(); }
  else if (route === 'light' && await target.locator('.sidebar:visible').count()) { await nav('today', target); await target.locator('[data-page="light"]:visible').first().click(); }
  else {
    const direct = target.locator(`nav [data-page="${route}"]:visible`).first();
    if (await direct.count()) await direct.click();
    else {
      await target.locator('#more-btn').click();
      const labels = { subjects: 'Disciplinas', availability: 'Disponibilidade', light: 'Modo leve', settings: 'Ajustes', data: 'Seus dados', help: 'Ajuda' };
      await target.locator('#more-menu').getByRole('button', { name: labels[route], exact: true }).click();
    }
  }
  await target.locator(`#${route}-title`).waitFor();
}

async function snapshot(target = page) {
  return target.evaluate(async name => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('Expected an existing test database.')); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const names = [...db.objectStoreNames], transaction = db.transaction(names);
      return Object.fromEntries(await Promise.all(names.map(store => new Promise((resolve, reject) => {
        const request = transaction.objectStore(store).getAll();
        request.onsuccess = () => resolve([store, request.result]);
        request.onerror = () => reject(request.error);
      }))));
    } finally { db.close(); }
  }, databaseName);
}
async function save(target = page) { await target.locator('#editor-form').getByRole('button', { name: 'Salvar', exact: true }).click(); await target.locator('#editor').waitFor({ state: 'detached' }); await idle(target); }
async function downloaded(trigger, target = page) {
  const event = target.waitForEvent('download'); await trigger();
  const download = await event, stream = await download.createReadStream();
  assert.ok(stream, 'The browser offered readable bytes for the export.');
  const chunks = []; for await (const chunk of stream) chunks.push(chunk);
  assert.equal(await download.failure(), null);
  return { name: download.suggestedFilename(), buffer: Buffer.concat(chunks) };
}
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}
function withoutRevision(data) { const next = structuredClone(data); next.appMeta = next.appMeta.filter(row => row.key !== 'r02.revision'); return next; }
async function chooseBackup(buffer, name = 'CAMPULSO-teste.json') { await page.locator('#backup-file').setInputFiles({ name, mimeType: 'application/json', buffer }); await idle(); }

try {
  browser = process.env.CAMPULSO_BROWSER === 'firefox' ? await firefox.launch() : await chromium.launch(process.env.CAMPULSO_BROWSER_PATH
    ? { executablePath: process.env.CAMPULSO_BROWSER_PATH }
    : { channel: process.env.CAMPULSO_BROWSER || 'chromium' });
  context = await browser.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', viewport: { width: 1440, height: 960 }, acceptDownloads: true, serviceWorkers: 'allow' });
  context.setDefaultTimeout(12000);
  context.on('request', request => {
    const u = new URL(request.url());
    if (!['https:', 'http:'].includes(u.protocol)) return;
    if (u.origin !== new URL(origin).origin) externalRequests.push(request.url());
    requests.push({ method: request.method(), path: u.pathname, query: u.search, bodyBytes: request.postDataBuffer()?.length ?? 0 });
  });
  page = await newPage();
  await page.goto(url + '?scenario=planned'); await ready();

  await check('Três cenários de demonstração funcionam sem criar IndexedDB', async () => {
    assert.equal(await page.locator('.task-row').count(), 4);
    await page.selectOption('#demo-scenario', 'empty'); await page.waitForURL(/scenario=empty/); await ready();
    assert.equal(await page.locator('.task-row').count(), 0);
    await page.selectOption('#demo-scenario', 'overloaded'); await page.waitForURL(/scenario=overloaded/); await ready();
    await page.locator('.overload-notice').first().waitFor();
    assert.deepEqual(await page.evaluate(async () => (await indexedDB.databases()).map(db => db.name)), []);
    await page.selectOption('#demo-scenario', 'local'); await page.waitForURL(/scenario=local/); await ready();
    assert.equal((await snapshot()).tasks.length, 0);
    await page.goto(new URL('/', origin).href); await ready();
    assert.equal(await page.locator('#demo-scenario').inputValue(), 'local');
  });

  let subjectId, taskId, taskTitle = 'Resenha <img src=x onerror="window.__campulsoXss=1">';
  await check('Cadastro de disciplina e tarefa com prazo date-only, progresso e destaque', async () => {
    await nav('subjects'); await button('Nova disciplina').click(); await page.fill('#subject-name', 'Ciências Sociais'); await save();
    subjectId = (await snapshot()).subjects[0].id;
    await nav('tasks'); await act('new-task'); await page.fill('#item-title', taskTitle); await page.selectOption('#item-course', subjectId);
    await page.fill('#item-duration', '60'); await page.fill('#task-remaining', '35'); await page.selectOption('#task-importance', 'alta'); await page.locator('[name="pinned"]').check();
    await page.selectOption('#deadline-mode', 'date'); await page.fill('#item-date', '2026-11-24'); await save();
    const data = await snapshot(), task = data.tasks[0]; taskId = task.id;
    assert.equal(task.subjectId, subjectId); assert.equal(task.remainingMinutes, 35); assert.equal(task.importance, 'alta'); assert.equal(task.pinned, true);
    assert.equal(data.deadlines.find(row => row.id === task.deadlineId).dueDate, '2026-11-24');
    assert.equal(data.deadlines[0].dueAtUtc, undefined);
    assert.equal(await page.locator('.task-row').getByRole('button', { name: taskTitle, exact: true }).innerText(), taskTitle);
    assert.equal(await page.locator('.task-row img').count(), 0);
    assert.equal(await page.evaluate(() => window.__campulsoXss), undefined);
  });

  await check('Editar, concluir e desfazer conserva o esforço informado', async () => {
    await act('edit-task'); taskTitle = 'Resenha revisada'; await page.fill('#item-title', taskTitle); await page.fill('#item-duration', '75'); await page.fill('#task-remaining', '45'); await save();
    await act('toggle-task'); await idle();
    assert.equal((await snapshot()).tasks[0].status, 'concluida');
    await button('Desfazer').click(); await idle();
    const task = (await snapshot()).tasks[0]; assert.equal(task.id, taskId); assert.equal(task.status, 'aberta'); assert.equal(task.remainingMinutes, 45);
  });

  await check('Renomear, arquivar e restaurar disciplina preserva referências', async () => {
    await nav('subjects'); await button('Renomear').click(); await page.fill('#subject-name', 'Ciências Humanas'); await save();
    assert.equal((await snapshot()).tasks[0].subjectId, subjectId);
    await button('Arquivar').click(); await idle();
    assert.ok((await snapshot()).subjects[0].archivedAtUtc);
    await nav('tasks'); await act('new-task');
    assert.equal(await page.locator(`#item-course option[value="${subjectId}"]`).count(), 0);
    await page.keyboard.press('Escape'); await page.locator('#editor').waitFor({ state: 'detached' });
    await nav('subjects'); await page.getByLabel('Mostrar arquivadas').check(); await button('Restaurar disciplina').click(); await idle();
    const data = await snapshot(); assert.equal(data.subjects[0].name, 'Ciências Humanas'); assert.equal(data.subjects[0].archivedAtUtc, undefined); assert.equal(data.tasks[0].subjectId, subjectId);
  });

  await check('Escape fecha editor e devolve foco sem gravar', async () => {
    await nav('tasks'); const before = await snapshot();
    const opener = page.locator('[data-action="new-task"]').first(); await opener.click(); await page.fill('#item-title', 'Rascunho não salvo'); await page.keyboard.press('Escape');
    await page.locator('#editor').waitFor({ state: 'detached' }); assert.ok(await opener.evaluate(node => document.activeElement === node)); assert.deepEqual(await snapshot(), before);
  });

  await check('Agenda fixa, janela semanal e exceção específica persistem', async () => {
    await nav('agenda'); await act('new-commitment'); await page.fill('#item-title', 'Seminário da turma'); await page.selectOption('#item-course', subjectId);
    await page.fill('#event-start', '2026-11-23T09:00'); await page.fill('#event-end', '2026-11-23T10:00'); await page.selectOption('#event-kind', 'aula'); await save();
    await nav('availability'); await button('Nova janela').click(); await page.selectOption('#rule-weekday', '1'); await page.fill('#window-start', '09:00'); await page.fill('#window-end', '12:00'); await save();
    await button('Nova exceção').click(); await page.fill('#exception-date', '2026-11-23'); await page.fill('#window-start', '14:00'); await page.fill('#window-end', '16:00'); await save();
    const data = await snapshot(); assert.equal(data.commitments[0].startAtUtc, '2026-11-23T12:00:00.000Z'); assert.equal(data.commitments[0].subjectId, subjectId);
    assert.equal(data.availabilityRules.length, 1); assert.equal(data.availabilityExceptions[0].startLocalTime, '14:00');
    await nav('tasks'); await act('new-task'); await page.fill('#item-title', 'Leitura complementar'); await page.fill('#item-duration', '120'); await page.fill('#task-remaining', '120'); await save();
  });

  await check('Prévia e descarte não gravam; aplicar muda somente o plano e preferência', async () => {
    const before = await snapshot(); await nav('preview'); assert.deepEqual(await snapshot(), before);
    await act('discard-proposal'); assert.deepEqual(await snapshot(), before);
    await nav('preview'); await act('apply-proposal'); await page.locator('#today-title').waitFor(); await idle();
    const normal = await snapshot(); assert.ok(normal.planBlocks.length > 0);
    assert.deepEqual(normal.tasks, before.tasks); assert.deepEqual(normal.deadlines, before.deadlines); assert.deepEqual(normal.commitments, before.commitments);
    const normalMinutes = normal.planBlocks.reduce((sum, row) => sum + (Date.parse(row.endAtUtc) - Date.parse(row.startAtUtc)) / 60000, 0);
    assert.equal(normalMinutes, 120);
    assert.ok(normal.planBlocks.every(row => row.startAtUtc >= '2026-11-23T17:00:00.000Z' && row.endAtUtc <= '2026-11-23T19:00:00.000Z'));
    await nav('light'); await act('preview-light'); await act('apply-proposal'); await page.locator('#today-title').waitFor(); await idle();
    const light = await snapshot(), lightMinutes = light.planBlocks.reduce((sum, row) => sum + (Date.parse(row.endAtUtc) - Date.parse(row.startAtUtc)) / 60000, 0);
    assert.equal(light.preferences[0].mode, 'leve'); assert.ok(lightMinutes <= 72 && lightMinutes < normalMinutes);
    assert.deepEqual(light.tasks, before.tasks); assert.deepEqual(light.deadlines, before.deadlines); assert.deepEqual(light.commitments, before.commitments);
  });

  await check('Recarga e nova aba recuperam o mesmo snapshot', async () => {
    const before = await snapshot(); await page.reload(); await ready(); assert.deepEqual(await snapshot(), before);
    const other = await newPage(); await other.goto(url + '?scenario=local'); await ready(other); assert.deepEqual(await snapshot(other), before); await other.close();
  });

  await check('Uma aba desatualizada é rejeitada sem sobrescrever a edição mais recente', async () => {
    const stale = await newPage(); await stale.goto(url + '?scenario=local#tasks'); await ready(stale);
    await nav('tasks'); await page.locator('.task-row').getByRole('button', { name: taskTitle, exact: true }).click(); await page.fill('#item-title', 'Resenha consolidada'); await save(); taskTitle = 'Resenha consolidada';
    const before = await snapshot();
    await stale.locator('.task-row').getByRole('button', { name: 'Resenha revisada', exact: true }).click(); await stale.fill('#item-title', 'Edição obsoleta'); await stale.locator('#editor-form').getByRole('button', { name: 'Salvar', exact: true }).click();
    await stale.locator('#editor [role="alert"]').filter({ hasText: 'Outra aba' }).waitFor(); assert.deepEqual(await snapshot(), before);
    assert.equal(await stale.inputValue('#item-title'), 'Edição obsoleta'); await stale.close();
  });

  let exported, exportedData;
  await check('Download JSON contém todas as coleções e digest verificável', async () => {
    await nav('data'); exported = await downloaded(() => button('Exportar JSON').click()); exportedData = JSON.parse(exported.buffer.toString('utf8'));
    assert.equal(exportedData.product, 'CAMPULSO'); assert.equal(exportedData.dbSchemaVersion, 2); assert.equal(Object.keys(exportedData.data).length, 11);
    assert.equal(exportedData.integrity.canonicalization, 'CAMPULSO-CJSON-1');
    assert.equal(createHash('sha256').update(canonical(exportedData.data)).digest('hex'), exportedData.integrity.dataDigestHex);
    assert.deepEqual(exportedData.data, await snapshot());
  });

  await check('Restauração mostra prévia, permite cancelar e rejeita arquivos inválidos sem escrita', async () => {
    const before = await snapshot(); await nav('restore'); await chooseBackup(exported.buffer, exported.name); await page.getByText('Arquivo validado', { exact: true }).waitFor();
    assert.deepEqual(await snapshot(), before); assert.ok(await button('Confirmar restauração').isDisabled()); await button('Cancelar').click(); assert.deepEqual(await snapshot(), before);
    const corrupted = structuredClone(exportedData); corrupted.data.tasks[0].title = 'Conteúdo adulterado';
    const deep = structuredClone(exportedData);
    let nested = {};
    for (let index = 0; index < 26; index++) nested = { next: nested };
    deep.data.extra = nested;
    const extension = structuredClone(exportedData);
    extension.data.availabilityExceptions[0].type = 'extension-not-reviewed';
    extension.integrity.dataDigestHex = createHash('sha256').update(canonical(extension.data)).digest('hex');
    for (const [name, content, expected] of [
      ['oversize.json', ' '.repeat(20 * 1024 * 1024 + 1), '20 MiB'],
      ['deep.json', JSON.stringify(deep), 'profundidade'],
      ['extension.json', JSON.stringify(extension), 'Tipo de exceção'],
      ['corrompido.json', JSON.stringify(corrupted), 'SHA-256'],
      ['futuro.json', JSON.stringify({ ...exportedData, dbSchemaVersion: 99 }), 'Versão de backup incompatível'],
      ['invalid.json', '{not json', 'JSON válido'],
    ]) {
      await nav('restore'); await chooseBackup(Buffer.from(content), name); await page.locator('#main [role="alert"]').filter({ hasText: expected }).waitFor();
      assert.deepEqual(await snapshot(), before); assert.equal(await page.getByText('Arquivo validado', { exact: true }).count(), 0);
    }
  });

  await check('Exclusão deliberada e restauração confirmada recuperam IDs e relações', async () => {
    await nav('data'); await page.getByText('Apagar os dados deste espaço', { exact: true }).click(); await page.getByLabel('Entendo a remoção e quero apagar os dados deste espaço.').check();
    await button('Confirmar remoção dos dados').click(); await idle(); assert.equal((await snapshot()).tasks.length, 0);
    await page.goto(new URL('/', origin).href); await ready();
    assert.equal(await page.locator('#demo-scenario').inputValue(), 'local');
    await nav('restore'); await chooseBackup(exported.buffer, exported.name); await page.getByText('Arquivo validado', { exact: true }).waitFor();
    assert.ok(await button('Confirmar restauração').isDisabled()); const recovery = await downloaded(() => button('Baixar cópia antes de substituir').click());
    assert.equal(JSON.parse(recovery.buffer.toString()).data.tasks.length, 0);
    await page.getByLabel('Guardei minha cópia e confirmo a substituição de todos os dados deste espaço.').check(); await button('Confirmar restauração').click(); await page.locator('#data-title').waitFor(); await idle();
    assert.deepEqual(withoutRevision(await snapshot()), withoutRevision(exportedData.data));
  });

  await check('Os 11 destinos funcionam em 320, 390 e 1440 px sem rolagem horizontal', async () => {
    const evidence = process.env.CAMPULSO_EVIDENCE_DIR;
    if (evidence) await mkdir(evidence + '/telas', { recursive: true });
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: width < 800 ? 844 : 960 });
      for (const route of ['today', 'agenda', 'tasks', 'subjects', 'availability', 'preview', 'light', 'settings', 'data', 'restore', 'help']) {
        await nav(route); const widths = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
        assert.ok(widths.content <= widths.viewport, `${route} transborda em ${width}px: ${JSON.stringify(widths)}`);
        assert.equal(await page.locator('main h1:visible').count(), 1);
        if (evidence) await page.screenshot({ path: evidence + '/telas/' + width + '-' + route + '.png', animations: 'disabled' });
      }
    }
    await nav('preview'); await act('discard-proposal');
  });

  await check('Offline: recarregar, criar/editar, exportar e restaurar pela interface', async () => {
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller)); await context.setOffline(true); await page.reload(); await ready();
    await nav('tasks'); await act('new-task'); await page.fill('#item-title', 'Atividade criada sem conexão'); await save();
    await page.locator('.task-row').getByRole('button', { name: 'Atividade criada sem conexão', exact: true }).click(); await page.fill('#item-title', 'Atividade offline editada'); await save();
    assert.ok((await snapshot()).tasks.some(task => task.title === 'Atividade offline editada'));
    await nav('data'); const offlineBackup = await downloaded(() => button('Exportar JSON').click());
    await nav('restore'); await chooseBackup(offlineBackup.buffer, offlineBackup.name); await page.getByText('Arquivo validado', { exact: true }).waitFor();
    await downloaded(() => button('Baixar cópia antes de substituir').click()); await page.getByLabel('Guardei minha cópia e confirmo a substituição de todos os dados deste espaço.').check();
    await button('Confirmar restauração').click(); await page.locator('#data-title').waitFor(); await idle();
    const expected = JSON.parse(offlineBackup.buffer.toString()).data; assert.deepEqual(withoutRevision(await snapshot()), withoutRevision(expected));
    await page.reload(); await ready(); assert.ok((await snapshot()).tasks.some(task => task.title === 'Atividade offline editada'));
    const second = await newPage(); await second.goto(url + '?scenario=local'); await ready(second); assert.deepEqual(await snapshot(second), await snapshot()); await second.close();
    await context.setOffline(false);
  });

  assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []);
  assert.ok(requests.length > 0);
  for (const request of requests) {
    assert.equal(request.method, 'GET');
    assert.ok(assets.has(request.path), request.path);
    assert.ok(!request.query || /^\?scenario=(planned|empty|overloaded|local)$/.test(request.query), request.query);
    assert.equal(request.bodyBytes, 0);
  }
  const report = { status: 'PASS', browser: browser.version(), platform: process.platform, browserChannel: process.env.CAMPULSO_BROWSER || 'chromium', fixedNow: fixedNow.toISOString(), timezone: 'America/Sao_Paulo', checks: results, pageErrors: errors, thirdPartyRequests: externalRequests, requests };
  if (process.env.CAMPULSO_EVIDENCE_DIR) { await mkdir(process.env.CAMPULSO_EVIDENCE_DIR, { recursive: true }); await writeFile(process.env.CAMPULSO_EVIDENCE_DIR + '/functional-browser.json', JSON.stringify(report, null, 2) + '\n'); }
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error('FAILED AFTER', JSON.stringify(results));
  if (page && !page.isClosed()) console.error('PAGE', page.url(), '\n', (await page.locator('body').innerText()).slice(-9000));
  throw error;
} finally {
  await context?.close(); await browser?.close(); await server.close();
}
