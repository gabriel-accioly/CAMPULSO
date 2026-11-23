import {
  STORE_NAMES,
  isValidDateOnly,
  isValidInstant,
  isValidTimeZone,
  validateSubject,
  validateTask,
  type BackupData,
  type CampulsoBackup,
  type StoreName,
} from "./model.js";

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}: registro inválido.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label}: objeto especial não permitido.`);
  for (const key of Object.keys(value)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error(`${label}: propriedade proibida (${key}).`);
  }
}

function requiredString(row: object, key: string, label: string, max = 500): string {
  const value = (row as Record<string, unknown>)[key];
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${label}: campo ${key} inválido.`);
  return value;
}

const ALLOWED_ROW_KEYS: Record<StoreName, readonly string[]> = {
  preferences: ["id", "locale", "timeZone", "mode", "updatedAtUtc", "weekStartsOn", "planningHorizonDays", "dailyFlexibleLimitMinutes", "lightModeRatio"],
  subjects: ["id", "name", "createdAtUtc", "revision", "termId", "accentToken", "archivedAtUtc"],
  commitments: ["id", "subjectId", "title", "kind", "startAtUtc", "endAtUtc", "timeZone", "isFixed", "revision"],
  deadlines: ["id", "subjectId", "title", "dueDate", "dueAtUtc", "timeZone", "kind", "revision"],
  tasks: ["id", "subjectId", "title", "estimateMinutes", "remainingMinutes", "importance", "status", "dueDate", "deadlineId", "pinned", "createdAtUtc", "updatedAtUtc", "completedAtUtc", "revision"],
  availabilityRules: ["id", "weekday", "startLocalTime", "endLocalTime", "timeZone", "enabled"],
  availabilityExceptions: ["id", "localDate", "type", "startLocalTime", "endLocalTime", "reasonLabel"],
  planRuns: ["id", "createdAtUtc", "algorithmVersion", "inputRevision", "mode", "status", "summary", "reasonCodes"],
  planBlocks: ["id", "taskId", "planRunId", "startAtUtc", "endAtUtc", "source", "revision"],
  planDecisions: ["id", "planRunId", "taskId", "code", "parameters", "messageKey"],
  appMeta: ["key", "value"],
};

function validateGenericRows(data: BackupData, store: StoreName): void {
  const rows = data[store] as unknown[];
  if (!Array.isArray(rows)) throw new Error(`Coleção ausente ou inválida: ${store}.`);
  const keyName = store === "appMeta" ? "key" : "id";
  const seen = new Set<string>();
  for (const [index, raw] of rows.entries()) {
    assertRecord(raw, `${store}[${index}]`);
    const id = requiredString(raw, keyName, `${store}[${index}]`, 200);
    const allowed = new Set(ALLOWED_ROW_KEYS[store]);
    const extra = Object.keys(raw).filter((key) => !allowed.has(key));
    if (extra.length) throw new Error(`${store}[${index}]: propriedades fora do contrato (${extra.join(", ")}).`);
    if (seen.has(id)) throw new Error(`Chave duplicada em ${store}: ${id}.`);
    seen.add(id);
  }
}

function validateCommitment(row: BackupData["commitments"][number]): void {
  assertRecord(row, "Compromisso");
  requiredString(row, "title", "Compromisso", 160);
  if (!isValidInstant(row.startAtUtc) || !isValidInstant(row.endAtUtc) || Date.parse(row.endAtUtc) <= Date.parse(row.startAtUtc)) {
    throw new Error("Intervalo de compromisso inválido.");
  }
  if (row.kind !== undefined && !("aula avaliacao estagio outro".split(" ")).includes(row.kind)) throw new Error("Tipo de compromisso inválido.");
  if (typeof row.timeZone !== "string" || !isValidTimeZone(row.timeZone)) throw new Error("Fuso horário do compromisso inválido.");
  if (typeof row.isFixed !== "boolean" || !Number.isInteger(row.revision) || row.revision < 1) throw new Error("Metadados do compromisso inválidos.");
}

function validateDeadline(row: BackupData["deadlines"][number]): void {
  assertRecord(row, "Prazo");
  requiredString(row, "title", "Prazo", 160);
  const hasDate = typeof row.dueDate === "string" && row.dueDate.length > 0;
  const hasInstant = typeof row.dueAtUtc === "string" && row.dueAtUtc.length > 0;
  if (hasDate === hasInstant) throw new Error("O prazo deve conter exatamente uma data ou um instante.");
  if (hasDate && !isValidDateOnly(row.dueDate!)) throw new Error("Data de prazo inválida.");
  if (hasInstant && !isValidInstant(row.dueAtUtc!)) throw new Error("Instante de prazo inválido.");
  if (!Number.isInteger(row.revision) || row.revision < 1) throw new Error("Revisão do prazo inválida.");
  if (row.timeZone !== undefined && !isValidTimeZone(row.timeZone)) throw new Error("Fuso do prazo inválido.");
}

