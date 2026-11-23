export type Importance = "baixa" | "media" | "alta";
export type TaskStatus = "aberta" | "em_andamento" | "concluida";
export type PlanningMode = "normal" | "leve";

export interface Subject {
  id: string;
  name: string;
  createdAtUtc: string;
  revision: number;
  termId?: string;
  accentToken?: string;
  archivedAtUtc?: string;
}

export interface Task {
  id: string;
  subjectId?: string;
  title: string;
  estimateMinutes: number;
  remainingMinutes: number;
  importance: Importance;
  status: TaskStatus;
  /** Compatibilidade de leitura com snapshots POC-001 v2 anteriores. */
  dueDate?: string;
  /** Campo canônico do DPA; o prazo detalhado vive em Deadline. */
  deadlineId?: string;
  pinned?: boolean;
  createdAtUtc: string;
  updatedAtUtc: string;
  completedAtUtc?: string;
  revision: number;
}

export interface Commitment {
  id: string;
  subjectId?: string;
  title: string;
  kind?: "aula" | "avaliacao" | "estagio" | "outro";
  startAtUtc: string;
  endAtUtc: string;
  timeZone: string;
  isFixed: boolean;
  revision: number;
}

export interface Deadline {
  id: string;
  subjectId?: string;
  title: string;
  dueDate?: string;
  dueAtUtc?: string;
  timeZone?: string;
  kind?: string;
  revision: number;
}

export interface Preferences {
  id: "local";
  locale: string;
  timeZone: string;
  mode: PlanningMode;
  updatedAtUtc: string;
  weekStartsOn?: number;
  planningHorizonDays?: number;
  dailyFlexibleLimitMinutes?: number;
  lightModeRatio?: number;
}

export interface AvailabilityRule {
  id: string;
  weekday: number;
  startLocalTime: string;
  endLocalTime: string;
  timeZone: string;
  enabled: boolean;
}

export interface AvailabilityException {
  id: string;
  localDate: string;
  type: string;
  startLocalTime?: string;
  endLocalTime?: string;
  reasonLabel?: string;
}

export interface PlanRun {
  id: string;
  createdAtUtc: string;
  algorithmVersion: string;
  inputRevision: number;
  mode: PlanningMode;
  status: "proposta" | "aplicado" | "descartado";
  summary: string;
  reasonCodes: string[];
}

export interface PlanBlock {
  id: string;
  taskId: string;
  planRunId: string;
  startAtUtc: string;
  endAtUtc: string;
  source: "automatic" | "manual";
  revision: number;
}

export interface PlanDecision {
  id: string;
  planRunId: string;
  taskId?: string;
  code: string;
  parameters: Record<string, string | number | boolean | null>;
  messageKey: string;
}

export interface AppMeta {
  key: string;
  value: string;
}

export interface BackupData {
  preferences: Preferences[];
  subjects: Subject[];
  commitments: Commitment[];
  deadlines: Deadline[];
  tasks: Task[];
  availabilityRules: AvailabilityRule[];
  availabilityExceptions: AvailabilityException[];
  planRuns: PlanRun[];
  planBlocks: PlanBlock[];
  planDecisions: PlanDecision[];
  appMeta: AppMeta[];
}

export interface CampulsoBackup {
  product: "CAMPULSO";
  backupFormatVersion: 1;
  dbSchemaVersion: 2;
  exportedAtUtc: string;
  appVersion: string;
  data: BackupData;
  integrity: {
    algorithm: "SHA-256";
    canonicalization: "CAMPULSO-CJSON-1";
    dataDigestHex: string;
  };
}

export const STORE_NAMES = [
  "preferences",
  "subjects",
  "commitments",
  "deadlines",
  "tasks",
  "availabilityRules",
  "availabilityExceptions",
  "planRuns",
  "planBlocks",
  "planDecisions",
  "appMeta",
] as const;

export type StoreName = (typeof STORE_NAMES)[number];

export function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isValidInstant(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function validateTask(value: unknown): asserts value is Task {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Tarefa inválida.");
  const task = value as Partial<Task>;
  if (typeof task.id !== "string" || !task.id.trim()) throw new Error("Identificador da tarefa inválido.");
  if (typeof task.title !== "string" || !task.title.trim() || task.title.length > 160) throw new Error("O título deve ter entre 1 e 160 caracteres.");
  if (!Number.isInteger(task.estimateMinutes) || (task.estimateMinutes ?? 0) < 15) throw new Error("A duração estimada mínima é de 15 minutos.");
  if (!Number.isInteger(task.remainingMinutes) || (task.remainingMinutes ?? -1) < 0 || (task.remainingMinutes ?? Infinity) > (task.estimateMinutes ?? 0)) throw new Error("Tempo restante inválido.");
  if (!(["baixa", "media", "alta"] as unknown[]).includes(task.importance)) throw new Error("Importância inválida.");
  if (!("aberta em_andamento concluida".split(" ")).includes(task.status ?? "")) throw new Error("Estado da tarefa inválido.");
  if (!Number.isInteger(task.revision) || (task.revision ?? 0) < 1) throw new Error("Revisão da tarefa inválida.");
  if (task.subjectId !== undefined && (typeof task.subjectId !== "string" || !task.subjectId.trim())) throw new Error("Referência de disciplina inválida.");
  if (task.dueDate !== undefined && !isValidDateOnly(task.dueDate)) throw new Error("Prazo deve usar uma data válida no formato AAAA-MM-DD.");
  if (task.deadlineId !== undefined && (typeof task.deadlineId !== "string" || !task.deadlineId.trim())) throw new Error("Referência de prazo inválida.");
  if (task.pinned !== undefined && typeof task.pinned !== "boolean") throw new Error("Destaque manual inválido.");
  if (typeof task.createdAtUtc !== "string" || !isValidInstant(task.createdAtUtc)) throw new Error("Data de criação da tarefa inválida.");
  if (typeof task.updatedAtUtc !== "string" || !isValidInstant(task.updatedAtUtc)) throw new Error("Data de atualização da tarefa inválida.");
  if (task.completedAtUtc !== undefined && !isValidInstant(task.completedAtUtc)) throw new Error("Data de conclusão inválida.");
  if (task.status === "concluida" && task.remainingMinutes !== 0) throw new Error("Tarefa concluída deve ter zero minutos restantes.");
}

export function validateSubject(value: unknown): asserts value is Subject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Disciplina inválida.");
  const subject = value as Partial<Subject>;
  if (typeof subject.id !== "string" || !subject.id.trim()) throw new Error("Identificador da disciplina inválido.");
  if (typeof subject.name !== "string" || !subject.name.trim() || subject.name.length > 120) throw new Error("Nome da disciplina inválido.");
  if (!Number.isInteger(subject.revision) || (subject.revision ?? 0) < 1) throw new Error("Revisão da disciplina inválida.");
  if (typeof subject.createdAtUtc !== "string" || !isValidInstant(subject.createdAtUtc)) throw new Error("Data de criação da disciplina inválida.");
}
