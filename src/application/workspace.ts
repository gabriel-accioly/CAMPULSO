import {
  createBackup,
  emptyBackupData,
  validateBackup,
  validateWorkspaceData,
} from "../domain/backup.js";
import {
  STORE_NAMES,
  isValidInstant,
  type AvailabilityException,
  type BackupData,
  type CampulsoBackup,
  type Commitment,
  type Deadline,
  type Importance,
  type Preferences,
  type Task,
  type TaskStatus,
} from "../domain/model.js";
import type { CampulsoDexieDB } from "../infrastructure/database.js";
import { availabilityForDate, dateInZone } from "../domain/planner.js";

export const REVISION_KEY = "r02.revision";
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
export const APP_VERSION = "1.0.0";

export type Command =
  | { type: "save-subject"; id?: string; name: string }
  | { type: "archive-subject"; id: string; archived: boolean }
  | {
      type: "save-task";
      id?: string;
      title: string;
      subjectId?: string;
      estimateMinutes: number;
      remainingMinutes: number;
      importance: Importance;
      pinned?: boolean;
      deadlineId?: string;
      clearLegacyDueDate?: boolean;
      inlineDeadline?: {
        dueDate?: string;
        dueAtUtc?: string;
        timeZone?: string;
      };
    }
  | {
      type: "set-task-status";
      id: string;
      status: TaskStatus;
      remainingMinutes?: number;
    }
  | { type: "delete-task"; id: string }
  | {
      type: "save-commitment";
      id?: string;
      title: string;
      subjectId?: string;
      startAtUtc: string;
      endAtUtc: string;
      timeZone: string;
      kind?: Commitment["kind"];
    }
  | { type: "delete-commitment"; id: string }
  | {
      type: "save-deadline";
      id?: string;
      title: string;
      subjectId?: string;
      dueDate?: string;
      dueAtUtc?: string;
      timeZone?: string;
    }
  | { type: "delete-deadline"; id: string }
  | {
      type: "save-rule";
      id?: string;
      weekday: number;
      startLocalTime: string;
      endLocalTime: string;
      timeZone: string;
      enabled: boolean;
    }
  | { type: "delete-rule"; id: string }
  | {
      type: "save-exception";
      id?: string;
      localDate: string;
      exceptionType: "r02-janela" | "unavailable";
      startLocalTime?: string;
      endLocalTime?: string;
    }
  | { type: "delete-exception"; id: string }
  | {
      type: "save-preferences";
      locale?: string;
      timeZone?: string;
      planningHorizonDays?: number;
      dailyFlexibleLimitMinutes?: number | null;
      lightModeRatio?: number;
    }
  | { type: "clear-all" };

export interface CommandContext {
  nowUtc?: string;
  id?: () => string;
}

/** Shared by all writers, including the original R02 adapter. Invalid metadata must never reset the lock. */
export function revisionOf(data: BackupData): number {
  const stored = data.appMeta.find((row) => row.key === REVISION_KEY);
  if (!stored) return 1;
  if (
    !/^[1-9]\d*$/.test(stored.value) ||
    !Number.isSafeInteger(Number(stored.value))
  ) {
    throw new Error(
      "A revisão local é inválida. Restaure uma cópia válida antes de editar.",
    );
  }
  return Number(stored.value);
}

export function setWorkspaceRevision(data: BackupData, revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 1)
    throw new Error("Limite de revisão local atingido.");
  data.appMeta = data.appMeta.filter((row) => row.key !== REVISION_KEY);
  data.appMeta.push({ key: REVISION_KEY, value: String(revision) });
}

export function assertRevision(data: BackupData, expected: number): void {
  if (!Number.isSafeInteger(expected) || revisionOf(data) !== expected) {
    throw new Error(
      "Outra aba alterou os dados. Recarregue os dados e revise sua alteração antes de tentar novamente.",
    );
  }
}

const normalizeName = (name: string) =>
  name.trim().normalize("NFC").toLocaleLowerCase("pt-BR");
function cleanTitle(value: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new Error(`Informe um texto com 1 a ${max} caracteres.`);
  }
  return value.trim().normalize("NFC");
}

function existing<T extends { id: string }>(
  rows: T[],
  id: string,
  label: string,
): T {
  const row = rows.find((candidate) => candidate.id === id);
  if (!row) throw new Error(`${label} não existe mais. Recarregue os dados.`);
  return row;
}

function put<T extends { id: string }>(rows: T[], row: T): void {
  const index = rows.findIndex((item) => item.id === row.id);
  if (index < 0) rows.push(row);
  else rows[index] = row;
}

