import { createBackupFile } from "../src/domain/backup";
import type { BackupData, CampulsoBackup, Task } from "../src/domain/model";
import { dateInZone } from "../src/domain/planner";

export type Page =
  | "today"
  | "agenda"
  | "tasks"
  | "subjects"
  | "availability"
  | "preview"
  | "light"
  | "settings"
  | "data"
  | "restore"
  | "help"
  | "privacy";
export const names: Record<Page, string> = {
  today: "Meu dia",
  agenda: "Agenda",
  tasks: "Tarefas",
  subjects: "Disciplinas",
  availability: "Disponibilidade",
  preview: "Prévia do planejamento",
  light: "Modo leve",
  settings: "Ajustes",
  data: "Dados e recuperação",
  restore: "Restaurar dados",
  help: "Ajuda",
  privacy: "Política de Privacidade",
};
export const weekdays = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
];
export type Scenario = "planned" | "empty" | "overloaded" | "local";
export function duration(n: number) {
  return n >= 60
    ? `${Math.floor(n / 60)}h${n % 60 ? ` ${n % 60}min` : ""}`
    : `${n}min`;
}
export function addDays(date: string, days: number) {
  const value = new Date(date + "T12:00:00Z");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function formatDate(date: string, long = false) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: long ? "long" : "2-digit",
    timeZone: "UTC",
  }).format(new Date(date + "T12:00:00Z"));
}
export function dateTitle(date: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(date + "T12:00:00Z"));
}
export function timeOf(instant: string, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(new Date(instant));
}
export function localInput(instant: string, timeZone: string) {
  return `${dateInZone(instant, timeZone)}T${timeOf(instant, timeZone)}`;
}
export function minutesBetween(start: string, end: string) {
  return Math.round((Date.parse(end) - Date.parse(start)) / 60000);
}
export function preferences(data: BackupData) {
  return (
    data.preferences[0] ?? {
      id: "local" as const,
      locale: "pt-BR",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      mode: "normal" as const,
      updatedAtUtc: "2026-11-22T00:00:00Z",
      planningHorizonDays: 7,
      lightModeRatio: 0.6,
    }
  );
}
export function subjectName(data: BackupData, id?: string) {
  const s = data.subjects.find((s) => s.id === id);
  return s
    ? `${s.name}${s.archivedAtUtc ? " (arquivada)" : ""}`
    : "Sem disciplina";
}
export function deadlineDate(data: BackupData, task: Task) {
  const d = data.deadlines.find((d) => d.id === task.deadlineId);
  return (
    d?.dueDate ||
    (d?.dueAtUtc
      ? dateInZone(d.dueAtUtc, preferences(data).timeZone)
      : task.dueDate) ||
    ""
  );
}
export function dueLabel(
  data: BackupData,
  task: Task,
  today: string,
  nowUtc = new Date().toISOString(),
) {
  const d = data.deadlines.find((d) => d.id === task.deadlineId),
    date = deadlineDate(data, task);
  if (!date) return "Sem prazo";
  const prefix =
    d?.dueAtUtc && Date.parse(d.dueAtUtc) < Date.parse(nowUtc)
      ? "Prazo vencido"
      : date === today
        ? "Hoje"
        : date < today
          ? "Prazo vencido"
          : date === addDays(today, 1)
            ? "Amanhã"
            : "Prazo";
  return `${prefix} · ${formatDate(date)}${d?.dueAtUtc ? " às " + timeOf(d.dueAtUtc, preferences(data).timeZone) + " (" + preferences(data).timeZone + ")" : ""}`;
}
export function downloadJson(backup: CampulsoBackup, name: string) {
  const url = URL.createObjectURL(createBackupFile(backup));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}
