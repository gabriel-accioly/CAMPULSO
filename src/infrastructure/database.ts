import Dexie, { type Table } from "dexie";
import { validateWorkspaceData } from "../domain/backup.js";
import {
  STORE_NAMES,
  validateSubject,
  validateTask,
  type AppMeta,
  type AvailabilityException,
  type AvailabilityRule,
  type BackupData,
  type Commitment,
  type Deadline,
  type PlanBlock,
  type PlanDecision,
  type PlanRun,
  type Preferences,
  type Subject,
  type Task,
} from "../domain/model.js";

/** Banco isolado desta prova. Não abre nem modifica `campulso-poc001`. */
export const DB_NAME = "campulso-poc002";
export const DB_VERSION = 2;

export class CampulsoDexieDB extends Dexie {
  preferences!: Table<Preferences, string>;
  subjects!: Table<Subject, string>;
  commitments!: Table<Commitment, string>;
  deadlines!: Table<Deadline, string>;
  tasks!: Table<Task, string>;
  availabilityRules!: Table<AvailabilityRule, string>;
  availabilityExceptions!: Table<AvailabilityException, string>;
  planRuns!: Table<PlanRun, string>;
  planBlocks!: Table<PlanBlock, string>;
  planDecisions!: Table<PlanDecision, string>;
  appMeta!: Table<AppMeta, string>;

  constructor(name = DB_NAME) {
    super(name);

    this.version(1).stores({
      preferences: "id",
      subjects: "id, name",
      commitments: "id, startAtUtc, endAtUtc",
      deadlines: "id, dueDate, dueAtUtc",
      tasks: "id, status, dueDate, subjectId, deadlineId",
      availabilityRules: "id, weekday",
      availabilityExceptions: "id, localDate",
      planRuns: "id, createdAtUtc, status",
      planBlocks: "id, taskId, planRunId, startAtUtc",
      planDecisions: "id, planRunId, taskId, code",
      appMeta: "&key",
    });

    this.version(2)
      .stores({
        preferences: "id",
        subjects: "id, name, revision",
        commitments: "id, subjectId, startAtUtc, endAtUtc, revision",
        deadlines: "id, subjectId, dueDate, dueAtUtc, revision",
        tasks: "id, status, dueDate, subjectId, deadlineId, revision",
        availabilityRules: "id, weekday, enabled",
        availabilityExceptions: "id, localDate, type",
        planRuns: "id, createdAtUtc, status, algorithmVersion",
        planBlocks: "id, taskId, planRunId, startAtUtc, source",
        planDecisions: "id, planRunId, taskId, code",
        appMeta: "&key",
      })
      .upgrade(async (transaction) => {
        await transaction.table("tasks").toCollection().modify((task: Partial<Task>) => {
          if (!Number.isInteger(task.revision)) task.revision = 1;
        });
        await transaction.table("subjects").toCollection().modify((subject: Partial<Subject>) => {
          if (!Number.isInteger(subject.revision)) subject.revision = 1;
        });
      });
  }

  /**
   * Lê todas as coleções dentro de uma única transação readonly.
   * Isso evita um snapshot composto por instantes diferentes entre tabelas.
   */
  async snapshot(): Promise<BackupData> {
    return this.transaction(
      "r",
      [...STORE_NAMES],
      async () => ({
        preferences: await this.preferences.toArray(),
        subjects: await this.subjects.toArray(),
        commitments: await this.commitments.toArray(),
        deadlines: await this.deadlines.toArray(),
        tasks: await this.tasks.toArray(),
        availabilityRules: await this.availabilityRules.toArray(),
        availabilityExceptions: await this.availabilityExceptions.toArray(),
        planRuns: await this.planRuns.toArray(),
        planBlocks: await this.planBlocks.toArray(),
        planDecisions: await this.planDecisions.toArray(),
        appMeta: await this.appMeta.toArray(),
      }),
    );
  }

  /**
   * Substituição integral: valida antes de abrir a transação e usa bulkAdd
   * para que IDs repetidos nunca virem sobrescritas silenciosas.
   * Qualquer erro dentro da transação deve revertê-la integralmente.
   */
  async replaceSnapshot(data: BackupData): Promise<void> {
    validateWorkspaceData(data);

    await this.transaction(
      "rw",
      [...STORE_NAMES],
      async () => {
        for (const store of STORE_NAMES) await this.table(store).clear();
        await this.preferences.bulkAdd(data.preferences);
        await this.subjects.bulkAdd(data.subjects);
        await this.commitments.bulkAdd(data.commitments);
        await this.deadlines.bulkAdd(data.deadlines);
        await this.tasks.bulkAdd(data.tasks);
        await this.availabilityRules.bulkAdd(data.availabilityRules);
        await this.availabilityExceptions.bulkAdd(data.availabilityExceptions);
        await this.planRuns.bulkAdd(data.planRuns);
        await this.planBlocks.bulkAdd(data.planBlocks);
        await this.planDecisions.bulkAdd(data.planDecisions);
        await this.appMeta.bulkAdd(data.appMeta);
      },
    );
  }

  async saveSubject(subject: Subject): Promise<void> {
    validateSubject(subject);
    await this.subjects.put(subject);
  }

  async saveTask(task: Task): Promise<void> {
    validateTask(task);
    await this.transaction("rw", this.tasks, this.subjects, this.deadlines, async () => {
      if (task.subjectId && !(await this.subjects.get(task.subjectId))) {
        throw new Error("A disciplina selecionada não existe mais.");
      }
      if (task.deadlineId && !(await this.deadlines.get(task.deadlineId))) {
        throw new Error("O prazo selecionado não existe mais.");
      }
      await this.tasks.put(task);
    });
  }

  async counts(): Promise<Record<(typeof STORE_NAMES)[number], number>> {
    return this.transaction(
      "r",
      [...STORE_NAMES],
      async () => ({
        preferences: await this.preferences.count(),
        subjects: await this.subjects.count(),
        commitments: await this.commitments.count(),
        deadlines: await this.deadlines.count(),
        tasks: await this.tasks.count(),
        availabilityRules: await this.availabilityRules.count(),
        availabilityExceptions: await this.availabilityExceptions.count(),
        planRuns: await this.planRuns.count(),
        planBlocks: await this.planBlocks.count(),
        planDecisions: await this.planDecisions.count(),
        appMeta: await this.appMeta.count(),
      }),
    );
  }
}

export function openDatabase(name = DB_NAME): Promise<CampulsoDexieDB> {
  const db = new CampulsoDexieDB(name);
  return db.open().then(() => db).catch((error: unknown) => {
    db.close();
    throw error;
  });
}