function subjectReference(
  data: BackupData,
  nextId: string | undefined,
  oldId?: string,
): void {
  if (!nextId) return;
  const subject = existing(data.subjects, nextId, "A disciplina");
  if (subject.archivedAtUtc && nextId !== oldId)
    throw new Error(
      "Restaure a disciplina arquivada antes de criar um novo vínculo.",
    );
}

function uniqueSubject(
  data: BackupData,
  name: string,
  exceptId?: string,
): void {
  if (
    data.subjects.some(
      (row) =>
        row.id !== exceptId &&
        !row.archivedAtUtc &&
        normalizeName(row.name) === normalizeName(name),
    )
  ) {
    throw new Error("Já existe uma disciplina ativa com esse nome.");
  }
}

const intersects = (
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
) =>
  Date.parse(aStart) < Date.parse(bEnd) &&
  Date.parse(bStart) < Date.parse(aEnd);

function pruneAutomatic(
  data: BackupData,
  now: string,
  affected: (block: BackupData["planBlocks"][number]) => boolean,
): void {
  data.planBlocks = data.planBlocks.filter(
    (block) =>
      block.source !== "automatic" ||
      Date.parse(block.endAtUtc) <= Date.parse(now) ||
      !affected(block),
  );
}

function localParts(
  instant: string,
  timeZone: string,
): { date: string; weekday: number } {
  const date = dateInZone(instant, timeZone);
  return { date, weekday: new Date(`${date}T12:00:00Z`).getUTCDay() };
}

/** Only invalid automatic blocks are removed. A change never moves a manual block. */
function pruneOutsideAvailability(
  data: BackupData,
  now: string,
  affected: (block: BackupData["planBlocks"][number]) => boolean = () => true,
): void {
  const zone =
    data.preferences[0]?.timeZone ??
    Intl.DateTimeFormat().resolvedOptions().timeZone;
  const byDate = new Map<string, { startAtUtc: string; endAtUtc: string }[]>();
  pruneAutomatic(data, now, (block) => {
    if (!affected(block)) return false;
    const date = dateInZone(block.startAtUtc, zone);
    let windows = byDate.get(date);
    if (!windows) {
      windows = availabilityForDate(data, date, zone);
      byDate.set(date, windows);
    }
    return !windows.some(
      (window) =>
        Date.parse(block.startAtUtc) >= Date.parse(window.startAtUtc) &&
        Date.parse(block.endAtUtc) <= Date.parse(window.endAtUtc),
    );
  });
}

