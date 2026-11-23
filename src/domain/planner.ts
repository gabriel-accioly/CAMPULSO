import { availabilityExceptionKind } from "./model.js";
import { canonicalize, validateWorkspaceData } from "./backup.js";
import {
  STORE_NAMES,
  isValidDateOnly,
  isValidInstant,
  isValidTimeZone,
  type BackupData,
  type PlanningMode,
  type Task,
} from "./model.js";
import type { CampulsoDexieDB } from "../infrastructure/database.js";

/** DPA v1.16, seção 7. Pesos são parâmetros de prototipação, não uma medida de aprendizagem. */
export const ALGORITHM_VERSION = "planner-v1";
const MINUTE = 60_000;
const MIN_BLOCK = 15;

export interface PlannerOptions {
  nowUtc: string;
  timeZone: string;
  startDate?: string;
  horizonDays?: number;
  mode?: PlanningMode;
}
export interface ProposedBlock {
  taskId: string;
  startAtUtc: string;
  endAtUtc: string;
}
export interface PlanningDecision {
  taskId?: string;
  code: string;
  reason: string;
}
export interface PlanProposal {
  algorithmVersion: typeof ALGORITHM_VERSION;
  inputRevision: number;
  options: PlannerOptions;
  startDate: string;
  endDateExclusive: string;
  mode: PlanningMode;
  blocks: ProposedBlock[];
  unscheduled: {
    taskId: string;
    remainingMinutes: number;
    reason: string;
    code: string;
  }[];
  decisions: PlanningDecision[];
  warnings: string[];
  reasonCodes: string[];
  capacityMinutes: number;
  budgetMinutes: number;
  usedMinutes: number;
}
interface Interval {
  start: number;
  end: number;
}
interface DayCapacity {
  date: string;
  slots: Interval[];
  budget: number;
}
interface Due {
  date?: string;
  instant?: number;
  overdue: boolean;
  days?: number;
}
interface Candidate {
  task: Task;
  due: Due;
  remaining: number;
  score: number;
  risk: number;
  conflicted: boolean;
}
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let result = formatters.get(timeZone);
  if (!result) {
    if (typeof timeZone !== "string" || !timeZone || !isValidTimeZone(timeZone))
      throw new Error("Fuso horário inválido.");
    result = new Intl.DateTimeFormat("en-CA-u-ca-gregory-nu-latn", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, result);
  }
  return result;
}
function parts(
  epoch: number,
  timeZone: string,
): { date: string; time: string } {
  const p = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(epoch)
      .map((v) => [v.type, v.value]),
  );
  return {
    date: `${p.year.padStart(4, "0")}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`,
  };
}
/** Datas civis permanecem datas; esta função converte somente um instante informado. */
export function dateInZone(instant: string, timeZone: string): string {
  if (!isValidInstant(instant)) throw new Error("Instante inválido.");
  return parts(Date.parse(instant), timeZone).date;
}
/** Rejeita os dois casos em que um horário local não identifica um único instante. */
export function instantForLocal(
  date: string,
  time: string,
  timeZone: string,
): string {
  if (!isValidDateOnly(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw new Error("Data ou horário local inválido.");
  const nominal = Date.parse(`${date}T${time}:00.000Z`);
  const offsets = new Set<number>();
  // Amostragem dos offsets dos dois lados de uma transição, sem assumir a duração do DST.
  for (let hours = -48; hours <= 48; hours += 6) {
    const epoch = nominal + hours * 60 * MINUTE;
    const local = parts(epoch, timeZone);
    offsets.add(Date.parse(`${local.date}T${local.time}:00.000Z`) - epoch);
  }
  const candidates = [...offsets]
    .map((offset) => nominal - offset)
    .filter((epoch) => {
      const local = parts(epoch, timeZone);
      return local.date === date && local.time === time;
    });
  if (!candidates.length)
    throw new Error(
      `O horário ${date} ${time} não existe no fuso ${timeZone}. Escolha outro horário.`,
    );
  if (candidates.length !== 1)
    throw new Error(
      `O horário ${date} ${time} é ambíguo no fuso ${timeZone}. Escolha um horário fora da transição.`,
    );
  return new Date(candidates[0]).toISOString();
}
function addDays(date: string, amount: number): string {
  const d = new Date(`${date}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
}
function dayNumber(date: string): number {
  return Date.parse(`${date}T12:00:00.000Z`) / (1440 * MINUTE);
}
/** Primeiro minuto da data civil: aceita dias em que o relógio salta de 23h59 para 01h00. */
function dayStart(date: string, timeZone: string): number {
  const nominal = Date.parse(`${date}T00:00:00.000Z`) / MINUTE;
  let low = nominal - 36 * 60;
  let high = nominal + 36 * 60;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (parts(middle * MINUTE, timeZone).date < date) low = middle + 1;
    else high = middle;
  }
  if (parts(low * MINUTE, timeZone).date !== date)
    throw new Error(`A data ${date} não existe no fuso ${timeZone}.`);
  return low * MINUTE;
}
function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}
function union(intervals: Interval[]): Interval[] {
  const merged: Interval[] = [];
  for (const value of intervals
    .filter((v) => v.end > v.start)
    .sort((a, b) => a.start - b.start || a.end - b.end)) {
    const last = merged.at(-1);
    if (last && value.start <= last.end)
      last.end = Math.max(last.end, value.end);
    else merged.push({ ...value });
  }
  return merged;
}
function subtract(intervals: Interval[], blocked: Interval[]): Interval[] {
  let result = union(intervals);
  for (const block of union(blocked))
    result = result.flatMap((slot) =>
      !overlaps(slot, block)
        ? [slot]
        : [
            { start: slot.start, end: Math.min(slot.end, block.start) },
            { start: Math.max(slot.start, block.end), end: slot.end },
          ].filter((v) => v.end > v.start),
    );
  return result;
}
function minutes(interval: Interval): number {
  return Math.floor((interval.end - interval.start) / MINUTE);
}
function interval(start: string, end: string): Interval {
  return { start: Date.parse(start), end: Date.parse(end) };
}
function declaredAvailability(
  data: BackupData,
  date: string,
  timeZone: string,
): Interval[] {
  const bounds = {
    start: dayStart(date, timeZone),
    end: dayStart(addDays(date, 1), timeZone),
  };
  const exceptions = data.availabilityExceptions.filter(
    (e) => e.localDate === date,
  );
  const replacements = exceptions.filter((e) =>
    availabilityExceptionKind(e.type) === "substitution",
  );
  const unavailable = exceptions.filter((e) =>
    availabilityExceptionKind(e.type) === "block",
  );
  if (replacements.length + unavailable.length !== exceptions.length)
    throw new Error(
      "Tipo de exceção de disponibilidade ainda não compatível com o planejamento. Revise as disponibilidades importadas.",
    );
  const exceptionInterval = (
    e: BackupData["availabilityExceptions"][number],
  ): Interval => {
    if (!e.startLocalTime || !e.endLocalTime)
      throw new Error("Uma janela de substituição precisa de início e fim.");
    return interval(
      instantForLocal(date, e.startLocalTime, timeZone),
      instantForLocal(date, e.endLocalTime, timeZone),
    );
  };
  const windows: Interval[] = [];
  if (replacements.length) windows.push(...replacements.map(exceptionInterval));
  else
    for (const rule of data.availabilityRules.filter((r) => r.enabled)) {
      const firstDate = parts(bounds.start, rule.timeZone).date;
      const lastDate = parts(bounds.end - 1, rule.timeZone).date;
      for (
        let ruleDate = firstDate;
        ruleDate <= lastDate;
        ruleDate = addDays(ruleDate, 1)
      ) {
        if (new Date(`${ruleDate}T12:00:00.000Z`).getUTCDay() !== rule.weekday)
          continue;
        windows.push(
          interval(
            instantForLocal(ruleDate, rule.startLocalTime, rule.timeZone),
            instantForLocal(ruleDate, rule.endLocalTime, rule.timeZone),
          ),
        );
      }
    }
  const clipped = windows.map((w) => ({
    start: Math.max(w.start, bounds.start),
    end: Math.min(w.end, bounds.end),
  }));
  const blocked = unavailable.map((e) =>
    e.startLocalTime ? exceptionInterval(e) : bounds,
  );
  return subtract(clipped, blocked);
}
/** Janelas declaradas do dia, unidas e com exceções aplicadas. Não subtrai compromissos ou blocos. */
export function availabilityForDate(
  data: BackupData,
  date: string,
  timeZone: string,
): { startAtUtc: string; endAtUtc: string }[] {
  validateWorkspaceData(data);
  if (!isValidDateOnly(date) || !isValidTimeZone(timeZone))
    throw new Error("Data ou fuso de disponibilidade inválido.");
  return declaredAvailability(data, date, timeZone).map((v) => ({
    startAtUtc: new Date(v.start).toISOString(),
    endAtUtc: new Date(v.end).toISOString(),
  }));
}
function revision(data: BackupData): number {
  const raw = data.appMeta.find((m) => m.key === "r02.revision")?.value ?? "1";
  if (!/^[1-9]\d*$/.test(raw))
    throw new Error(
      "Revisão local inválida. Exporte os dados para recuperação.",
    );
  const result = Number(raw);
  if (
    !Number.isSafeInteger(result) ||
    result < 1 ||
    result >= Number.MAX_SAFE_INTEGER
  )
    throw new Error(
      "Revisão local inválida. Exporte os dados para recuperação.",
    );
  return result;
}
function taskDue(
  task: Task,
  data: BackupData,
  now: number,
  today: string,
  zone: string,
): Due {
  const deadline = task.deadlineId
    ? data.deadlines.find((d) => d.id === task.deadlineId)
    : undefined;
  const instant = deadline?.dueAtUtc
    ? Date.parse(deadline.dueAtUtc)
    : undefined;
  const date =
    deadline?.dueDate ??
    (instant !== undefined
      ? dateInZone(new Date(instant).toISOString(), zone)
      : task.dueDate);
  return {
    date,
    instant,
    overdue: instant !== undefined ? instant < now : !!date && date < today,
    days: date ? dayNumber(date) - dayNumber(today) : undefined,
  };
}
function compareDue(a: Due, b: Due): number {
  const civil = (a.date ?? "~").localeCompare(b.date ?? "~");
  if (civil) return civil;
  // Um prazo sem hora continua sendo data civil; não lhe atribuímos um instante.
  if (a.instant !== undefined && b.instant !== undefined)
    return a.instant - b.instant;
  return a.instant !== undefined ? -1 : b.instant !== undefined ? 1 : 0;
}
function urgency(due: Due): number {
  if (due.overdue) return 100;
  const days = due.days;
  return days === undefined
    ? 10
    : days <= 0
      ? 95
      : days === 1
        ? 80
        : days <= 3
          ? 60
          : days <= 7
            ? 40
            : 20;
}
function eligible(
  slot: Interval,
  date: string,
  due: Due,
): Interval | undefined {
  if (!due.overdue && due.date && date > due.date) return undefined;
  const end =
    !due.overdue && due.instant !== undefined
      ? Math.min(slot.end, due.instant)
      : slot.end;
  return end > slot.start ? { start: slot.start, end } : undefined;
}
function feasibleMinutes(days: DayCapacity[], due: Due): number {
  return days.reduce(
    (total, day) =>
      total +
      Math.min(
        day.budget,
        day.slots.reduce((sum, slot) => {
          const allowed = eligible(slot, day.date, due);
          const n = allowed ? minutes(allowed) : 0;
          return sum + (n >= MIN_BLOCK ? n : 0);
        }, 0),
      ),
    0,
  );
}

/** Não altera o snapshot, não lê relógio global e não grava nada durante a prévia. */
export function buildPlan(
  data: BackupData,
  options: PlannerOptions,
): PlanProposal {
  validateWorkspaceData(data);
  if (
    !isValidInstant(options.nowUtc) ||
    typeof options.timeZone !== "string" ||
    !options.timeZone ||
    !isValidTimeZone(options.timeZone)
  )
    throw new Error("Relógio ou fuso do planejamento inválido.");
  const prefs = data.preferences[0];
  const mode = options.mode ?? prefs?.mode ?? "normal";
  const horizon = options.horizonDays ?? prefs?.planningHorizonDays ?? 7;
  const now = Date.parse(options.nowUtc);
  const today = dateInZone(options.nowUtc, options.timeZone);
  const startDate = options.startDate ?? today;
  if (
    !isValidDateOnly(startDate) ||
    !Number.isInteger(horizon) ||
    horizon < 1 ||
    horizon > 31 ||
    !["normal", "leve"].includes(mode)
  )
    throw new Error("Intervalo ou modo do planejamento inválido.");
  const endDateExclusive = addDays(startDate, horizon);
  const scopeStart = Math.max(
    dayStart(startDate, options.timeZone),
    Math.ceil(now / MINUTE) * MINUTE,
  );
  const scopeEnd = dayStart(endDateExclusive, options.timeZone);
  const normalized: PlannerOptions = {
    nowUtc: new Date(now).toISOString(),
    timeZone: options.timeZone,
    startDate,
    horizonDays: horizon,
    mode,
  };
  const warnings: string[] = [];
  const decisions: PlanningDecision[] = [];
  const reasonCodes = new Set<string>();
  const note = (code: string, reason: string, taskId?: string) => {
    reasonCodes.add(code);
    decisions.push(taskId ? { taskId, code, reason } : { code, reason });
  };
  const fixed = data.commitments.map((c) => interval(c.startAtUtc, c.endAtUtc));
  // Compromissos, mesmo sem isFixed, não são tarefas flexíveis que o motor pode deslocar.
  const preserved = data.planBlocks.filter(
    (b) =>
      b.source === "manual" ||
      Date.parse(b.startAtUtc) < scopeStart ||
      Date.parse(b.endAtUtc) > scopeEnd,
  );
  // Históricos de tarefas concluídas permanecem no backup, mas não reservam tempo futuro.
  const openIds = new Set(
    data.tasks.filter((t) => t.status !== "concluida").map((t) => t.id),
  );
  const activePreserved = preserved.filter(
    (b) => openIds.has(b.taskId) && Date.parse(b.endAtUtc) > now,
  );
  const preservedIntervals = activePreserved.map((b) =>
    interval(b.startAtUtc, b.endAtUtc),
  );
  const reserved = new Map<string, number>();
  for (const b of activePreserved) {
    const remainingPart = {
      start: Math.max(now, Date.parse(b.startAtUtc)),
      end: Date.parse(b.endAtUtc),
    };
    if (remainingPart.end > remainingPart.start)
      reserved.set(
        b.taskId,
        (reserved.get(b.taskId) ?? 0) +
          Math.ceil((remainingPart.end - remainingPart.start) / MINUTE),
      );
  }
  const activeManual = activePreserved.filter(
    (b) =>
      b.source === "manual" &&
      Date.parse(b.endAtUtc) > scopeStart &&
      Date.parse(b.startAtUtc) < scopeEnd,
  );
  if (activeManual.length)
    note(
      "MANUAL_BLOCK_LOCKED",
      "Mantive os horários que você escolheu manualmente.",
    );
  if (fixed.some((b) => b.start < scopeEnd && b.end > scopeStart))
    note("FIXED_COMMITMENT", "Os compromissos cadastrados foram preservados.");
  for (const b of activeManual) {
    const span = interval(b.startAtUtc, b.endAtUtc);
    if (
      fixed.some((c) => overlaps(c, span)) ||
      activePreserved.some(
        (other) =>
          other.id !== b.id &&
          overlaps(interval(other.startAtUtc, other.endAtUtc), span),
      )
    ) {
      warnings.push(
        "Um horário manual já se sobrepõe a outro compromisso ou bloco. Ele foi preservado; revise esse conflito.",
      );
      note(
        "MANUAL_CONFLICT",
        "O horário manual foi preservado e precisa de revisão.",
        b.taskId,
      );
    }
  }
  const days: DayCapacity[] = [];
  let capacityMinutes = 0;
  let budgetMinutes = 0;
  for (let n = 0; n < horizon; n++) {
    const date = addDays(startDate, n);
    const bounds = {
      start: Math.max(dayStart(date, options.timeZone), scopeStart),
      end: dayStart(addDays(date, 1), options.timeZone),
    };
    if (bounds.end <= bounds.start) continue;
    const windows = declaredAvailability(data, date, options.timeZone);
    const clipped = windows
      .map((w) => ({
        start: Math.max(w.start, bounds.start),
        end: Math.min(w.end, bounds.end),
      }))
      .filter((w) => w.end > w.start);
    for (const manual of activeManual) {
      const part = {
        start: Math.max(Date.parse(manual.startAtUtc), bounds.start),
        end: Math.min(Date.parse(manual.endAtUtc), bounds.end),
      };
      if (part.end > part.start && subtract([part], clipped).length) {
        warnings.push(
          "Um horário manual ficou fora da disponibilidade atual. Ele foi preservado; revise esse horário.",
        );
        note(
          "MANUAL_CONFLICT",
          "O horário manual está fora da disponibilidade atual e precisa de revisão.",
          manual.taskId,
        );
      }
    }
    const slots = subtract(clipped, [...fixed, ...preservedIntervals]);
    const free = slots.reduce((sum, s) => sum + minutes(s), 0);
    const preservedMinutes = union(
      preservedIntervals.map((b) => ({
        start: Math.max(b.start, bounds.start),
        end: Math.min(b.end, bounds.end),
      })),
    ).reduce((sum, s) => sum + minutes(s), 0);
    const dailyRemaining =
      prefs?.dailyFlexibleLimitMinutes === undefined
        ? free
        : Math.max(0, prefs.dailyFlexibleLimitMinutes - preservedMinutes);
    const ratio = mode === "leve" ? (prefs?.lightModeRatio ?? 0.6) : 1;
    const budget = Math.floor(Math.min(free, dailyRemaining) * ratio);
    capacityMinutes += free;
    budgetMinutes += budget;
    days.push({ date, slots, budget });
  }
  if (mode === "leve")
    note(
      "LIGHT_MODE_CAP",
      "O Modo leve reduziu as sugestões flexíveis, preservando compromissos e prazos.",
    );
  const candidates: Candidate[] = data.tasks
    .filter((t) => t.status !== "concluida" && t.remainingMinutes > 0)
    .map((task) => {
      const due = taskDue(task, data, now, today, options.timeZone);
      const remaining = Math.max(
        0,
        task.remainingMinutes - (reserved.get(task.id) ?? 0),
      );
      const score =
        0.55 * urgency(due) +
        0.3 * { baixa: 20, media: 60, alta: 100 }[task.importance] +
        0.15 * (task.pinned ? 100 : 0);
      // Reserva capacidade para prazos próximos antes de candidatas opcionais.
      const risk = due.overdue
        ? 0
        : due.days !== undefined && due.days <= 0
          ? 1
          : due.days === 1
            ? 2
            : due.date && due.date < endDateExclusive
              ? 3
              : 4;
      return {
        task,
        due,
        remaining,
        score,
        risk,
        conflicted:
          !!due.date &&
          due.date < endDateExclusive &&
          !due.overdue &&
          remaining > feasibleMinutes(days, due),
      };
    });
  // Verificação cumulativa: tarefas isoladamente viáveis podem disputar a mesma janela.
  const dated = candidates
    .filter(
      (c) => c.due.date && !c.due.overdue && c.due.date < endDateExclusive,
    )
    .sort(
      (a, b) => compareDue(a.due, b.due) || a.task.id.localeCompare(b.task.id),
    );
  let demand = 0;
  for (let i = 0; i < dated.length; i++) {
    demand += dated[i].remaining;
    if (demand > feasibleMinutes(days, dated[i].due))
      for (const c of dated.slice(0, i + 1)) c.conflicted = true;
  }
  candidates.sort(
    (a, b) =>
      a.risk - b.risk ||
      Number(b.conflicted) - Number(a.conflicted) ||
      b.score - a.score ||
      compareDue(a.due, b.due) ||
      Date.parse(a.task.createdAtUtc) - Date.parse(b.task.createdAtUtc) ||
      a.task.id.localeCompare(b.task.id),
  );
  const blocks: ProposedBlock[] = [];
  const unscheduled: PlanProposal["unscheduled"] = [];
  let usedMinutes = 0;
  for (const c of candidates) {
    const { task, due } = c;
    if (due.overdue)
      note(
        "OVERDUE",
        "O prazo informado já passou. Estes horários são uma proposta de recuperação da pendência.",
        task.id,
      );
    else if (due.days === 0)
      note("DUE_TODAY", "Sugerida porque o prazo informado é hoje.", task.id);
    if (task.importance === "alta")
      note(
        "HIGH_IMPORTANCE",
        "Você marcou esta tarefa como importante.",
        task.id,
      );
    if (task.pinned)
      note("USER_PINNED", "Você pediu para priorizar esta tarefa.", task.id);
    if (c.conflicted)
      note(
        "DEADLINE_CONFLICT",
        "A demanda com prazo próximo excede a disponibilidade atual. Revise o plano.",
        task.id,
      );
    if (
      !due.overdue &&
      due.date &&
      activePreserved.some(
        (b) =>
          b.taskId === task.id &&
          (due.instant !== undefined
            ? Date.parse(b.endAtUtc) > due.instant
            : parts(Date.parse(b.endAtUtc) - 1, options.timeZone).date >
              due.date!),
      )
    ) {
      warnings.push(
        "Há um horário preservado depois do prazo de uma tarefa. Revise esse horário; o prazo não foi alterado.",
      );
      note(
        "DEADLINE_CONFLICT",
        "Um horário preservado está depois do prazo informado.",
        task.id,
      );
    }
    if ((reserved.get(task.id) ?? 0) > task.remainingMinutes) {
      warnings.push(
        "Há horários já preservados que excedem o esforço restante de uma tarefa. Revise esses horários.",
      );
      note(
        "MANUAL_EFFORT_CONFLICT",
        "Os horários preservados excedem o tempo restante informado.",
        task.id,
      );
    }
    let remaining = c.remaining;
    for (const day of days) {
      if (remaining < MIN_BLOCK || day.budget < MIN_BLOCK) continue;
      for (const slot of day.slots) {
        while (remaining >= MIN_BLOCK && day.budget >= MIN_BLOCK) {
          const allowed = eligible(slot, day.date, due);
          const available = allowed
            ? Math.min(minutes(allowed), day.budget)
            : 0;
          if (available < MIN_BLOCK) break;
          let amount = Math.min(remaining, available, 45);
          // Reserva pelo menos 15 min para a próxima janela quando um corte maior deixaria
          // um saldo impossível de agendar (por exemplo, 40 min em janelas de 30 + 30).
          if (remaining > amount && remaining - amount < MIN_BLOCK) {
            if (available >= remaining) amount = remaining;
            else if (remaining - MIN_BLOCK >= MIN_BLOCK)
              amount = remaining - MIN_BLOCK;
          }
          if (amount < MIN_BLOCK) break;
          blocks.push({
            taskId: task.id,
            startAtUtc: new Date(slot.start).toISOString(),
            endAtUtc: new Date(slot.start + amount * MINUTE).toISOString(),
          });
          slot.start += amount * MINUTE;
          day.budget -= amount;
          remaining -= amount;
          usedMinutes += amount;
        }
      }
    }
    if (remaining < c.remaining)
      note(
        "FITS_FREE_WINDOW",
        "Os blocos cabem na disponibilidade cadastrada e respeitam o tempo restante.",
        task.id,
      );
    if (remaining > 0) {
      const hasDeadlineConflict =
        !due.overdue && !!due.date && due.date < endDateExclusive;
      const code =
        remaining < MIN_BLOCK
          ? "MINIMUM_BLOCK"
          : hasDeadlineConflict
            ? "DEADLINE_CONFLICT"
            : "NO_CAPACITY";
      const reason =
        code === "MINIMUM_BLOCK"
          ? "Restam menos de 15 minutos; revise manualmente a duração ou o esforço restante."
          : code === "DEADLINE_CONFLICT"
            ? "O tempo restante não cabe nas janelas anteriores ao prazo. A tarefa permanece pendente."
            : "Não encontrei horário livre suficiente neste período de planejamento; a tarefa continua pendente.";
      unscheduled.push({
        taskId: task.id,
        remainingMinutes: remaining,
        code,
        reason,
      });
      note(code, reason, task.id);
    }
  }
  blocks.sort(
    (a, b) =>
      a.startAtUtc.localeCompare(b.startAtUtc) ||
      a.taskId.localeCompare(b.taskId),
  );
  return {
    algorithmVersion: ALGORITHM_VERSION,
    inputRevision: revision(data),
    options: normalized,
    startDate,
    endDateExclusive,
    mode,
    blocks,
    unscheduled,
    decisions,
    warnings: [...new Set(warnings)],
    reasonCodes: [...reasonCodes].sort(),
    capacityMinutes,
    budgetMinutes,
    usedMinutes,
  };
}

/** Retorna uma cópia; valida novamente a proposta para não confiar em objetos alteráveis da UI. */
export function applyPlanToData(
  data: BackupData,
  proposal: PlanProposal,
  context: { nowUtc?: string; id?: () => string } = {},
): BackupData {
  if (revision(data) !== proposal.inputRevision)
    throw new Error(
      "Os dados mudaram em outra aba ou depois da prévia. Recalcule e revise o plano antes de aplicar.",
    );
  const checked = buildPlan(data, proposal.options);
  if (canonicalize(checked) !== canonicalize(proposal))
    throw new Error(
      "A proposta foi alterada ou deixou de corresponder aos dados. Gere uma nova prévia.",
    );
  const nowUtc = context.nowUtc ?? proposal.options.nowUtc;
  if (!isValidInstant(nowUtc))
    throw new Error("Relógio de aplicação inválido.");
  const now = Date.parse(nowUtc);
  if (proposal.blocks.some((b) => Date.parse(b.startAtUtc) < now))
    throw new Error(
      "Um horário da prévia já passou. Recalcule e revise o plano.",
    );
  const id = context.id ?? (() => crypto.randomUUID());
  const next: BackupData = structuredClone(data);
  const scopeStart = Math.max(
    dayStart(proposal.startDate, proposal.options.timeZone),
    Math.ceil(Date.parse(proposal.options.nowUtc) / MINUTE) * MINUTE,
  );
  const scopeEnd = dayStart(
    proposal.endDateExclusive,
    proposal.options.timeZone,
  );
  next.planBlocks = next.planBlocks.filter(
    (b) =>
      b.source === "manual" ||
      Date.parse(b.startAtUtc) < scopeStart ||
      Date.parse(b.endAtUtc) > scopeEnd,
  );
  const runId = id();
  next.planRuns.push({
    id: runId,
    createdAtUtc: nowUtc,
    algorithmVersion: ALGORITHM_VERSION,
    inputRevision: proposal.inputRevision,
    mode: proposal.mode,
    status: "aplicado",
    summary: `${proposal.usedMinutes} min sugeridos; ${proposal.unscheduled.length} tarefa(s) com tempo não alocado.`,
    reasonCodes: [...proposal.reasonCodes],
  });
  for (const b of proposal.blocks)
    next.planBlocks.push({
      ...b,
      id: id(),
      planRunId: runId,
      source: "automatic",
      revision: 1,
    });
  for (const d of proposal.decisions)
    next.planDecisions.push({
      id: id(),
      planRunId: runId,
      ...(d.taskId ? { taskId: d.taskId } : {}),
      code: d.code,
      parameters: {},
      messageKey: `planning.${d.code.toLowerCase()}`,
    });
  const prefs = next.preferences[0];
  next.preferences = [
    {
      ...(prefs ?? {
        id: "local",
        locale: "pt-BR",
        timeZone: proposal.options.timeZone,
      }),
      mode: proposal.mode,
      updatedAtUtc: nowUtc,
    },
  ];
  next.appMeta = [
    ...next.appMeta.filter((m) => m.key !== "r02.revision"),
    { key: "r02.revision", value: String(proposal.inputRevision + 1) },
  ];
  validateWorkspaceData(next);
  return next;
}

/** Revisão, nova verificação e gravação das onze coleções compartilham a mesma transação. */
export async function applyPlan(
  db: CampulsoDexieDB,
  proposal: PlanProposal,
): Promise<BackupData> {
  return db.transaction("rw", [...STORE_NAMES], async () => {
    const data = await db.snapshot();
    const next = applyPlanToData(data, proposal, {
      nowUtc: new Date().toISOString(),
    });
    await db.replaceSnapshot(next);
    return db.snapshot();
  });
}
