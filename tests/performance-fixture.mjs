import { buildPlan } from '../src/domain/planner.ts';
import { openDatabase } from '../src/infrastructure/database.ts';
import { canonicalize } from '../src/domain/backup.ts';

const nowUtc = '2026-11-23T10:00:00.000Z';
const timezone = 'America/Sao_Paulo';
const options = { nowUtc, timeZone: timezone, startDate: '2026-11-23', horizonDays: 7, mode: 'normal' };
const rows = (size, fn) => Array.from({ length: size }, (_, i) => fn(i));
const id = (prefix, i) => prefix + String(i).padStart(4, '0');
const dateAt = (day, minute) => new Date(Date.parse('2026-11-23T03:00:00Z') + (day * 1440 + minute) * 60000).toISOString();

function fixture() {
  return {
    preferences: [{ id: 'local', locale: 'pt-BR', timeZone: timezone, mode: 'normal', updatedAtUtc: nowUtc, dailyFlexibleLimitMinutes: 180 }],
    subjects: rows(50, i => ({ id: id('s', i), name: 'Disciplina ' + i, revision: 1, createdAtUtc: nowUtc })),
    tasks: rows(2000, i => ({
      id: id('t', i), title: 'Tarefa ' + i, subjectId: id('s', i % 50), estimateMinutes: 30 + 15 * (i % 5),
      remainingMinutes: 30 + 15 * (i % 5), importance: ['alta', 'media', 'baixa'][i % 3], status: 'aberta',
      dueDate: dateAt(i % 21, 0).slice(0, 10), pinned: i % 147 === 0, createdAtUtc: nowUtc, updatedAtUtc: nowUtc, revision: 1,
    })),
    commitments: rows(500, i => {
      const minute = 480 + 90 * Math.floor(i / 100);
      return { id: id('c', i), subjectId: id('s', i % 50), title: 'Evento ' + i, kind: 'aula',
        startAtUtc: dateAt(i % 100, minute), endAtUtc: dateAt(i % 100, minute + 45), timeZone: timezone, isFixed: true, revision: 1 };
    }),
    availabilityRules: rows(7, i => ({ id: id('r', i), weekday: i, startLocalTime: '08:00', endLocalTime: '19:00', timeZone: timezone, enabled: true })),
    deadlines: [], availabilityExceptions: [], planBlocks: [], planRuns: [], planDecisions: [], appMeta: [],
  };
}

async function digest(data) {
  const bytes = new TextEncoder().encode(canonicalize(data));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
}

async function timed(fn) {
  const start = performance.now();
  const value = await fn();
  return { ms: performance.now() - start, value };
}

export async function benchmark() {
  const data = fixture(), expected = await digest(data);
  const dbName = 'campulso-benchmark-' + crypto.randomUUID();
  const writeDb = await openDatabase(dbName);
  let write;
  try { write = await timed(() => writeDb.replaceSnapshot(data)); } finally { writeDb.close(); }
  const reopened = await timed(() => openDatabase(dbName));
  const db = reopened.value;
  let snapshot, counts;
  try {
    snapshot = await timed(() => db.snapshot());
    counts = await db.counts();
  } finally { db.close(); }
  const actual = await digest(snapshot.value);
  if (actual !== expected) throw new Error('Digest diferente após reabertura da base sintética.');
  const samples = [], warmup = [];
  let signature;
  for (let i = 0; i < 35; i++) {
    const start = performance.now();
    const proposal = buildPlan(snapshot.value, options);
    const duration = performance.now() - start;
    (i < 5 ? warmup : samples).push(duration);
    const current = await digest(proposal);
    if (!proposal.blocks.length || !proposal.unscheduled.length || (signature && current !== signature)) throw new Error('Proposta vazia ou instável.');
    signature = current;
  }
  return { counts, inputDigest: expected, reopenedDigest: actual, writeMs: write.ms, reopenMs: reopened.ms,
    readMs: snapshot.ms, warmup, samples, signature, storage: await navigator.storage.estimate() };
}

export async function seedLargeWorkspace() {
  // Chamado exclusivamente no contexto novo de runPlanner; recusa um espaço preexistente.
  const name = 'campulso-poc002-r02';
  if ((await indexedDB.databases()).some(db => db.name === name)) throw Error('Contexto de benchmark já ocupado.');
  const db = await openDatabase(name);
  try { await db.replaceSnapshot(fixture()); } finally { db.close(); }
}