function validateAvailabilityRule(row: BackupData["availabilityRules"][number]): void {
  assertRecord(row, "Regra de disponibilidade");
  if (!Number.isInteger(row.weekday) || row.weekday < 0 || row.weekday > 6) throw new Error("Dia da semana inválido.");
  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (typeof row.startLocalTime !== "string" || typeof row.endLocalTime !== "string" || !timePattern.test(row.startLocalTime) || !timePattern.test(row.endLocalTime) || row.endLocalTime <= row.startLocalTime) throw new Error("Janela de disponibilidade inválida.");
  if (typeof row.timeZone !== "string" || !isValidTimeZone(row.timeZone) || typeof row.enabled !== "boolean") throw new Error("Metadados da disponibilidade inválidos.");
}

function validateAvailabilityException(row: BackupData["availabilityExceptions"][number]): void {
  assertRecord(row, "Exceção de disponibilidade");
  if (!isValidDateOnly(row.localDate)) throw new Error("Data da exceção de disponibilidade inválida.");
  requiredString(row, "type", "Exceção de disponibilidade", 40);
  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (row.startLocalTime !== undefined && !timePattern.test(row.startLocalTime)) throw new Error("Início da exceção inválido.");
  if (row.endLocalTime !== undefined && !timePattern.test(row.endLocalTime)) throw new Error("Fim da exceção inválido.");
  if ((row.startLocalTime === undefined) !== (row.endLocalTime === undefined)) throw new Error("A exceção deve informar início e fim juntos.");
  if (row.startLocalTime && row.endLocalTime && row.endLocalTime <= row.startLocalTime) throw new Error("Intervalo da exceção inválido.");
}

function validatePreferences(row: BackupData["preferences"][number]): void {
  assertRecord(row, "Preferências");
  if (row.id !== "local") throw new Error("Identificador de preferências incompatível.");
  requiredString(row, "locale", "Preferências", 32);
  if (typeof row.timeZone !== "string" || !isValidTimeZone(row.timeZone)) throw new Error("Fuso horário das preferências inválido.");
  if (row.mode !== "normal" && row.mode !== "leve") throw new Error("Modo de planejamento inválido.");
  if (!isValidInstant(row.updatedAtUtc)) throw new Error("Data de atualização das preferências inválida.");
  if (row.weekStartsOn !== undefined && (!Number.isInteger(row.weekStartsOn) || row.weekStartsOn < 0 || row.weekStartsOn > 6)) throw new Error("Início da semana inválido.");
  if (row.planningHorizonDays !== undefined && (!Number.isInteger(row.planningHorizonDays) || row.planningHorizonDays < 1 || row.planningHorizonDays > 31)) throw new Error("Horizonte de planejamento inválido.");
  if (row.dailyFlexibleLimitMinutes !== undefined && (!Number.isInteger(row.dailyFlexibleLimitMinutes) || row.dailyFlexibleLimitMinutes < 0)) throw new Error("Limite diário inválido.");
  if (row.lightModeRatio !== undefined && (typeof row.lightModeRatio !== "number" || row.lightModeRatio < 0 || row.lightModeRatio > 1)) throw new Error("Fator do Modo leve inválido.");
}

export function validateBackupData(value: unknown): asserts value is BackupData {
  assertRecord(value, "Dados do backup");
  const data = value as unknown as BackupData;
  const expectedStores = new Set<string>(STORE_NAMES);
  const extraStores = Object.keys(data).filter((key) => !expectedStores.has(key));
  const missingStores = STORE_NAMES.filter((store) => !Object.prototype.hasOwnProperty.call(data, store));
  if (extraStores.length || missingStores.length) throw new Error("O conjunto de coleções do backup não corresponde ao contrato.");
  for (const store of STORE_NAMES) validateGenericRows(data, store);

  data.preferences.forEach(validatePreferences);
  if (data.preferences.length > 1) throw new Error("O backup contém mais de um registro de preferências locais.");
  data.subjects.forEach(validateSubject);
  data.tasks.forEach(validateTask);
  data.commitments.forEach(validateCommitment);
  data.deadlines.forEach(validateDeadline);
  data.availabilityRules.forEach(validateAvailabilityRule);
  data.availabilityExceptions.forEach(validateAvailabilityException);
  for (const meta of data.appMeta) requiredString(meta, "value", "Metadado local", 2000);

  const subjectIds = new Set(data.subjects.map((item) => item.id));
  const deadlineIds = new Set(data.deadlines.map((item) => item.id));
  const taskIds = new Set(data.tasks.map((item) => item.id));
  const planRunIds = new Set(data.planRuns.map((item) => item.id));

  for (const item of [...data.tasks, ...data.commitments, ...data.deadlines]) {
    if (item.subjectId && !subjectIds.has(item.subjectId)) throw new Error(`Referência a disciplina inexistente: ${item.subjectId}.`);
  }
  for (const task of data.tasks) {
    if (task.deadlineId && !deadlineIds.has(task.deadlineId)) throw new Error(`Referência a prazo inexistente: ${task.deadlineId}.`);
  }
  for (const block of data.planBlocks) {
    if (!taskIds.has(block.taskId) || !planRunIds.has(block.planRunId)) throw new Error("Bloco de planejamento com referência inexistente.");
    if (!isValidInstant(block.startAtUtc) || !isValidInstant(block.endAtUtc) || Date.parse(block.endAtUtc) <= Date.parse(block.startAtUtc)) throw new Error("Intervalo de bloco inválido.");
    if (block.source !== "automatic" && block.source !== "manual") throw new Error("Origem do bloco de planejamento inválida.");
    if (!Number.isInteger(block.revision) || block.revision < 1) throw new Error("Revisão do bloco inválida.");
  }
  for (const decision of data.planDecisions) {
    if (!planRunIds.has(decision.planRunId)) throw new Error("Decisão vinculada a uma execução inexistente.");
    if (decision.taskId && !taskIds.has(decision.taskId)) throw new Error("Decisão vinculada a uma tarefa inexistente.");
    requiredString(decision, "code", "Decisão de planejamento", 100);
    requiredString(decision, "messageKey", "Decisão de planejamento", 160);
    assertRecord(decision.parameters, "Parâmetros da decisão");
  }
  for (const run of data.planRuns) {
    if (!isValidInstant(run.createdAtUtc) || !Number.isInteger(run.inputRevision) || run.inputRevision < 0) throw new Error("Execução de planejamento inválida.");
    if (typeof run.algorithmVersion !== "string" || !run.algorithmVersion.trim() || typeof run.summary !== "string" || !Array.isArray(run.reasonCodes) || !run.reasonCodes.every((code) => typeof code === "string")) throw new Error("Metadados da execução de planejamento inválidos.");
    if (!("proposta aplicado descartado".split(" ")).includes(run.status)) throw new Error("Estado da execução de planejamento inválido.");
    if (run.mode !== "normal" && run.mode !== "leve") throw new Error("Modo da execução de planejamento inválido.");
  }
}

