// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import Dexie from "dexie";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { R02App } from "../r02/App";
import { createDemo, DEMO_NOW } from "../r02/demo";
import { createBackup } from "../src/domain/backup";
import type { BackupData, Task } from "../src/domain/model";
import {
  openDatabase,
  type CampulsoDexieDB,
} from "../src/infrastructure/database";
import type { OfflineOptions } from "../src/infrastructure/offline";

// DOM component integration only. These tests do NOT emulate native rendering,
// modal focus/inertness, browser storage quotas, downloads, or a service worker.
// Dexie uses fake-indexeddb; digest validation and planning use their real code.
const harness = vi.hoisted(() => ({
  options: undefined as OfflineOptions | undefined,
  downloads: [] as { value: unknown; name: string }[],
}));
vi.mock("../src/infrastructure/offline", () => ({
  registerOffline: (options: OfflineOptions) => {
    harness.options = options;
  },
}));
vi.mock("../r02/view", async (importOriginal) => {
  const original = await importOriginal<typeof import("../r02/view")>();
  return {
    ...original,
    downloadJson: (value: unknown, name: string) =>
      harness.downloads.push({ value: structuredClone(value), name }),
  };
});

const opened: CampulsoDexieDB[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(DEMO_NOW));
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: webcrypto,
  });
  window.scrollTo = vi.fn();
  // jsdom has no native modal implementation. Only mark the dialog open so
  // accessible queries can interact with its fields and submit handlers.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  history.replaceState(null, "", "/r02/index.html?scenario=local#today");
  harness.options = undefined;
  harness.downloads.length = 0;
});
afterEach(async () => {
  cleanup();
  for (const db of opened.splice(0)) {
    const name = db.name;
    db.close();
    await Dexie.delete(name);
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function start(data = createDemo("planned")) {
  const db = await openDatabase(`campulso-ui-component-${crypto.randomUUID()}`);
  opened.push(db);
  await db.replaceSnapshot(data);
  render(<R02App initialData={await db.snapshot()} scenario="local" db={db} />);
  return db;
}
const main = () => within(screen.getByRole("main"));
async function navigate(
  route: string,
  user: ReturnType<typeof userEvent.setup>,
) {
  const nav = screen.getByRole("navigation", { name: "Navegação principal" });
  const support = screen.getByRole("navigation", { name: "Recursos de apoio" });
  const routes: Record<string, string> = {
    tasks: "Tarefas",
    subjects: "Disciplinas",
    today: "Meu dia",
    settings: "Ajustes",
    agenda: "Agenda",
    availability: "Disponibilidade",
    data: "Seus dados",
    help: "Ajuda",
  };
  const scope = ["availability", "data", "help"].includes(route)
    ? support
    : nav;
  await user.click(within(scope).getByRole("button", { name: routes[route] }));
}
async function save(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Salvar" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
}
function fileFromText(text: string, name = "backup.json") {
  const file = new File([text], name, { type: "application/json" });
  // File.text is not implemented in every jsdom version. This supplies the
  // chosen fixture bytes; the application's parser/digest verification is real.
  if (typeof file.text !== "function")
    Object.defineProperty(file, "text", { value: async () => text });
  return file;
}
function withoutRevision(data: BackupData) {
  const copy = structuredClone(data);
  copy.appMeta = copy.appMeta.filter((row) => row.key !== "r02.revision");
  return copy;
}

describe("Integração dos componentes React em DOM simulado (não é homologação de navegador)", () => {
  it("demonstração escapa texto JSX e edita somente a memória, sem abrir IndexedDB", async () => {
    const user = userEvent.setup(),
      data = createDemo("planned");
    const literal = '<img src=x onerror="window.__xss=1">';
    data.tasks[0].title = literal;
    const before = await indexedDB.databases();
    render(<R02App initialData={data} scenario="planned" />);
    expect(
      main().getAllByRole("button", { name: literal }).length,
    ).toBeGreaterThan(0);
    expect(document.querySelector("img[onerror]")).toBeNull();
    await navigate("subjects", user);
    await user.click(main().getByRole("button", { name: "Nova disciplina" }));
    await user.type(
      screen.getByLabelText("Nome da disciplina"),
      "Disciplina de demonstração",
    );
    await save(user);
    expect(
      main().getByRole("heading", { name: "Disciplina de demonstração" }),
    ).toBeTruthy();
    expect(await indexedDB.databases()).toEqual(before);
    expect(
      data.subjects.some(
        (subject) => subject.name === "Disciplina de demonstração",
      ),
    ).toBe(false);
  });

  it("editor grava tarefa e prazo inline sem perder progresso nem o vínculo na edição", async () => {
    const user = userEvent.setup(),
      db = await start(createDemo("empty"));
    await navigate("tasks", user);
    await user.click(main().getAllByRole("button", { name: "Nova tarefa" })[0]);
    await user.type(screen.getByLabelText("Título"), "Resumo acadêmico");
    await user.clear(screen.getByLabelText("Estimativa total (min)"));
    await user.type(screen.getByLabelText("Estimativa total (min)"), "60");
    await user.clear(screen.getByLabelText("Tempo restante (min)"));
    await user.type(screen.getByLabelText("Tempo restante (min)"), "25");
    await user.selectOptions(screen.getByLabelText("Importância"), "alta");
    await user.selectOptions(screen.getByLabelText("Prazo (opcional)"), "date");
    fireEvent.change(screen.getByLabelText("Data do prazo"), {
      target: { value: "2026-11-25" },
    });
    await save(user);
    const original = await db.snapshot();
    expect(original.tasks[0]).toMatchObject({
      title: "Resumo acadêmico",
      estimateMinutes: 60,
      remainingMinutes: 25,
      importance: "alta",
    });
    expect(original.deadlines[0]).toMatchObject({
      id: original.tasks[0].deadlineId,
      dueDate: "2026-11-25",
    });
    expect(original.deadlines[0].dueAtUtc).toBeUndefined();
    await user.click(
      main().getAllByRole("button", { name: "Resumo acadêmico" })[0],
    );
    await user.clear(screen.getByLabelText("Título"));
    await user.type(screen.getByLabelText("Título"), "Resumo revisado");
    await save(user);
    const revised = await db.snapshot();
    expect(revised.tasks[0]).toMatchObject({
      id: original.tasks[0].id,
      deadlineId: original.tasks[0].deadlineId,
      title: "Resumo revisado",
      remainingMinutes: 25,
    });
    expect(revised.deadlines).toEqual(original.deadlines);
  });

  it("descarta prévia sem escrita e aplica Modo leve sem alterar prazos, compromissos ou progresso", async () => {
    const user = userEvent.setup(),
      db = await start(),
      before = await db.snapshot();
    await user.click(main().getByRole("button", { name: "Rever meu plano" }));
    expect(await db.snapshot()).toEqual(before);
    await user.click(
      main().getByRole("button", { name: "Descartar proposta" }),
    );
    expect(await db.snapshot()).toEqual(before);
    await user.click(
      main().getByRole("button", { name: "Conhecer o Modo leve" }),
    );
    await user.click(
      main().getByRole("button", { name: "Ver proposta mais leve" }),
    );
    await user.click(main().getByRole("button", { name: "Aplicar Modo leve" }));
    await waitFor(async () =>
      expect((await db.snapshot()).preferences[0].mode).toBe("leve"),
    );
    const after = await db.snapshot();
    expect(after.tasks).toEqual(before.tasks);
    expect(after.deadlines).toEqual(before.deadlines);
    expect(after.commitments).toEqual(before.commitments);
    await user.click(main().getByRole("button", { name: "Rever meu plano" }));
    expect(
      main().getByRole("button", { name: "Aplicar Modo leve" }),
    ).toBeTruthy();
  });

  it("remove filtro de disciplina obsoleto depois de apagar dados e exibe nova tarefa sem disciplina", async () => {
    const user = userEvent.setup(),
      db = await start();
    await navigate("tasks", user);
    await user.selectOptions(screen.getByLabelText("Disciplina"), "s1");
    await navigate("data", user);
    await user.click(
      main().getByText("Apagar os dados deste espaço", { exact: true }),
    );
    await user.click(
      main().getByLabelText(
        "Entendo a remoção e quero apagar os dados deste espaço.",
      ),
    );
    await user.click(
      main().getByRole("button", { name: "Confirmar remoção dos dados" }),
    );
    await waitFor(async () =>
      expect((await db.snapshot()).subjects).toEqual([]),
    );
    await navigate("tasks", user);
    expect(
      (screen.getByLabelText("Disciplina") as HTMLSelectElement).value,
    ).toBe("");
    await user.click(main().getAllByRole("button", { name: "Nova tarefa" })[0]);
    await user.type(
      screen.getByLabelText("Título"),
      "Atividade sem disciplina",
    );
    await save(user);
    expect(
      main().getByRole("button", { name: "Atividade sem disciplina" }),
    ).toBeTruthy();
  });

  it("alteração não salva em Ajustes impede aceitar atualização; salvar libera o botão e preserva modo", async () => {
    const user = userEvent.setup(),
      data = createDemo("planned");
    data.preferences[0].mode = "leve";
    const db = await start(data),
      activate = vi.fn(async () => undefined);
    act(() => harness.options?.onUpdateReady(activate));
    await navigate("settings", user);
    const horizon = screen.getByLabelText("Planejar os próximos dias");
    await user.clear(horizon);
    await user.type(horizon, "12");
    const updateButton = main().getByRole("button", {
      name: "Atualizar aplicativo",
    }) as HTMLButtonElement;
    expect(updateButton.disabled).toBe(true);
    await user.click(updateButton);
    expect(activate).not.toHaveBeenCalled();
    await user.click(main().getByRole("button", { name: "Salvar ajustes" }));
    await waitFor(() =>
      expect(
        (
          main().getByRole("button", {
            name: "Atualizar aplicativo",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    expect((await db.snapshot()).preferences[0]).toMatchObject({
      planningHorizonDays: 12,
      mode: "leve",
    });
  });

  it("restauração exige prévia, cópia e confirmação; corrupção e cancelamento preservam o estado", async () => {
    const user = userEvent.setup(),
      db = await start(),
      before = await db.snapshot();
    const replacement = createDemo("empty");
    const backup = await createBackup(replacement, {
      exportedAtUtc: DEMO_NOW,
      appVersion: "teste-dom",
    });
    async function openRestore() {
      await navigate("data", user);
      await user.click(
        main().getByRole("button", { name: "Escolher arquivo para restaurar" }),
      );
    }
    await openRestore();
    await user.upload(
      screen.getByLabelText("Arquivo JSON do CAMPULSO"),
      fileFromText(JSON.stringify(backup)),
    );
    await screen.findByText("Arquivo validado", { exact: true });
    expect(await db.snapshot()).toEqual(before);
    expect(
      (
        main().getByRole("button", {
          name: "Confirmar restauração",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await user.click(main().getByRole("button", { name: "Cancelar" }));
    expect(await db.snapshot()).toEqual(before);
    const corrupt = structuredClone(backup);
    corrupt.data.preferences[0].locale = "en-US";
    await openRestore();
    await user.upload(
      screen.getByLabelText("Arquivo JSON do CAMPULSO"),
      fileFromText(JSON.stringify(corrupt), "corrupto.json"),
    );
    await waitFor(() =>
      expect(main().getByRole("alert").textContent).toContain("SHA-256"),
    );
    expect(await db.snapshot()).toEqual(before);
    await user.upload(
      screen.getByLabelText("Arquivo JSON do CAMPULSO"),
      fileFromText(JSON.stringify(backup), "valido.json"),
    );
    await screen.findByText("Arquivo validado", { exact: true });
    await user.click(
      main().getByRole("button", { name: "Baixar cópia antes de substituir" }),
    );
    await waitFor(() => expect(harness.downloads).toHaveLength(1));
    expect((harness.downloads[0].value as { data: BackupData }).data).toEqual(
      before,
    );
    const checkbox = main().getByLabelText(
      "Guardei minha cópia e confirmo a substituição de todos os dados deste espaço.",
    );
    await waitFor(() =>
      expect((checkbox as HTMLInputElement).disabled).toBe(false),
    );
    await user.click(checkbox);
    await user.click(
      main().getByRole("button", { name: "Confirmar restauração" }),
    );
    await waitFor(async () => expect((await db.snapshot()).tasks).toEqual([]));
    expect(withoutRevision(await db.snapshot())).toEqual(
      withoutRevision(replacement),
    );
  });

  it("exporta uma extensão local mas impede usar essa cópia para substituir dados", async () => {
    const user = userEvent.setup();
    const data = createDemo("empty");
    data.availabilityExceptions.push({ id: "antiga", localDate: "2026-11-23", type: "future-extension" });
    const db = await start(data);
    const before = await db.snapshot();
    const replacement = await createBackup(createDemo("empty"), { exportedAtUtc: DEMO_NOW, appVersion: "teste" });
    await navigate("data", user);
    await user.click(main().getByRole("button", { name: "Exportar JSON" }));
    await waitFor(() => expect(harness.downloads).toHaveLength(1));
    expect((harness.downloads[0].value as { data: BackupData }).data).toEqual(before);
    await user.click(main().getByRole("button", { name: "Escolher arquivo para restaurar" }));
    await user.upload(screen.getByLabelText("Arquivo JSON do CAMPULSO"), fileFromText(JSON.stringify(replacement)));
    await screen.findByText("Arquivo validado", { exact: true });
    await user.click(main().getByRole("button", { name: "Baixar cópia antes de substituir" }));
    await waitFor(() => expect(main().getByRole("alert").textContent).toMatch(/exceção|extensão/i));
    expect(harness.downloads).toHaveLength(1);
    expect((main().getByRole("button", { name: "Confirmar restauração" }) as HTMLButtonElement).disabled).toBe(true);
    expect(await db.snapshot()).toEqual(before);
  });

  it("falha induzida de armazenamento conserva rascunho do editor e snapshot anterior", async () => {
    const user = userEvent.setup(),
      db = await start(),
      before = await db.snapshot();
    await navigate("tasks", user);
    await user.click(
      main().getAllByRole("button", { name: "Finalizar resenha do artigo" })[0],
    );
    await user.clear(screen.getByLabelText("Título"));
    await user.type(
      screen.getByLabelText("Título"),
      "Rascunho que deve permanecer",
    );
    const event = db.tasks.hook("creating");
    const fail = (_key: unknown, row: Task) => {
      if (row.id === "t1")
        throw new DOMException(
          "Quota de teste esgotada.",
          "QuotaExceededError",
        );
    };
    event.subscribe(fail);
    try {
      await user.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: "Salvar",
        }),
      );
      await waitFor(() =>
        expect(
          within(screen.getByRole("dialog")).getByRole("alert").textContent,
        ).toContain("Quota de teste"),
      );
      expect((screen.getByLabelText("Título") as HTMLInputElement).value).toBe(
        "Rascunho que deve permanecer",
      );
      expect(await db.snapshot()).toEqual(before);
    } finally {
      event.unsubscribe(fail);
    }
  });

  it("tipo de exceção importado não é convertido silenciosamente pelo editor", async () => {
    const user = userEvent.setup(),
      data = createDemo("empty");
    data.availabilityExceptions.push({
      id: "unknown",
      localDate: "2026-11-23",
      type: "future-extension",
      startLocalTime: "14:00",
      endLocalTime: "15:00",
    });
    const db = await start(data),
      before = await db.snapshot();
    await navigate("availability", user);
    await user.click(main().getByRole("button", { name: /23 de novembro/ }));
    const select = screen.getByLabelText(
      "Disponibilidade nesta data",
    ) as HTMLSelectElement;
    expect(select.selectedOptions[0].textContent).toContain(
      "Manter tipo importado",
    );
    expect(
      (
        within(screen.getByRole("dialog")).getByRole("button", {
          name: "Salvar",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancelar",
      }),
    );
    expect(await db.snapshot()).toEqual(before);
  });

  it("editar indisponibilidade parcial mantém seus horários e não bloqueia o dia inteiro", async () => {
    const user = userEvent.setup(),
      data = createDemo("empty");
    data.availabilityExceptions.push({
      id: "partial",
      localDate: "2026-11-23",
      type: "unavailable",
      startLocalTime: "12:00",
      endLocalTime: "13:00",
    });
    const db = await start(data);
    await navigate("availability", user);
    await user.click(main().getByRole("button", { name: /23 de novembro/ }));
    expect(
      (screen.getByLabelText("Disponibilidade nesta data") as HTMLSelectElement)
        .value,
    ).toBe("unavailable-window");
    fireEvent.change(screen.getByLabelText("Data da exceção"), {
      target: { value: "2026-11-24" },
    });
    await save(user);
    expect((await db.snapshot()).availabilityExceptions[0]).toMatchObject({
      id: "partial",
      localDate: "2026-11-24",
      type: "unavailable",
      startLocalTime: "12:00",
      endLocalTime: "13:00",
    });
  });
});
