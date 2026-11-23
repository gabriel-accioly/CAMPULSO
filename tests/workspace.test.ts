import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import {
  createBackup,
  emptyBackupData,
  validateBackup,
  validateBackupData,
} from "../src/domain/backup.js";
import {
  openDatabase,
  type CampulsoDexieDB,
} from "../src/infrastructure/database.js";
import type { AppMeta, BackupData, Task } from "../src/domain/model.js";
import {
  executeCommand,
  exportWorkspace,
  loadWorkspace,
  MAX_BACKUP_BYTES,
  parseBackupText,
  reduceCommand,
  restoreWorkspace,
  revisionOf,
  setWorkspaceRevision,
} from "../src/application/workspace.js";

const now = "2026-11-22T09:00:00.000Z";
const context = { nowUtc: now };
const opened: CampulsoDexieDB[] = [];
async function database(
  name = `campulso-workspace-test-${crypto.randomUUID()}`,
) {
  const db = await openDatabase(name);
  opened.push(db);
  return db;
}
afterEach(async () => {
  const names = new Set(opened.map((db) => db.name));
  for (const db of opened.splice(0)) db.close();
  for (const name of names) await Dexie.delete(name);
});

function fixture(): BackupData {
  const data = emptyBackupData();
  data.preferences.push({
    id: "local",
    locale: "pt-BR",
    timeZone: "UTC",
    mode: "normal",
    updatedAtUtc: now,
  });
  data.subjects.push({
    id: "s1",
    name: "Sociologia",
    createdAtUtc: now,
    revision: 1,
  });
  data.deadlines.push({
    id: "d1",
    subjectId: "s1",
    title: "Entrega",
    dueDate: "2026-11-25",
    revision: 1,
  });
  data.tasks.push({
    id: "t1",
    title: "Preparar resenha",
    subjectId: "s1",
    deadlineId: "d1",
    estimateMinutes: 60,
    remainingMinutes: 30,
    importance: "alta",
    status: "em_andamento",
    createdAtUtc: now,
    updatedAtUtc: now,
    revision: 1,
  });
  data.commitments.push({
    id: "c1",
    subjectId: "s1",
    title: "Seminário",
    startAtUtc: "2026-11-23T09:00:00.000Z",
    endAtUtc: "2026-11-23T10:00:00.000Z",
    timeZone: "UTC",
    isFixed: true,
    revision: 1,
  });
  data.availabilityRules.push({
    id: "a1",
    weekday: 1,
    startLocalTime: "14:00",
    endLocalTime: "17:00",
    timeZone: "UTC",
    enabled: true,
  });
  data.planRuns.push({
    id: "p1",
    createdAtUtc: now,
    algorithmVersion: "fixture",
    inputRevision: 1,
    mode: "normal",
    status: "aplicado",
    summary: "Sintético",
    reasonCodes: [],
  });
  data.planBlocks.push({
    id: "b1",
    taskId: "t1",
    planRunId: "p1",
    startAtUtc: "2026-11-23T14:00:00.000Z",
    endAtUtc: "2026-11-23T14:30:00.000Z",
    source: "automatic",
    revision: 1,
  });
  data.planDecisions.push({
    id: "decision1",
    taskId: "t1",
    planRunId: "p1",
    code: "FITS_FREE_WINDOW",
    parameters: {},
    messageKey: "FITS_FREE_WINDOW",
  });
  setWorkspaceRevision(data, 4);
  return data;
}

function taskCommand(task: Task) {
  return {
    type: "save-task" as const,
    id: task.id,
    title: task.title,
    subjectId: task.subjectId,
    estimateMinutes: task.estimateMinutes,
    remainingMinutes: task.remainingMinutes,
    importance: task.importance,
    deadlineId: task.deadlineId,
  };
}