/** Pure mutation used both by the local workspace and memory-only demonstration scenarios. */
export function reduceCommand(
  source: BackupData,
  command: Command,
  context: CommandContext = {},
): BackupData {
  validateWorkspaceData(source);
  const previousRevision = revisionOf(source);
  let data = structuredClone(source);
  const now = context.nowUtc ?? new Date().toISOString();
  const id = context.id ?? (() => crypto.randomUUID());
  if (!isValidInstant(now)) throw new Error("Data da alteração inválida.");

  switch (command.type) {
    case "save-subject": {
      const old = command.id
        ? existing(data.subjects, command.id, "A disciplina")
        : undefined;
      if (old?.archivedAtUtc)
        throw new Error("Restaure a disciplina antes de renomeá-la.");
      const name = cleanTitle(command.name, 120);
      uniqueSubject(data, name, old?.id);
      put(data.subjects, {
        ...old,
        id: old?.id ?? id(),
        name,
        createdAtUtc: old?.createdAtUtc ?? now,
        revision: (old?.revision ?? 0) + 1,
      });
      break;
    }
    case "archive-subject": {
      const row = existing(data.subjects, command.id, "A disciplina");
      if (!command.archived) uniqueSubject(data, row.name, row.id);
      if (Boolean(row.archivedAtUtc) !== command.archived) {
        if (command.archived) row.archivedAtUtc = now;
        else delete row.archivedAtUtc;
        row.revision += 1;
      }
      break;
    }
    case "save-task": {
      const old = command.id
        ? existing(data.tasks, command.id, "A tarefa")
        : undefined;
      subjectReference(data, command.subjectId, old?.subjectId);
      if (command.deadlineId)
        existing(data.deadlines, command.deadlineId, "O prazo");
      const row: Task = {
        ...old,
        id: old?.id ?? id(),
        title: cleanTitle(command.title, 160),
        estimateMinutes: command.estimateMinutes,
        remainingMinutes: command.remainingMinutes,
        importance: command.importance,
        pinned: command.pinned ?? false,
        status: old?.status ?? "aberta",
        createdAtUtc: old?.createdAtUtc ?? now,
        updatedAtUtc: now,
        revision: (old?.revision ?? 0) + 1,
      };
      if (command.subjectId) row.subjectId = command.subjectId;
      else delete row.subjectId;
      if (command.deadlineId) row.deadlineId = command.deadlineId;
      else delete row.deadlineId;
      let inlineDeadlineChanged = false;
      if (command.inlineDeadline) {
        const previousId = command.deadlineId ?? old?.deadlineId;
        const previous = previousId
          ? existing(data.deadlines, previousId, "O prazo")
          : undefined;
        const shared =
          previous &&
          data.tasks.some(
            (task) => task.id !== old?.id && task.deadlineId === previous.id,
          );
        const reusable = previous && !shared ? previous : undefined;
        const deadline: Deadline = {
          ...reusable,
          id: reusable?.id ?? id(),
          title: row.title,
          revision: (reusable?.revision ?? 0) + 1,
        };
        if (command.subjectId) deadline.subjectId = command.subjectId;
        else delete deadline.subjectId;
        if (command.inlineDeadline.dueDate)
          deadline.dueDate = command.inlineDeadline.dueDate;
        else delete deadline.dueDate;
        if (command.inlineDeadline.dueAtUtc)
          deadline.dueAtUtc = command.inlineDeadline.dueAtUtc;
        else delete deadline.dueAtUtc;
        if (command.inlineDeadline.timeZone)
          deadline.timeZone = command.inlineDeadline.timeZone;
        else delete deadline.timeZone;
        inlineDeadlineChanged =
          previous?.dueDate !== deadline.dueDate ||
          previous?.dueAtUtc !== deadline.dueAtUtc;
        put(data.deadlines, deadline);
        row.deadlineId = deadline.id;
      }
      // A form selecting a canonical deadline supersedes a legacy task dueDate.
      if (
        command.deadlineId ||
        command.inlineDeadline ||
        command.clearLegacyDueDate
      )
        delete row.dueDate;
      if (row.status === "concluida" && row.remainingMinutes > 0) {
        row.status = "em_andamento";
        delete row.completedAtUtc;
      }
      if (
        old &&
        (old.estimateMinutes !== row.estimateMinutes ||
          old.remainingMinutes !== row.remainingMinutes ||
          old.deadlineId !== row.deadlineId ||
          old.dueDate !== row.dueDate ||
          inlineDeadlineChanged)
      ) {
        pruneAutomatic(data, now, (block) => block.taskId === row.id);
      }
      put(data.tasks, row);
      break;
    }
    case "set-task-status": {
      const row = existing(data.tasks, command.id, "A tarefa");
      const previousStatus = row.status;
      row.status = command.status;
      row.updatedAtUtc = now;
      row.revision += 1;
      if (row.status === "concluida") {
        row.remainingMinutes = 0;
        row.completedAtUtc = now;
        pruneAutomatic(data, now, (block) => block.taskId === row.id);
      } else {
        delete row.completedAtUtc;
        row.remainingMinutes =
          command.remainingMinutes ??
          (previousStatus === "concluida"
            ? row.estimateMinutes
            : row.remainingMinutes);
      }
      break;
    }
    case "delete-task": {
      existing(data.tasks, command.id, "A tarefa");
      data.tasks = data.tasks.filter((row) => row.id !== command.id);
      data.planBlocks = data.planBlocks.filter(
        (row) => row.taskId !== command.id,
      );
      // Keep the plan's history, without an orphaned link to a deleted task.
      data.planDecisions = data.planDecisions.map((row) => {
        if (row.taskId !== command.id) return row;
        const next = { ...row };
        delete next.taskId;
        return next;
      });
      break;
    }
    case "save-commitment": {
      const old = command.id
        ? existing(data.commitments, command.id, "O compromisso")
        : undefined;
      subjectReference(data, command.subjectId, old?.subjectId);
      const row: Commitment = {
        ...old,
        id: old?.id ?? id(),
        title: cleanTitle(command.title, 160),
        startAtUtc: command.startAtUtc,
        endAtUtc: command.endAtUtc,
        timeZone: command.timeZone,
        isFixed: true,
        revision: (old?.revision ?? 0) + 1,
      };
      if (command.subjectId) row.subjectId = command.subjectId;
      else delete row.subjectId;
      if (command.kind) row.kind = command.kind;
      if (
        data.commitments.some(
          (item) =>
            item.id !== row.id &&
            intersects(
              row.startAtUtc,
              row.endAtUtc,
              item.startAtUtc,
              item.endAtUtc,
            ),
        )
      ) {
        throw new Error(
          "Esse horário já contém outro compromisso. Revise o intervalo.",
        );
      }
      if (
        data.planBlocks.some(
          (item) =>
            item.source === "manual" &&
            data.tasks.some(
              (task) => task.id === item.taskId && task.status !== "concluida",
            ) &&
            intersects(
              row.startAtUtc,
              row.endAtUtc,
              item.startAtUtc,
              item.endAtUtc,
            ),
        )
      ) {
        throw new Error(
          "Esse horário contém um bloco manual protegido. Ajuste-o antes de salvar o compromisso.",
        );
      }
      pruneAutomatic(data, now, (block) =>
        intersects(
          row.startAtUtc,
          row.endAtUtc,
          block.startAtUtc,
          block.endAtUtc,
        ),
      );
      put(data.commitments, row);
      break;
    }
    case "delete-commitment":
      existing(data.commitments, command.id, "O compromisso");
      data.commitments = data.commitments.filter(
        (row) => row.id !== command.id,
      );
      break;
    case "save-deadline": {
      const old = command.id
        ? existing(data.deadlines, command.id, "O prazo")
        : undefined;
      subjectReference(data, command.subjectId, old?.subjectId);
      const row: Deadline = {
        ...old,
        id: old?.id ?? id(),
        title: cleanTitle(command.title, 160),
        revision: (old?.revision ?? 0) + 1,
      };
      if (command.subjectId) row.subjectId = command.subjectId;
      else delete row.subjectId;
      if (command.dueDate) row.dueDate = command.dueDate;
      else delete row.dueDate;
      if (command.dueAtUtc) row.dueAtUtc = command.dueAtUtc;
      else delete row.dueAtUtc;
      if (command.timeZone) row.timeZone = command.timeZone;
      else delete row.timeZone;
      if (
        old &&
        (old.dueDate !== row.dueDate || old.dueAtUtc !== row.dueAtUtc)
      ) {
        const affectedTasks = new Set(
          data.tasks
            .filter((task) => task.deadlineId === row.id)
            .map((task) => task.id),
        );
        pruneAutomatic(data, now, (block) => affectedTasks.has(block.taskId));
      }
      put(data.deadlines, row);
      break;
    }
    case "delete-deadline":
      existing(data.deadlines, command.id, "O prazo");
      if (data.tasks.some((task) => task.deadlineId === command.id))
        throw new Error(
          "Este prazo está vinculado a tarefas. Remova os vínculos antes de excluí-lo.",
        );
      data.deadlines = data.deadlines.filter((row) => row.id !== command.id);
      break;
    case "save-rule": {
      const old = command.id
        ? existing(data.availabilityRules, command.id, "A janela semanal")
        : undefined;
      put(data.availabilityRules, {
        id: command.id ?? id(),
        weekday: command.weekday,
        startLocalTime: command.startLocalTime,
        endLocalTime: command.endLocalTime,
        timeZone: command.timeZone,
        enabled: command.enabled,
      });
      validateWorkspaceData(data);
      pruneOutsideAvailability(
        data,
        now,
        (block) =>
          localParts(block.startAtUtc, command.timeZone).weekday ===
            command.weekday ||
          Boolean(
            old &&
              localParts(block.startAtUtc, old.timeZone).weekday ===
                old.weekday,
          ),
      );
      break;
    }
    case "delete-rule": {
      const old = existing(
        data.availabilityRules,
        command.id,
        "A janela semanal",
      );
      data.availabilityRules = data.availabilityRules.filter(
        (row) => row.id !== command.id,
      );
      pruneOutsideAvailability(
        data,
        now,
        (block) =>
          localParts(block.startAtUtc, old.timeZone).weekday === old.weekday,
      );
      break;
    }
    case "save-exception": {
      const old = command.id
        ? existing(data.availabilityExceptions, command.id, "A exceção")
        : undefined;
      const row: AvailabilityException = {
        id: command.id ?? id(),
        localDate: command.localDate,
        type: command.exceptionType,
      };
      if (command.startLocalTime !== undefined)
        row.startLocalTime = command.startLocalTime;
      if (command.endLocalTime !== undefined)
        row.endLocalTime = command.endLocalTime;
      if (
        row.type === "r02-janela" &&
        (!row.startLocalTime || !row.endLocalTime)
      )
        throw new Error("Informe o início e o fim da janela específica.");
      put(data.availabilityExceptions, row);
      validateWorkspaceData(data);
      const zone =
        data.preferences[0]?.timeZone ??
        Intl.DateTimeFormat().resolvedOptions().timeZone;
      pruneOutsideAvailability(data, now, (block) => {
        const date = localParts(block.startAtUtc, zone).date;
        return date === row.localDate || date === old?.localDate;
      });
      break;
    }
    case "delete-exception": {
      const old = existing(
        data.availabilityExceptions,
        command.id,
        "A exceção",
      );
      data.availabilityExceptions = data.availabilityExceptions.filter(
        (row) => row.id !== command.id,
      );
      const zone =
        data.preferences[0]?.timeZone ??
        Intl.DateTimeFormat().resolvedOptions().timeZone;
      pruneOutsideAvailability(
        data,
        now,
        (block) => localParts(block.startAtUtc, zone).date === old.localDate,
      );
      break;
    }
    case "save-preferences": {
      const old = data.preferences[0];
      const row: Preferences = {
        ...old,
        id: "local",
        locale: old?.locale ?? "pt-BR",
        timeZone:
          old?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        mode: old?.mode ?? "normal",
        updatedAtUtc: now,
      };
      if (command.locale !== undefined) row.locale = command.locale;
      if (command.timeZone !== undefined) row.timeZone = command.timeZone;
      if (command.planningHorizonDays !== undefined)
        row.planningHorizonDays = command.planningHorizonDays;
      if (command.dailyFlexibleLimitMinutes === null)
        delete row.dailyFlexibleLimitMinutes;
      else if (command.dailyFlexibleLimitMinutes !== undefined)
        row.dailyFlexibleLimitMinutes = command.dailyFlexibleLimitMinutes;
      if (command.lightModeRatio !== undefined)
        row.lightModeRatio = command.lightModeRatio;
      data.preferences = [row];
      validateWorkspaceData(data);
      if (old?.timeZone !== row.timeZone) pruneOutsideAvailability(data, now);
      break;
    }
    case "clear-all":
      data = emptyBackupData();
      break;
    default: {
      const exhaustive: never = command;
      throw new Error(`Ação desconhecida: ${String(exhaustive)}`);
    }
  }
  setWorkspaceRevision(data, previousRevision + 1);
  validateWorkspaceData(data);
  return data;
}