export function canonicalize(value: unknown, path = "$"): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Número não finito no backup em ${path}.`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value) || value[index] === undefined) throw new Error(`Valor ausente ou indefinido em array em ${path}[${index}].`);
      items.push(canonicalize(value[index], `${path}[${index}]`));
    }
    return `[${items.join(",")}]`;
  }
  if (typeof value === "object") {
    assertRecord(value, path);
    const row = value as Record<string, unknown>;
    const keys = Object.keys(row).filter((key) => row[key] !== undefined).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(row[key], `${path}.${key}`)}`).join(",")}}`;
  }
  throw new Error(`Tipo não permitido no backup em ${path} (typeof ${typeof value}).`);
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createBackup(
  data: BackupData,
  metadata: { exportedAtUtc: string; appVersion: string },
): Promise<CampulsoBackup> {
  validateBackupData(data);
  if (!isValidInstant(metadata.exportedAtUtc) || !metadata.appVersion.trim()) throw new Error("Metadados de exportação inválidos.");
  return {
    product: "CAMPULSO",
    backupFormatVersion: 1,
    dbSchemaVersion: 2,
    exportedAtUtc: metadata.exportedAtUtc,
    appVersion: metadata.appVersion,
    data,
    integrity: {
      algorithm: "SHA-256",
      canonicalization: "CAMPULSO-CJSON-1",
      dataDigestHex: await sha256Hex(canonicalize(data)),
    },
  };
}

export async function validateBackup(value: unknown): Promise<CampulsoBackup> {
  assertRecord(value, "Envelope de backup");
  const backup = value as Partial<CampulsoBackup>;
  if (backup.product !== "CAMPULSO") throw new Error("O arquivo não é um backup CAMPULSO.");
  if (backup.backupFormatVersion !== 1 || backup.dbSchemaVersion !== 2) throw new Error("Versão de backup incompatível.");
  if (typeof backup.exportedAtUtc !== "string" || !isValidInstant(backup.exportedAtUtc)) throw new Error("Data de exportação inválida.");
  if (typeof backup.appVersion !== "string" || !backup.appVersion.trim()) throw new Error("Versão do aplicativo ausente.");
  if (!backup.integrity || backup.integrity.algorithm !== "SHA-256" || backup.integrity.canonicalization !== "CAMPULSO-CJSON-1") throw new Error("Metadados de integridade incompatíveis.");
  if (typeof backup.integrity.dataDigestHex !== "string" || !/^[a-f0-9]{64}$/.test(backup.integrity.dataDigestHex)) throw new Error("Digest de integridade inválido.");
  validateBackupData(backup.data);
  const actual = await sha256Hex(canonicalize(backup.data));
  if (actual !== backup.integrity.dataDigestHex) throw new Error("A verificação SHA-256 falhou. Nenhum dado foi alterado.");
  return backup as CampulsoBackup;
}

export function emptyBackupData(): BackupData {
  return {
    preferences: [], subjects: [], commitments: [], deadlines: [], tasks: [],
    availabilityRules: [], availabilityExceptions: [], planRuns: [], planBlocks: [],
    planDecisions: [], appMeta: [],
  };
}
