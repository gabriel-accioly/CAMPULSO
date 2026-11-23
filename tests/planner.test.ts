import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { emptyBackupData } from "../src/domain/backup.js";
import {
  applyPlan,
  applyPlanToData,
  buildPlan,
  dateInZone,
  instantForLocal,
  type PlannerOptions,
} from "../src/domain/planner.js";
import type { BackupData, PlanBlock, Task } from "../src/domain/model.js";
import {
  openDatabase,
  type CampulsoDexieDB,
} from "../src/infrastructure/database.js";

const ZONE = "America/Sao_Paulo";
const DATE = "2026-11-23";
const NOW = "2026-11-23T10:00:00.000Z";
const OPTIONS: PlannerOptions = { nowUtc: NOW, timeZone: ZONE, horizonDays: 1 };
const at = (time: string, date = DATE) => instantForLocal(date, time, ZONE);
const duration = (b: { startAtUtc: string; endAtUtc: string }) =>
  (Date.parse(b.endAtUtc) - Date.parse(b.startAtUtc)) / 60_000;
function task(id = "task-1", overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: `Tarefa ${id}`,
    estimateMinutes: 60,
    remainingMinutes: 60,
    importance: "media",
    status: "aberta",
    createdAtUtc: "2026-11-20T12:00:00.000Z",
    updatedAtUtc: NOW,
    revision: 1,
    ...overrides,
  };
}
function fixture(): BackupData {
  const data = emptyBackupData();
  data.appMeta.push({ key: "r02.revision", value: "1" });
  data.tasks.push(task());
  data.availabilityExceptions.push({
    id: "window",
    localDate: DATE,
    type: "r02-janela",
    startLocalTime: "08:00",
    endLocalTime: "10:00",
  });
  return data;
}
function preserveBlock(data: BackupData, input: Partial<PlanBlock> = {}): void {
  if (!data.planRuns.length)
    data.planRuns.push({
      id: "old-run",
      createdAtUtc: NOW,
      algorithmVersion: "manual",
      inputRevision: 1,
      mode: "normal",
      status: "aplicado",
      summary: "Horário manual",
      reasonCodes: [],
    });
  data.planBlocks.push({
    id: "manual",
    taskId: "task-1",
    planRunId: "old-run",
    startAtUtc: at("08:00"),
    endAtUtc: at("08:30"),
    source: "manual",
    revision: 1,
    ...input,
  });
}
const opened: CampulsoDexieDB[] = [];
afterEach(async () => {
  for (const db of opened.splice(0)) {
    const name = db.name;
    db.close();
    await Dexie.delete(name);
  }
});

