import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, firefox } from 'playwright';
import { preview } from 'vite';

// O arquivo baixado em cada motor é enviado sem alterações para o motor seguinte.
const channels = ['msedge', 'firefox', 'chrome', 'msedge'];
const evidence = process.env.CAMPULSO_EVIDENCE_DIR || 'docs/etapa6/evidencias/desempenho';
const server = await preview({ preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const origin = server.resolvedUrls.local[0];
const chain = [];
const digest = buffer => createHash('sha256').update(buffer).digest('hex');
const shaWorker = digest(await readFile('dist/r02/sw.js'));
let incoming, expected;

function withoutRevision(data) {
  return { ...data, appMeta: data.appMeta.filter(row => row.key !== 'r02.revision') };
}

async function download(page, label) {
  const promise = page.waitForEvent('download');
  await page.getByRole('button', { name: label, exact: true }).click();
  const file = await promise;
  assert.equal(await file.failure(), null);
  const parts = [];
  for await (const bytes of await file.createReadStream()) parts.push(bytes);
  return Buffer.concat(parts);
}

async function seedViaUI(page) {
  await page.locator('nav [data-page="subjects"]:visible').first().click();
  await page.getByRole('button', { name: 'Nova disciplina', exact: true }).click();
  await page.locator('#subject-name').fill('Laboratório de migração');
  const save = async () => {
    await page.locator('#editor-form').getByRole('button', { name: 'Salvar', exact: true }).click();
    await page.locator('#editor').waitFor({ state: 'detached' });
  };
  await save();
  await page.locator('nav [data-page="tasks"]:visible').first().click();
  await page.locator('[data-action="new-task"]:visible').first().click();
  await page.locator('#item-title').fill('Transferência entre navegadores');
  await page.locator('#item-course').selectOption({ label: 'Laboratório de migração' });
  await page.locator('#deadline-mode').selectOption('date');
  await page.locator('#item-date').fill('2026-12-01');
  await save();
}

try {
  for (const channel of channels) {
    const browser = channel === 'firefox' ? await firefox.launch() : await chromium.launch({ channel });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(new URL('/r02/index.html?scenario=local', origin).href);
      await page.locator('#today-title').waitFor();
      if (!incoming) await seedViaUI(page);
      await page.locator('nav [data-page="data"]:visible').first().click();
      if (incoming) {
        await page.locator('[data-page="restore"]:visible').first().click();
        await page.locator('#backup-file').setInputFiles({ name: 'transferencia.json', mimeType: 'application/json', buffer: incoming });
        await page.getByText('Arquivo validado', { exact: true }).waitFor();
        const safety = JSON.parse((await download(page, 'Baixar cópia antes de substituir')).toString());
        assert.equal(safety.data.tasks.length, 0);
        await page.getByLabel('Guardei minha cópia e confirmo a substituição de todos os dados deste espaço.').check();
        await page.getByRole('button', { name: 'Confirmar restauração', exact: true }).click();
        await page.locator('#data-title').waitFor();
      }
      const output = await download(page, 'Exportar JSON');
      const exported = JSON.parse(output.toString());
      assert.equal(Object.keys(exported.data).length, 11);
      assert.equal(exported.data.tasks.length, 1);
      assert.equal(exported.data.tasks[0].subjectId, exported.data.subjects[0].id);
      assert.equal(exported.data.tasks[0].deadlineId, exported.data.deadlines[0].id);
      const preserved = withoutRevision(exported.data);
      if (expected) assert.deepEqual(preserved, expected); else expected = preserved;
      assert.deepEqual(errors, []);
      chain.push({ channel, version: browser.version(), inputFileSHA256: incoming ? digest(incoming) : null, outputFileSHA256: digest(output),
        dataDigestHex: exported.integrity.dataDigestHex, storedCollections: Object.keys(exported.data).length, comparedIgnoringOnly: 'appMeta.r02.revision' });
      incoming = output;
    } finally { await browser.close(); }
  }
  await mkdir(evidence, { recursive: true });
  await writeFile(path.join(evidence, 'transferencia-backup.json'), JSON.stringify({ status: 'PASS', measuredAtUtc: new Date().toISOString(), shaWorker, chain }, null, 2) + '\n');
  console.log('PASS transferência de backup: ' + channels.join(' → '));
} finally { await server.close(); }