export async function loadWorkspace(db: CampulsoDexieDB): Promise<BackupData> {
  const snapshot = await db.snapshot();
  validateWorkspaceData(snapshot);
  revisionOf(snapshot);
  return snapshot;
}

export async function executeCommand(
  db: CampulsoDexieDB,
  expectedRevision: number,
  command: Command,
): Promise<BackupData> {
  // Copy the command before yielding so the form cannot change the in-flight request.
  const capturedCommand = structuredClone(command);
  return db.transaction("rw", [...STORE_NAMES], async () => {
    const current = await db.snapshot();
    assertRevision(current, expectedRevision);
    const next = reduceCommand(current, capturedCommand);
    await db.replaceSnapshot(next);
    return next;
  });
}

export async function exportWorkspace(
  db: CampulsoDexieDB,
): Promise<CampulsoBackup> {
  const snapshot = await loadWorkspace(db);
  return createBackup(snapshot, {
    appVersion: APP_VERSION,
    exportedAtUtc: new Date().toISOString(),
  });
}

export async function parseBackupText(text: string): Promise<CampulsoBackup> {
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES)
    throw new Error("O arquivo excede o limite de 20 MiB.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      "O arquivo não contém JSON válido. Nenhum dado foi alterado.",
    );
  }
  return validateBackup(parsed);
}

/** The caller presents a summary and obtains the user's explicit replacement confirmation. */
export async function restoreWorkspace(
  db: CampulsoDexieDB,
  expectedRevision: number,
  backup: CampulsoBackup,
): Promise<BackupData> {
  const captured = structuredClone(backup);
  await validateBackup(captured);
  // Validate revision metadata before starting any write; older valid snapshots without it start at 1.
  const importedRevision = revisionOf(captured.data);
  return db.transaction("rw", [...STORE_NAMES], async () => {
    const current = await db.snapshot();
    assertRevision(current, expectedRevision);
    const restored = structuredClone(captured.data);
    setWorkspaceRevision(
      restored,
      Math.max(revisionOf(current), importedRevision) + 1,
    );
    await db.replaceSnapshot(restored);
    // Reread within the same transaction, so the returned summary is the data actually written.
    return db.snapshot();
  });
}