describe("planner puro — DPA seção 7", () => {
  it("mantém os dados intactos, é determinístico e não inventa progresso", () => {
    const data = fixture();
    const before = structuredClone(data);
    const one = buildPlan(data, OPTIONS);
    expect(buildPlan(data, OPTIONS)).toEqual(one);
    expect(data).toEqual(before);
    expect(one.usedMinutes).toBe(60);
    expect(one.blocks.every((b) => duration(b) >= 15)).toBe(true);
    expect(one.unscheduled).toEqual([]);
    const applied = applyPlanToData(data, one);
    expect(applied.tasks).toEqual(before.tasks);
    expect(applied.deadlines).toEqual(before.deadlines);
    expect(data).toEqual(before);
  });

  it("não inventa disponibilidade e explica por que não alocou", () => {
    const data = fixture();
    data.availabilityExceptions = [];
    const plan = buildPlan(data, OPTIONS);
    expect(plan.blocks).toEqual([]);
    expect(plan.capacityMinutes).toBe(0);
    expect(plan.unscheduled).toEqual([
      expect.objectContaining({
        taskId: "task-1",
        remainingMinutes: 60,
        code: "NO_CAPACITY",
      }),
    ]);
  });

  it("subtrai fixos, une janelas sobrepostas e evita duplo cálculo de capacidade", () => {
    const data = fixture();
    data.tasks[0] = task("task-1", {
      estimateMinutes: 150,
      remainingMinutes: 150,
    });
    data.availabilityExceptions.push({
      id: "overlap",
      localDate: DATE,
      type: "r02-janela",
      startLocalTime: "09:00",
      endLocalTime: "11:00",
    });
    data.commitments.push({
      id: "class",
      title: "Aula",
      startAtUtc: at("08:30"),
      endAtUtc: at("09:00"),
      timeZone: ZONE,
      isFixed: true,
      revision: 1,
    });
    const plan = buildPlan(data, OPTIONS);
    expect(plan.capacityMinutes).toBe(150);
    expect(plan.usedMinutes).toBe(150);
    for (const b of plan.blocks)
      expect(b.endAtUtc <= at("08:30") || b.startAtUtc >= at("09:00")).toBe(
        true,
      );
    for (let n = 1; n < plan.blocks.length; n++)
      expect(plan.blocks[n].startAtUtc >= plan.blocks[n - 1].endAtUtc).toBe(
        true,
      );
  });

  it("respeita regra semanal, fuso próprio e exceção que substitui ou bloqueia o dia", () => {
    const data = fixture();
    data.availabilityExceptions = [];
    data.availabilityRules.push({
      id: "weekly",
      weekday: 1,
      startLocalTime: "08:00",
      endLocalTime: "12:00",
      timeZone: ZONE,
      enabled: true,
    });
    expect(buildPlan(data, OPTIONS).capacityMinutes).toBe(240);
    data.availabilityExceptions.push({
      id: "replace",
      localDate: DATE,
      type: "replacement",
      startLocalTime: "10:00",
      endLocalTime: "11:00",
    });
    expect(buildPlan(data, OPTIONS).capacityMinutes).toBe(60);
    data.availabilityExceptions.push({
      id: "off",
      localDate: DATE,
      type: "unavailable",
      startLocalTime: "10:15",
      endLocalTime: "10:45",
    });
    expect(buildPlan(data, OPTIONS).capacityMinutes).toBe(30);
    data.availabilityExceptions = [
      { id: "off", localDate: DATE, type: "unavailable" },
    ];
    expect(buildPlan(data, OPTIONS).capacityMinutes).toBe(0);
    data.availabilityExceptions = [];
    data.availabilityRules[0].timeZone = "UTC";
    const shifted = buildPlan(data, OPTIONS);
    expect(shifted.blocks[0].startAtUtc).toBe(NOW);
    expect(shifted.capacityMinutes).toBe(120);
  });

  it("não sugere o passado e limita o esforço restante de tarefa parcial", () => {
    const data = fixture();
    data.tasks[0].remainingMinutes = 20;
    const plan = buildPlan(data, {
      ...OPTIONS,
      nowUtc: at("08:47").replace(":00.000Z", ":20.000Z"),
    });
    expect(plan.blocks[0].startAtUtc).toBe(at("08:48"));
    expect(plan.usedMinutes).toBe(20);
    expect(data.tasks[0].remainingMinutes).toBe(20);
  });

  it("reduz só capacidade flexível no modo leve e respeita limite diário", () => {
    const data = fixture();
    data.tasks = [
      task("critical", {
        remainingMinutes: 40,
        estimateMinutes: 40,
        dueDate: DATE,
      }),
      task("optional", { remainingMinutes: 50, estimateMinutes: 50 }),
    ];
    data.commitments.push({
      id: "fixed",
      title: "Aula",
      startAtUtc: at("08:00"),
      endAtUtc: at("08:30"),
      timeZone: ZONE,
      isFixed: true,
      revision: 1,
    });
    const plan = buildPlan(data, { ...OPTIONS, mode: "leve" });
    expect(plan.capacityMinutes).toBe(90);
    expect(plan.budgetMinutes).toBe(54);
    expect(plan.usedMinutes).toBe(40);
    expect(plan.unscheduled[0].taskId).toBe("optional");
    const applied = applyPlanToData(data, plan);
    expect(applied.commitments).toEqual(data.commitments);
    expect(applied.tasks).toEqual(data.tasks);
    expect(applied.preferences[0].mode).toBe("leve");
    data.preferences = [
      {
        id: "local",
        locale: "pt-BR",
        timeZone: ZONE,
        mode: "normal",
        updatedAtUtc: NOW,
        dailyFlexibleLimitMinutes: 60,
        lightModeRatio: 0.5,
      },
    ];
    expect(buildPlan(data, { ...OPTIONS, mode: "leve" }).budgetMinutes).toBe(
      30,
    );
  });

  it("usa destaque e importância sem colocar opcionais antes de um prazo crítico", () => {
    const data = fixture();
    data.availabilityExceptions[0].endLocalTime = "09:00";
    data.tasks = [
      task("optional", { pinned: true, importance: "alta" }),
      task("critical", { dueDate: DATE, importance: "baixa" }),
    ];
    const plan = buildPlan(data, OPTIONS);
    expect(new Set(plan.blocks.map((b) => b.taskId))).toEqual(
      new Set(["critical"]),
    );
    expect(plan.reasonCodes).toContain("DUE_TODAY");
    data.tasks = [task("a"), task("b", { pinned: true })];
    expect(buildPlan(data, OPTIONS).blocks[0].taskId).toBe("b");
    data.tasks = [task("b"), task("a")];
    expect(buildPlan(data, OPTIONS).blocks[0].taskId).toBe("a");
  });

  it("mantém prazo data-only literal e não aloca o saldo no dia seguinte como se estivesse no prazo", () => {
    const data = fixture();
    data.tasks[0] = task("task-1", {
      dueDate: DATE,
      estimateMinutes: 180,
      remainingMinutes: 180,
    });
    data.availabilityExceptions.push({
      id: "next",
      localDate: "2026-11-24",
      type: "r02-janela",
      startLocalTime: "08:00",
      endLocalTime: "10:00",
    });
    const plan = buildPlan(data, { ...OPTIONS, horizonDays: 2 });
    expect(plan.usedMinutes).toBe(120);
    expect(plan.unscheduled[0]).toMatchObject({
      remainingMinutes: 60,
      code: "DEADLINE_CONFLICT",
    });
    expect(
      plan.blocks.every((b) => dateInZone(b.startAtUtc, ZONE) === DATE),
    ).toBe(true);
    expect(applyPlanToData(data, plan).tasks[0].dueDate).toBe(DATE);
  });

  it("respeita prazo com instante exato e detecta disputa cumulativa pelo mesmo tempo", () => {
    const data = fixture();
    data.deadlines.push({
      id: "due",
      title: "Entrega",
      dueAtUtc: at("08:30"),
      timeZone: ZONE,
      revision: 1,
    });
    data.tasks[0] = task("task-1", {
      estimateMinutes: 45,
      remainingMinutes: 45,
      deadlineId: "due",
    });
    let plan = buildPlan(data, OPTIONS);
    expect(plan.usedMinutes).toBe(30);
    expect(plan.blocks.every((b) => b.endAtUtc <= at("08:30"))).toBe(true);
    data.deadlines = [];
    data.availabilityExceptions[0].endLocalTime = "09:00";
    data.tasks = [
      task("a", { estimateMinutes: 45, remainingMinutes: 45, dueDate: DATE }),
      task("b", { estimateMinutes: 45, remainingMinutes: 45, dueDate: DATE }),
    ];
    plan = buildPlan(data, OPTIONS);
    expect(plan.reasonCodes).toContain("DEADLINE_CONFLICT");
    expect(plan.usedMinutes).toBe(60);
    expect(plan.unscheduled).toEqual([
      expect.objectContaining({ taskId: "b", remainingMinutes: 30 }),
    ]);
  });

  it("identifica recuperação de pendência vencida sem alterar prazo ou concluir tarefa", () => {
    const data = fixture();
    data.tasks[0].dueDate = "2026-11-22";
    const plan = buildPlan(data, OPTIONS);
    expect(plan.usedMinutes).toBe(60);
    expect(plan.reasonCodes).toContain("OVERDUE");
    const applied = applyPlanToData(data, plan);
    expect(applied.tasks[0]).toEqual(data.tasks[0]);
  });

  it("preserva manuais e blocos fora do horizonte, descontando esforço já reservado", () => {
    const data = fixture();
    preserveBlock(data);
    data.tasks.push(task("next"));
    preserveBlock(data, {
      id: "outside",
      taskId: "next",
      source: "automatic",
      startAtUtc: at("08:00", "2026-11-25"),
      endAtUtc: at("09:00", "2026-11-25"),
    });
    preserveBlock(data, {
      id: "old-auto",
      taskId: "task-1",
      source: "automatic",
      startAtUtc: at("09:00"),
      endAtUtc: at("09:30"),
    });
    const plan = buildPlan(data, OPTIONS);
    expect(plan.usedMinutes).toBe(30);
    expect(plan.blocks[0].startAtUtc).toBe(at("08:30"));
    const applied = applyPlanToData(data, plan);
    expect(applied.planBlocks.find((b) => b.id === "manual")).toEqual(
      data.planBlocks[0],
    );
    expect(applied.planBlocks.find((b) => b.id === "outside")).toEqual(
      data.planBlocks[1],
    );
    expect(applied.planBlocks.some((b) => b.id === "old-auto")).toBe(false);
    expect(
      applied.planBlocks
        .filter((b) => b.taskId === "task-1")
        .reduce((sum, b) => sum + duration(b), 0),
    ).toBe(60);
  });

  it("não remove manual em conflito e comunica a necessidade de revisão", () => {
    const data = fixture();
    preserveBlock(data);
    data.commitments.push({
      id: "fixed",
      title: "Aula",
      startAtUtc: at("08:00"),
      endAtUtc: at("08:15"),
      timeZone: ZONE,
      isFixed: true,
      revision: 1,
    });
    const plan = buildPlan(data, OPTIONS);
    expect(plan.reasonCodes).toContain("MANUAL_CONFLICT");
    expect(plan.warnings.length).toBeGreaterThan(0);
    expect(
      applyPlanToData(data, plan).planBlocks.find((b) => b.id === "manual"),
    ).toEqual(data.planBlocks[0]);
  });

  it("preserva o histórico manual de tarefa concluída sem reservar capacidade nem criar conflito", () => {
    const data = fixture();
    preserveBlock(data);
    data.tasks[0] = task("task-1", {
      status: "concluida",
      remainingMinutes: 0,
      completedAtUtc: NOW,
    });
    data.tasks.push(
      task("open", { estimateMinutes: 120, remainingMinutes: 120 }),
    );
    data.preferences = [
      {
        id: "local",
        locale: "pt-BR",
        timeZone: ZONE,
        mode: "normal",
        updatedAtUtc: NOW,
        dailyFlexibleLimitMinutes: 120,
      },
    ];
    const plan = buildPlan(data, OPTIONS);
    expect(plan.capacityMinutes).toBe(120);
    expect(plan.budgetMinutes).toBe(120);
    expect(plan.usedMinutes).toBe(120);
    expect(plan.blocks[0].startAtUtc).toBe(at("08:00"));
    expect(plan.reasonCodes).not.toContain("MANUAL_BLOCK_LOCKED");
    expect(plan.warnings).toEqual([]);
    expect(
      applyPlanToData(data, plan).planBlocks.find((b) => b.id === "manual"),
    ).toEqual(data.planBlocks[0]);
    data.commitments.push({
      id: "fixed",
      title: "Aula",
      startAtUtc: at("08:00"),
      endAtUtc: at("08:30"),
      timeZone: ZONE,
      isFixed: true,
      revision: 1,
    });
    const withFixed = buildPlan(data, OPTIONS);
    expect(withFixed.capacityMinutes).toBe(90);
    expect(withFixed.reasonCodes).not.toContain("MANUAL_CONFLICT");
  });

  it("divide 40 minutos em 25 + 15 para não deixar saldo evitável abaixo do mínimo", () => {
    const data = fixture();
    data.tasks[0] = task("task-1", {
      estimateMinutes: 40,
      remainingMinutes: 40,
    });
    data.availabilityExceptions = [
      {
        id: "first",
        localDate: DATE,
        type: "r02-janela",
        startLocalTime: "14:00",
        endLocalTime: "14:30",
      },
      {
        id: "second",
        localDate: DATE,
        type: "r02-janela",
        startLocalTime: "15:00",
        endLocalTime: "15:30",
      },
    ];
    const plan = buildPlan(data, OPTIONS);
    expect(plan.usedMinutes).toBe(40);
    expect(plan.unscheduled).toEqual([]);
    expect(plan.blocks.map(duration)).toEqual([25, 15]);
    expect(plan.blocks.map((b) => b.startAtUtc)).toEqual([
      at("14:00"),
      at("15:00"),
    ]);
    data.availabilityExceptions.pop();
    const limited = buildPlan(data, OPTIONS);
    expect(limited.usedMinutes).toBe(25);
    expect(limited.unscheduled).toEqual([
      expect.objectContaining({ remainingMinutes: 15, code: "NO_CAPACITY" }),
    ]);
  });

  it("não afirma conflito com prazo posterior ao horizonte que efetivamente examinou", () => {
    const data = fixture();
    data.tasks[0] = task("task-1", {
      estimateMinutes: 180,
      remainingMinutes: 180,
      dueDate: "2026-11-30",
    });
    const plan = buildPlan(data, { ...OPTIONS, horizonDays: 7 });
    expect(plan.endDateExclusive).toBe("2026-11-30");
    expect(plan.usedMinutes).toBe(120);
    expect(plan.reasonCodes).not.toContain("DEADLINE_CONFLICT");
    expect(plan.unscheduled).toEqual([
      expect.objectContaining({
        remainingMinutes: 60,
        code: "NO_CAPACITY",
        reason: expect.stringContaining("neste período de planejamento"),
      }),
    ]);
    expect(plan.decisions.some((d) => d.code === "DEADLINE_CONFLICT")).toBe(
      false,
    );
  });

  it("rejeita revisão obsoleta, proposta adulterada e prévia cujo horário passou", () => {
    const data = fixture();
    const plan = buildPlan(data, OPTIONS);
    const stale = structuredClone(data);
    stale.appMeta[0].value = "2";
    expect(() => applyPlanToData(stale, plan)).toThrow(/dados mudaram/i);
    const tampered = structuredClone(plan);
    tampered.blocks[0].endAtUtc = at("23:00");
    expect(() => applyPlanToData(data, tampered)).toThrow(
      /proposta foi alterada/i,
    );
    expect(() => applyPlanToData(data, plan, { nowUtc: at("08:01") })).toThrow(
      /horário da prévia já passou/i,
    );
    expect(() => applyPlanToData(applyPlanToData(data, plan), plan)).toThrow(
      /dados mudaram/i,
    );
  });

  it("rejeita horários locais ambíguos/inexistentes e conserva datas na troca de fuso", () => {
    expect(instantForLocal("2026-03-08", "03:30", "America/New_York")).toBe(
      "2026-03-08T07:30:00.000Z",
    );
    expect(() =>
      instantForLocal("2026-03-08", "02:30", "America/New_York"),
    ).toThrow(/não existe/);
    expect(() =>
      instantForLocal("2026-11-01", "01:30", "America/New_York"),
    ).toThrow(/ambíguo/);
    expect(dateInZone("2026-11-23T01:00:00.000Z", ZONE)).toBe("2026-11-22");
    expect(() => instantForLocal("2026-02-30", "12:00", ZONE)).toThrow(
      /inválido/,
    );
  });

  it("lida com compromisso atravessando meia-noite e janelas em fuso diferente", () => {
    const data = fixture();
    data.availabilityExceptions[0].startLocalTime = "00:00";
    data.availabilityExceptions[0].endLocalTime = "02:00";
    data.commitments.push({
      id: "night",
      title: "Estágio",
      startAtUtc: at("23:00", "2026-11-22"),
      endAtUtc: at("01:00"),
      timeZone: ZONE,
      isFixed: true,
      revision: 1,
    });
    const plan = buildPlan(data, { ...OPTIONS, nowUtc: at("00:00") });
    expect(plan.capacityMinutes).toBe(60);
    expect(plan.blocks[0].startAtUtc).toBe(at("01:00"));
  });
});

