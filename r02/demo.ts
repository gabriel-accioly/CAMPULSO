import { emptyBackupData } from "../src/domain/backup";
import type { BackupData } from "../src/domain/model";
import { instantForLocal } from "../src/domain/planner";
import { addDays, type Scenario } from "./view";

export const DEMO_DATE = "2026-11-23";
export const DEMO_NOW = "2026-11-23T11:00:00.000Z";
export function createDemo(scenario: Exclude<Scenario, "local">): BackupData {
  const d = emptyBackupData(),
    zone = "America/Sao_Paulo";
  d.preferences = [
    {
      id: "local",
      locale: "pt-BR",
      timeZone: zone,
      mode: "normal",
      updatedAtUtc: DEMO_NOW,
      planningHorizonDays: 7,
      lightModeRatio: 0.6,
    },
  ];
  if (scenario === "empty") return d;
  const courses = [
    "Metodologia Científica",
    "Projeto Integrador",
    "Comunicação e Sociedade",
    "Fundamentos de Pesquisa",
  ];
  d.subjects = courses.map((name, i) => ({
    id: `s${i + 1}`,
    name,
    createdAtUtc: DEMO_NOW,
    revision: 1,
  }));
  const titles = [
    "Finalizar resenha do artigo",
    "Revisar referências do projeto",
    "Preparar roteiro da apresentação",
    "Ler o capítulo indicado",
  ];
  const durations = [40, 25, 30, 35],
    days = [0, 1, 2, 4];
  d.deadlines = titles.map((title, i) => ({
    id: `d${i + 1}`,
    title,
    subjectId: `s${i + 1}`,
    dueDate: addDays(DEMO_DATE, scenario === "overloaded" ? 0 : days[i]),
    revision: 1,
  }));
  d.tasks = titles.map((title, i) => ({
    id: `t${i + 1}`,
    title,
    subjectId: `s${i + 1}`,
    deadlineId: `d${i + 1}`,
    estimateMinutes: durations[i],
    remainingMinutes: durations[i],
    importance: "media",
    status: "aberta",
    createdAtUtc: DEMO_NOW,
    updatedAtUtc: DEMO_NOW,
    revision: 1,
  }));
  d.commitments = [
    {
      id: "c1",
      title: "Aula de Metodologia Científica",
      subjectId: "s1",
      startAtUtc: instantForLocal(DEMO_DATE, "09:00", zone),
      endAtUtc: instantForLocal(DEMO_DATE, "10:30", zone),
      timeZone: zone,
      isFixed: true,
      revision: 1,
    },
    {
      id: "c2",
      title: "Encontro do grupo do projeto",
      subjectId: "s2",
      startAtUtc: instantForLocal(DEMO_DATE, "11:00", zone),
      endAtUtc: instantForLocal(DEMO_DATE, "12:00", zone),
      timeZone: zone,
      isFixed: true,
      revision: 1,
    },
  ];
  d.availabilityExceptions = [
    {
      id: "demo-window",
      localDate: DEMO_DATE,
      type: "r02-janela",
      startLocalTime: "14:00",
      endLocalTime: scenario === "overloaded" ? "14:30" : "16:00",
    },
  ];
  d.planRuns = [
    {
      id: "demo-run",
      createdAtUtc: DEMO_NOW,
      algorithmVersion: "r02-demo",
      inputRevision: 1,
      mode: "normal",
      status: "aplicado",
      summary: "Plano fictício da R02.",
      reasonCodes: [],
    },
  ];
  if (scenario === "planned")
    d.planBlocks = [
      ["t1", "14:00", "14:40"],
      ["t2", "14:40", "15:05"],
      ["t3", "15:05", "15:35"],
    ].map(([taskId, start, end], i) => ({
      id: `b${i}`,
      taskId,
      planRunId: "demo-run",
      startAtUtc: instantForLocal(DEMO_DATE, start, zone),
      endAtUtc: instantForLocal(DEMO_DATE, end, zone),
      source: "automatic",
      revision: 1,
    }));
  if (scenario === "overloaded")
    d.planBlocks = [
      {
        id: "b0",
        taskId: "t2",
        planRunId: "demo-run",
        startAtUtc: instantForLocal(DEMO_DATE, "14:00", zone),
        endAtUtc: instantForLocal(DEMO_DATE, "14:25", zone),
        source: "automatic",
        revision: 1,
      },
    ];
  return d;
}
