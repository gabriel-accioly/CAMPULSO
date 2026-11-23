import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { CampulsoDexieDB, openDatabase } from "../src/infrastructure/database.js";
import { emptyBackupData } from "../src/domain/backup.js";
import type { Subject, Task } from "../src/domain/model.js";

const opened: CampulsoDexieDB[] = [];

function subject(id = "subject-1"): Subject {
  return { id, name: "Disciplina de teste", createdAtUtc: "2026-11-22T12:00:00.000Z", revision: 1 };
}

function task(id = "task-1", subjectId = "subject-1"): Task {
  return {
    id,
    subjectId,
    title: "Tarefa sintética de integração",
    estimateMinutes: 30,
    remainingMinutes: 30,
    importance: "media",
    status: "aberta",
    dueDate: "2026-11-25",
    createdAtUtc: "2026-11-22T12:00:00.000Z",
    updatedAtUtc: "2026-11-22T12:00:00.000Z",
    revision: 1,
  };
}

async function makeDatabase(): Promise<CampulsoDexieDB> {
  const name = `campulso-test-${crypto.randomUUID()}`;
  const db = await openDatabase(name);
  opened.push(db);
  return db;
}

afterEach(async () => {
  for (const db of opened.splice(0)) {
    const name = db.name;
    db.close();
    await Dexie.delete(name);
  }
});

describe("CampulsoDexieDB", () => {
  it("abre o esquema v2 com as onze coleções", async () => {
    const db = await makeDatabase();
    expect(db.verno).toBe(2);
    expect(db.tables.map((table) => table.name).sort()).toEqual([
      "appMeta", "availabilityExceptions", "availabilityRules", "commitments", "deadlines",
      "planBlocks", "planDecisions", "planRuns", "preferences", "subjects", "tasks",
    ]);
  });

  it("grava e lê um snapshot coerente", async () => {
    const db = await makeDatabase();
    await db.saveSubject(subject());
    await db.saveTask(task());
    const snapshot = await db.snapshot();
    expect(snapshot.subjects).toHaveLength(1);
    expect(snapshot.tasks[0]?.subjectId).toBe("subject-1");
  });

  it("substitui todas as coleções e preserva o vínculo tarefa-disciplina", async () => {
    const db = await makeDatabase();
    const data = emptyBackupData();
    data.subjects.push(subject());
    data.tasks.push(task());
    await db.replaceSnapshot(data);
    const restored = await db.snapshot();
    expect(restored.subjects).toEqual([subject()]);
    expect(restored.tasks).toEqual([task()]);
  });

  it("rejeita referência órfã antes de tocar no banco", async () => {
    const db = await makeDatabase();
    await db.saveSubject(subject());
    await db.saveTask(task());
    const invalid = emptyBackupData();
    invalid.tasks.push(task("orphan", "missing-subject"));
    await expect(db.replaceSnapshot(invalid)).rejects.toThrow(/disciplina inexistente/i);
    expect((await db.snapshot()).tasks).toEqual([task()]);
  });

  it("reverte a substituição quando uma gravação falha dentro da transação", async () => {
    const db = await makeDatabase();
    await db.saveSubject(subject());
    await db.saveTask(task());
    const before = await db.snapshot();
    const replacement = emptyBackupData();
    replacement.subjects.push(subject("subject-new"));
    replacement.tasks.push(task("task-new", "subject-new"));
    replacement.tasks.push(task("force-failure", "subject-new"));

    const creating = db.tasks.hook("creating");
    const failOnMarkedTask = (_primaryKey: unknown, row: Task) => {
      if (row.id === "force-failure") throw new Error("Falha induzida no teste de transação.");
    };
    creating.subscribe(failOnMarkedTask);
    try {
      await expect(db.replaceSnapshot(replacement)).rejects.toThrow(/falha induzida/i);
    } finally {
      creating.unsubscribe(failOnMarkedTask);
    }
    expect(await db.snapshot()).toEqual(before);
  });

  it("migra registros v1 adicionando revision em tarefas e disciplinas", async () => {
    const name = `campulso-migration-${crypto.randomUUID()}`;
    const legacy = new Dexie(name);
    legacy.version(1).stores({
      preferences: "id", subjects: "id, name", commitments: "id, startAtUtc, endAtUtc",
      deadlines: "id, dueDate, dueAtUtc", tasks: "id, status, dueDate, subjectId, deadlineId",
      availabilityRules: "id, weekday", availabilityExceptions: "id, localDate",
      planRuns: "id, createdAtUtc, status", planBlocks: "id, taskId, planRunId, startAtUtc",
      planDecisions: "id, planRunId, taskId, code", appMeta: "&key",
    });
    await legacy.open();
    await legacy.table("subjects").add({ id: "legacy-subject", name: "Legada", createdAtUtc: "2026-11-22T12:00:00.000Z" });
    await legacy.table("tasks").add({
      id: "legacy-task", subjectId: "legacy-subject", title: "Legada", estimateMinutes: 30,
      remainingMinutes: 30, importance: "media", status: "aberta", createdAtUtc: "2026-11-22T12:00:00.000Z",
      updatedAtUtc: "2026-11-22T12:00:00.000Z",
    });
    legacy.close();

    const migrated = await openDatabase(name);
    opened.push(migrated);
    expect((await migrated.subjects.get("legacy-subject"))?.revision).toBe(1);
    expect((await migrated.tasks.get("legacy-task"))?.revision).toBe(1);
  });
});