describe("aplicar plano — transação Dexie", () => {
  function futureFixture(): { data: BackupData; options: PlannerOptions } {
    const data = fixture();
    const date = "2099-11-23";
    data.availabilityExceptions[0].localDate = date;
    return {
      data,
      options: {
        nowUtc: new Date().toISOString(),
        timeZone: ZONE,
        startDate: date,
        horizonDays: 1,
      },
    };
  }
  it("grava run/blocos/decisões na mesma transação e bloqueia uma segunda aplicação obsoleta", async () => {
    const db = await openDatabase(`campulso-planner-${crypto.randomUUID()}`);
    opened.push(db);
    const { data, options } = futureFixture();
    await db.replaceSnapshot(data);
    const proposal = buildPlan(data, options);
    const applied = await applyPlan(db, proposal);
    expect(await db.snapshot()).toEqual(applied);
    expect(applied.planRuns).toHaveLength(1);
    expect(applied.planBlocks.length).toBeGreaterThan(0);
    expect(applied.planDecisions.length).toBeGreaterThan(0);
    await expect(applyPlan(db, proposal)).rejects.toThrow(/dados mudaram/i);
    expect(await db.snapshot()).toEqual(applied);
  });
  it("reverte também run, decisões e revisão se uma gravação falhar", async () => {
    const db = await openDatabase(`campulso-planner-${crypto.randomUUID()}`);
    opened.push(db);
    const { data, options } = futureFixture();
    await db.replaceSnapshot(data);
    const before = await db.snapshot();
    const creating = db.planBlocks.hook("creating");
    const fail = () => {
      throw new Error("Falha induzida no plano.");
    };
    creating.subscribe(fail);
    try {
      await expect(applyPlan(db, buildPlan(data, options))).rejects.toThrow(
        /falha induzida/i,
      );
    } finally {
      creating.unsubscribe(fail);
    }
    expect(await db.snapshot()).toEqual(before);
  });
});