describe("Aplicação canônica do espaço local", () => {
  it("normaliza nomes e arquiva/restaura mantendo os IDs e vínculos existentes", () => {
    const original = fixture();
    const renamed = reduceCommand(
      original,
      { type: "save-subject", id: "s1", name: "  Ciências Sociais  " },
      context,
    );
    expect(renamed.subjects[0]).toMatchObject({
      id: "s1",
      name: "Ciências Sociais",
      revision: 2,
    });
    expect(renamed.tasks).toEqual(original.tasks);
    expect(renamed.deadlines).toEqual(original.deadlines);
    expect(renamed.commitments).toEqual(original.commitments);
    expect(original.subjects[0].name).toBe("Sociologia");
    expect(() =>
      reduceCommand(
        renamed,
        { type: "save-subject", name: "CIÊNCIAS SOCIAIS".normalize("NFD") },
        context,
      ),
    ).toThrow(/já existe/i);
    const archived = reduceCommand(
      renamed,
      { type: "archive-subject", id: "s1", archived: true },
      context,
    );
    expect(archived.tasks[0].subjectId).toBe("s1");
    expect(() =>
      reduceCommand(
        archived,
        { ...taskCommand(archived.tasks[0]), id: undefined },
        context,
      ),
    ).toThrow(/arquivada/i);
    expect(
      reduceCommand(
        archived,
        { ...taskCommand(archived.tasks[0]), title: "Resenha revisada" },
        context,
      ).tasks[0].title,
    ).toBe("Resenha revisada");
    const restored = reduceCommand(
      archived,
      { type: "archive-subject", id: "s1", archived: false },
      context,
    );
    expect(restored.subjects[0].archivedAtUtc).toBeUndefined();
    expect(revisionOf(restored)).toBe(7);
  });

  it("impede restaurar disciplina cujo nome já está em uso por outra ativa", () => {
    let data = reduceCommand(
      fixture(),
      { type: "archive-subject", id: "s1", archived: true },
      context,
    );
    data = reduceCommand(
      data,
      { type: "save-subject", name: "Sociologia" },
      context,
    );
    expect(() =>
      reduceCommand(
        data,
        { type: "archive-subject", id: "s1", archived: false },
        context,
      ),
    ).toThrow(/já existe/i);
  });

  it("preserva prazo date-only e permite limpeza explícita de prazo legado", () => {
    const data = fixture();
    delete data.tasks[0].deadlineId;
    data.tasks[0].dueDate = "2026-11-25";
    const renamed = reduceCommand(
      data,
      { ...taskCommand(data.tasks[0]), title: "Revisar texto" },
      context,
    );
    expect(renamed.tasks[0].dueDate).toBe("2026-11-25");
    const cleared = reduceCommand(
      renamed,
      { ...taskCommand(renamed.tasks[0]), clearLegacyDueDate: true },
      context,
    );
    expect(cleared.tasks[0].dueDate).toBeUndefined();
    expect(cleared.deadlines[0].dueDate).toBe("2026-11-25");
    expect(cleared.deadlines[0].dueAtUtc).toBeUndefined();
  });

  it("prazo inline reutiliza vínculo exclusivo, mas cria outro ao editar um prazo compartilhado", () => {
    const data = fixture();
    const revised = reduceCommand(
      data,
      {
        ...taskCommand(data.tasks[0]),
        inlineDeadline: { dueDate: "2026-11-27" },
      },
      context,
    );
    expect(revised.tasks[0].deadlineId).toBe("d1");
    expect(revised.deadlines).toHaveLength(1);
    expect(revised.deadlines[0]).toMatchObject({
      id: "d1",
      title: data.tasks[0].title,
      dueDate: "2026-11-27",
      revision: 2,
    });
    const shared = structuredClone(data);
    shared.tasks.push({
      ...shared.tasks[0],
      id: "t2",
      title: "Outro trabalho do mesmo grupo",
    });
    const split = reduceCommand(
      shared,
      {
        ...taskCommand(shared.tasks[0]),
        inlineDeadline: { dueDate: "2026-11-28" },
      },
      context,
    );
    expect(split.tasks[0].deadlineId).not.toBe("d1");
    expect(split.tasks[1].deadlineId).toBe("d1");
    expect(split.deadlines.find((deadline) => deadline.id === "d1")).toEqual(
      data.deadlines[0],
    );
    expect(split.deadlines).toHaveLength(2);
  });

  it("prazo e tarefa inline são atômicos quando o prazo é inválido ou a gravação final falha", async () => {
    const db = await database();
    await db.replaceSnapshot(fixture());
    const before = await db.snapshot();
    const command = {
      ...taskCommand(before.tasks[0]),
      inlineDeadline: { dueDate: "2026-02-30" },
    };
    await expect(executeCommand(db, 4, command)).rejects.toThrow(
      /data de prazo/i,
    );
    expect(await db.snapshot()).toEqual(before);
    const event = db.appMeta.hook("creating");
    const fail = () => {
      throw new Error("falha inline");
    };
    event.subscribe(fail);
    try {
      await expect(
        executeCommand(db, 4, {
          ...command,
          inlineDeadline: { dueDate: "2026-12-15" },
        }),
      ).rejects.toThrow(/falha inline/);
    } finally {
      event.unsubscribe(fail);
    }
    expect(await db.snapshot()).toEqual(before);
  });

  it("conclui e desfaz com esforço preservado, sem eliminar bloco manual histórico", () => {
    const data = fixture();
    data.planBlocks[0].source = "manual";
    const done = reduceCommand(
      data,
      { type: "set-task-status", id: "t1", status: "concluida" },
      context,
    );
    expect(done.tasks[0]).toMatchObject({
      remainingMinutes: 0,
      status: "concluida",
      completedAtUtc: now,
    });
    expect(done.planBlocks).toEqual(data.planBlocks);
    const undone = reduceCommand(
      done,
      {
        type: "set-task-status",
        id: "t1",
        status: "em_andamento",
        remainingMinutes: 30,
      },
      context,
    );
    expect(undone.tasks[0]).toMatchObject({
      remainingMinutes: 30,
      status: "em_andamento",
    });
    expect(undone.tasks[0].completedAtUtc).toBeUndefined();
  });

  it("bloqueia colisão entre fixos/manuais e remove apenas automático afetado por novo fixo", () => {
    const data = fixture();
    const command = {
      type: "save-commitment" as const,
      title: "Orientação",
      startAtUtc: "2026-11-23T09:30:00.000Z",
      endAtUtc: "2026-11-23T10:30:00.000Z",
      timeZone: "UTC",
    };
    expect(() => reduceCommand(data, command, context)).toThrow(
      /outro compromisso/i,
    );
    const valid = {
      ...command,
      startAtUtc: "2026-11-23T14:00:00.000Z",
      endAtUtc: "2026-11-23T15:00:00.000Z",
    };
    const manual = structuredClone(data);
    manual.planBlocks[0].source = "manual";
    expect(() => reduceCommand(manual, valid, context)).toThrow(
      /manual protegido/i,
    );
    const changed = reduceCommand(data, valid, context);
    expect(changed.planBlocks).toHaveLength(0);
    expect(changed.tasks).toEqual(data.tasks);
    expect(changed.deadlines).toEqual(data.deadlines);
  });

  it("redução da janela elimina automático incompatível, preservando manual e data não afetada", () => {
    const data = fixture();
    data.planBlocks.push({
      ...data.planBlocks[0],
      id: "manual",
      source: "manual",
      startAtUtc: "2026-11-23T15:00:00.000Z",
      endAtUtc: "2026-11-23T15:30:00.000Z",
    });
    data.planBlocks.push({
      ...data.planBlocks[0],
      id: "tomorrow",
      startAtUtc: "2026-11-24T14:00:00.000Z",
      endAtUtc: "2026-11-24T14:30:00.000Z",
    });
    const next = reduceCommand(
      data,
      {
        type: "save-exception",
        localDate: "2026-11-23",
        exceptionType: "r02-janela",
        startLocalTime: "16:00",
        endLocalTime: "17:00",
      },
      context,
    );
    expect(next.planBlocks.map((block) => block.id)).toEqual([
      "manual",
      "tomorrow",
    ]);
    expect(next.tasks).toEqual(data.tasks);
    expect(next.deadlines).toEqual(data.deadlines);
  });

  it("janelas adjacentes permanecem uma união válida ao alterar disponibilidade", () => {
    const data = fixture();
    data.availabilityRules[0].endLocalTime = "14:15";
    data.availabilityRules.push({
      ...data.availabilityRules[0],
      id: "a2",
      startLocalTime: "14:15",
      endLocalTime: "15:00",
    });
    const next = reduceCommand(
      data,
      {
        type: "save-rule",
        id: "a2",
        weekday: 1,
        startLocalTime: "14:15",
        endLocalTime: "14:45",
        timeZone: "UTC",
        enabled: true,
      },
      context,
    );
    expect(next.planBlocks).toEqual(data.planBlocks);
  });

  it("exclusão de tarefa não deixa referências órfãs, mas prazo vinculado não é excluído silenciosamente", () => {
    const data = fixture();
    expect(() =>
      reduceCommand(data, { type: "delete-deadline", id: "d1" }, context),
    ).toThrow(/vinculado/i);
    const next = reduceCommand(
      data,
      { type: "delete-task", id: "t1" },
      context,
    );
    expect(next.planBlocks).toEqual([]);
    expect(next.planDecisions[0].taskId).toBeUndefined();
    expect(next.deadlines).toEqual(data.deadlines);
    expect(() => validateBackupData(next)).not.toThrow();
  });

  it("impede atualização perdida por outra conexão inclusive após renomear e arquivar", async () => {
    const first = await database();
    const second = await database(first.name);
    await first.replaceSnapshot(fixture());
    const a = await loadWorkspace(first),
      b = await loadWorkspace(second);
    const renamed = await executeCommand(first, revisionOf(a), {
      type: "save-subject",
      id: "s1",
      name: "Sociologia Geral",
    });
    await expect(
      executeCommand(second, revisionOf(b), {
        type: "archive-subject",
        id: "s1",
        archived: true,
      }),
    ).rejects.toThrow(/outra aba/i);
    expect(await loadWorkspace(second)).toEqual(renamed);
    const archived = await executeCommand(second, revisionOf(renamed), {
      type: "archive-subject",
      id: "s1",
      archived: true,
    });
    await expect(
      executeCommand(first, revisionOf(renamed), {
        ...taskCommand(a.tasks[0]),
        title: "Alteração desatualizada",
      }),
    ).rejects.toThrow(/outra aba/i);
    expect(await first.snapshot()).toEqual(archived);
  });

  it("duas alterações simultâneas da mesma revisão resultam em um único aceite", async () => {
    const first = await database(),
      second = await database(first.name);
    const results = await Promise.allSettled([
      executeCommand(first, 1, { type: "save-subject", name: "História" }),
      executeCommand(second, 1, { type: "save-subject", name: "Física" }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect((await first.snapshot()).subjects).toHaveLength(1);
  });

  it("rollback integral quando a última das onze coleções falha na mutação", async () => {
    const db = await database();
    await db.replaceSnapshot(fixture());
    const before = await db.snapshot();
    const event = db.appMeta.hook("creating");
    const fail = (_key: unknown, row: AppMeta) => {
      if (row.key === "r02.revision") throw new Error("falha última coleção");
    };
    event.subscribe(fail);
    try {
      await expect(
        executeCommand(db, 4, {
          type: "save-subject",
          id: "s1",
          name: "Nova disciplina",
        }),
      ).rejects.toThrow(/última coleção/);
    } finally {
      event.unsubscribe(fail);
    }
    expect(await db.snapshot()).toEqual(before);
  });

  it("exporta JSON no contrato homologado e restaura todas as coleções mantendo IDs", async () => {
    const source = await database(),
      destination = await database();
    await source.replaceSnapshot(fixture());
    const exported = await exportWorkspace(source);
    expect(exported.dbSchemaVersion).toBe(2);
    expect(exported.integrity.canonicalization).toBe("CAMPULSO-CJSON-1");
    const parsed = await parseBackupText(JSON.stringify(exported));
    const restored = await restoreWorkspace(destination, 1, parsed);
    const expected = fixture();
    setWorkspaceRevision(expected, 5);
    expect(restored).toEqual(expected);
    expect(
      (await validateBackup(await exportWorkspace(destination))).data.tasks,
    ).toEqual(exported.data.tasks);
  });

  it("restauração rejeita conteúdo adulterado, versão futura e revisão obsoleta sem escrita", async () => {
    const db = await database();
    await db.replaceSnapshot(fixture());
    const before = await db.snapshot();
    const backup = await exportWorkspace(db);
    const altered = structuredClone(backup);
    altered.data.tasks[0].title = "Adulterada";
    await expect(restoreWorkspace(db, 4, altered)).rejects.toThrow(/SHA-256/);
    const future = { ...backup, dbSchemaVersion: 3 };
    await expect(parseBackupText(JSON.stringify(future))).rejects.toThrow(
      /versão/i,
    );
    await expect(restoreWorkspace(db, 3, backup)).rejects.toThrow(/outra aba/i);
    expect(await db.snapshot()).toEqual(before);
  });

  it("rollback também protege a restauração se a última coleção falhar", async () => {
    const db = await database();
    await db.replaceSnapshot(fixture());
    const before = await db.snapshot();
    const replacement = emptyBackupData();
    replacement.subjects.push({
      id: "new-subject",
      name: "Direito",
      createdAtUtc: now,
      revision: 1,
    });
    const backup = await createBackup(replacement, {
      appVersion: "fixture",
      exportedAtUtc: now,
    });
    const event = db.appMeta.hook("creating");
    const fail = () => {
      throw new Error("falha final restore");
    };
    event.subscribe(fail);
    try {
      await expect(restoreWorkspace(db, 4, backup)).rejects.toThrow(
        /falha final/,
      );
    } finally {
      event.unsubscribe(fail);
    }
    expect(await db.snapshot()).toEqual(before);
  });

  it("apagar e restaurar impedem reutilização da revisão antiga (ABA)", async () => {
    const db = await database();
    await db.replaceSnapshot(fixture());
    const backup = await exportWorkspace(db);
    const cleared = await executeCommand(db, 4, { type: "clear-all" });
    expect(cleared.tasks).toEqual([]);
    expect(revisionOf(cleared)).toBe(5);
    const restored = await restoreWorkspace(db, 5, backup);
    expect(revisionOf(restored)).toBe(6);
    await expect(
      executeCommand(db, 4, { type: "save-subject", name: "Escrita antiga" }),
    ).rejects.toThrow(/outra aba/i);
  });

  it("limita tamanho UTF-8 antes de interpretar o JSON e recusa JSON inválido", async () => {
    await expect(
      parseBackupText("é".repeat(MAX_BACKUP_BYTES / 2 + 1)),
    ).rejects.toThrow(/20 MiB/);
    await expect(parseBackupText("{invalid")).rejects.toThrow(/JSON válido/);
  });

  it("metadado de revisão inválido não reinicia silenciosamente a concorrência", () => {
    const data = fixture();
    data.appMeta[0].value = "not-a-number";
    expect(() => revisionOf(data)).toThrow(/revisão local/i);
    expect(() => reduceCommand(data, { type: "clear-all" }, context)).toThrow(
      /revisão local/i,
    );
  });

  it("limite diário distingue zero de campo vazio e preferências não alteram modo", () => {
    const source = fixture();
    source.preferences[0].mode = "leve";
    const limited = reduceCommand(
      source,
      { type: "save-preferences", dailyFlexibleLimitMinutes: 0 },
      context,
    );
    expect(limited.preferences[0].dailyFlexibleLimitMinutes).toBe(0);
    expect(limited.preferences[0].mode).toBe("leve");
    const cleared = reduceCommand(
      limited,
      { type: "save-preferences", dailyFlexibleLimitMinutes: null },
      context,
    );
    expect(cleared.preferences[0].dailyFlexibleLimitMinutes).toBeUndefined();
    expect(cleared.preferences[0].mode).toBe("leve");
  });
});
