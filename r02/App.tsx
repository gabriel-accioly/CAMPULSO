import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type {
  BackupData,
  CampulsoBackup,
  PlanningMode,
  Task,
} from "../src/domain/model";
import { createBackup, validateBackupData } from "../src/domain/backup";
import {
  APP_VERSION,
  executeCommand,
  loadWorkspace,
  parseBackupText,
  reduceCommand,
  restoreWorkspace,
  revisionOf,
  type Command,
} from "../src/application/workspace";
import {
  applyPlan,
  applyPlanToData,
  buildPlan,
  dateInZone,
  type PlanProposal,
} from "../src/domain/planner";
import type { CampulsoDexieDB } from "../src/infrastructure/database";
import { registerOffline } from "../src/infrastructure/offline";
import {
  Button,
  DayCard,
  Empty,
  Head,
  Icon,
  TaskRows,
  Timeline,
} from "./components";
import { Editor, type EditorSpec } from "./Editor";
import { DEMO_NOW } from "./demo";
import { Privacy } from "./Privacy";
import {
  addDays,
  dateTitle,
  deadlineDate,
  downloadJson,
  dueLabel,
  duration,
  formatDate,
  localInput,
  minutesBetween,
  names,
  preferences,
  subjectName,
  timeOf,
  weekdays,
  type Page,
  type Scenario,
} from "./view";
import logo from "./assets/Logo_compacto_sem_slogan.svg";
import "./functional.css";

interface Props {
  initialData: BackupData;
  scenario: Scenario;
  db?: CampulsoDexieDB;
}
interface RestorePreview {
  backup: CampulsoBackup;
  filename: string;
  revision: number;
}
const pageFromHash = (): Page => {
  const name = location.hash.slice(1);
  return Object.hasOwn(names, name) ? (name as Page) : "today";
};
const message = (e: unknown) =>
  e instanceof Error && /QuotaExceeded|quota/i.test(e.name + " " + e.message)
    ? "O navegador ficou sem espaço para salvar. Sua edição continua aberta. Libere espaço e exporte uma cópia dos dados antes de tentar novamente."
    : e instanceof Error
      ? e.message
      : "Não foi possível concluir. Seus dados anteriores foram preservados.";

export function R02App({ initialData, scenario, db }: Props) {
  const [data, setData] = useState(initialData),
    [page, setPage] = useState<Page>(pageFromHash),
    [editor, setEditor] = useState<EditorSpec>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [toast, setToast] = useState(""),
    [undo, setUndo] = useState<Task>(),
    [more, setMore] = useState(false),
    [proposal, setProposal] = useState<PlanProposal>(),
    [restore, setRestore] = useState<RestorePreview>(),
    [restoreConfirmed, setRestoreConfirmed] = useState(false),
    [recoveryOffered, setRecoveryOffered] = useState(false),
    [clearConfirmed, setClearConfirmed] = useState(false);
  const [clock, setClock] = useState(() => new Date().toISOString()),
    [offline, setOffline] = useState(!navigator.onLine),
    [offlineReady, setOfflineReady] = useState(false),
    [update, setUpdate] = useState<() => Promise<void>>(),
    [storageMessage, setStorageMessage] = useState("");
  const [agendaDate, setAgendaDate] = useState(() =>
      dateInZone(
        scenario === "local" ? new Date().toISOString() : DEMO_NOW,
        preferences(initialData).timeZone,
      ),
    ),
    [agendaView, setAgendaView] = useState<"day" | "week">("day"),
    [taskFilter, setTaskFilter] = useState("open"),
    [courseFilter, setCourseFilter] = useState(""),
    [showArchived, setShowArchived] = useState(false);
  const busyRef = useRef(false),
    dataRef = useRef(data),
    toastTimer = useRef<number | undefined>(undefined),
    agendaDayButton = useRef<HTMLButtonElement>(null),
    moreRef = useRef<HTMLDivElement>(null),
    moreButton = useRef<HTMLButtonElement>(null);
  const prefs = preferences(data),
    zone = prefs.timeZone,
    now = scenario === "local" ? clock : DEMO_NOW,
    today = dateInZone(now, zone),
    local = scenario === "local";
  dataRef.current = data;
  useEffect(() => {
    const timer = window.setInterval(
      () => setClock(new Date().toISOString()),
      30000,
    );
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const hash = () => setPage(pageFromHash());
    window.addEventListener("hashchange", hash);
    return () => window.removeEventListener("hashchange", hash);
  }, []);
  useEffect(() => {
    if (courseFilter && !data.subjects.some((s) => s.id === courseFilter))
      setCourseFilter("");
  }, [data.subjects, courseFilter]);
  useEffect(() => {
    if (!settingsDirty && !editor) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [settingsDirty, editor]);
  useEffect(() => {
    document.title = `CAMPULSO · ${names[page]}`;
  }, [page]);
  useEffect(() => {
    const change = () => setOffline(!navigator.onLine);
    addEventListener("online", change);
    addEventListener("offline", change);
    return () => {
      removeEventListener("online", change);
      removeEventListener("offline", change);
    };
  }, []);
  useEffect(() => {
    registerOffline({
      onUpdateReady: (activate) => setUpdate(() => activate),
      onOfflineReady: () => setOfflineReady(true),
      onError: (text) => setStorageMessage(text),
    });
  }, []);
  useEffect(() => {
    if (!more) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMore(false);
        moreButton.current?.focus();
      }
    };
    const outside = (e: PointerEvent) => {
      if (
        !moreRef.current?.contains(e.target as Node) &&
        !moreButton.current?.contains(e.target as Node)
      )
        setMore(false);
    };
    addEventListener("keydown", onKey);
    addEventListener("pointerdown", outside);
    return () => {
      removeEventListener("keydown", onKey);
      removeEventListener("pointerdown", outside);
    };
  }, [more]);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);
  function notify(text: string, previous?: Task) {
    setToast(text);
    setUndo(previous);
    window.clearTimeout(toastTimer.current);
    if (previous) return;
    toastTimer.current = window.setTimeout(() => {
      setToast("");
      setUndo(undefined);
    }, 9000);
  }
  function go(next: Page, rememberPage = false) {
    if (settingsDirty && next !== page) {
      if (
        !window.confirm(
          "Sair de Ajustes descarta as alterações ainda não salvas. Continuar?",
        )
      )
        return;
      setSettingsDirty(false);
    }
    setPage(next);
    setMore(false);
    if (rememberPage && next !== page) history.pushState(null, "", "#" + next);
    else history.replaceState(null, "", "#" + next);
    requestAnimationFrame(() =>
      document.getElementById(next + "-title")?.focus({ preventScroll: true }),
    );
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function open(spec: EditorSpec) {
    setError("");
    setEditor(spec);
  }
  async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (busyRef.current) throw Error("Aguarde a gravação atual.");
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      return await fn();
    } catch (e) {
      setError(message(e));
      throw e;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function command(cmd: Command) {
    await exclusive(async () => {
      const current = dataRef.current;
      const next = db
        ? await executeCommand(db, revisionOf(current), cmd)
        : reduceCommand(current, cmd, { nowUtc: now });
      setData(next);
      notify(
        local
          ? "Alteração salva neste navegador."
          : "Alteração aplicada à demonstração.",
      );
    });
  }
  function fire(cmd: Command) {
    void command(cmd).catch(() => {});
  }
  async function toggle(t: Task) {
    try {
      await command({
        type: "set-task-status",
        id: t.id,
        status: t.status === "concluida" ? "aberta" : "concluida",
      });
      notify(
        t.status === "concluida"
          ? "Tarefa reaberta."
          : "Tarefa concluída por você.",
        t,
      );
    } catch {
      /* A mensagem já está visível; o estado anterior é mantido. */
    }
  }
  async function recalculate() {
    if (!proposal) return;
    try {
      await exclusive(async () => {
        const current = db ? await loadWorkspace(db) : dataRef.current;
        const currentPrefs = preferences(current);
        const next = buildPlan(current, {
          nowUtc: local ? new Date().toISOString() : DEMO_NOW,
          timeZone: currentPrefs.timeZone,
          horizonDays: currentPrefs.planningHorizonDays ?? 7,
          mode: proposal.mode,
        });
        setData(current);
        setProposal(next);
        notify("Proposta recalculada. Confira novamente antes de aplicar.");
      });
    } catch {
      /* Nenhuma proposta é aplicada automaticamente. */
    }
  }
  function preview(mode: PlanningMode) {
    try {
      const p = buildPlan(data, {
        nowUtc: local ? new Date().toISOString() : DEMO_NOW,
        timeZone: zone,
        horizonDays: prefs.planningHorizonDays ?? 7,
        mode,
      });
      setProposal(p);
      setError("");
      go("preview");
    } catch (e) {
      setError(message(e));
    }
  }
  async function apply() {
    if (!proposal) return;
    try {
      await exclusive(async () => {
        const next = db
          ? await applyPlan(db, proposal)
          : applyPlanToData(dataRef.current, proposal, { nowUtc: DEMO_NOW });
        setData(next);
        setProposal(undefined);
        go("today");
        notify("Plano aplicado. Compromissos e prazos preservados.");
      });
    } catch {
      /* A proposta fica disponível para revisão. */
    }
  }
  async function offerBackup(recovery = false) {
    try {
      await exclusive(async () => {
        if (recovery) {
          setRecoveryOffered(false);
          setRestoreConfirmed(false);
        }
        const current = db ? await loadWorkspace(db) : dataRef.current;
        if (recovery && restore && revisionOf(current) !== restore.revision)
          throw Error(
            "Outra aba alterou os dados. Confira novamente o arquivo antes de continuar.",
          );
        if (recovery) {
          try {
            validateBackupData(current);
          } catch (cause) {
            throw new Error(
              "A cópia do espaço atual não pode ser restaurada por esta versão. Exporte o JSON em Seus dados para guardar o original e revise as extensões ou os registros locais antes de substituir os dados. " + message(cause),
            );
          }
        }
        const backup = await createBackup(current, {
          exportedAtUtc: new Date().toISOString(),
          appVersion: APP_VERSION,
        });
        downloadJson(
          backup,
          `CAMPULSO-${recovery ? "antes-da-restauracao" : "backup"}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
        );
        if (recovery) setRecoveryOffered(true);
        notify("Arquivo oferecido para download. Confira onde ele foi salvo.");
      });
    } catch {
      /* Falha anunciada sem declarar exportação. */
    }
  }
  async function readBackup(file?: File) {
    if (!file) return;
    setRestore(undefined);
    setRecoveryOffered(false);
    setRestoreConfirmed(false);
    try {
      await exclusive(async () => {
        if (file.size > 20 * 1024 * 1024)
          throw Error("O limite inicial é 20 MiB por arquivo.");
        const backup = await parseBackupText(await file.text());
        setRestore({
          backup,
          filename: file.name,
          revision: revisionOf(dataRef.current),
        });
      });
    } catch {
      /* Nenhuma gravação ocorreu. */
    }
  }
  async function doRestore() {
    if (!restore || !restoreConfirmed || !recoveryOffered) return;
    try {
      await exclusive(async () => {
        const next = db
          ? await restoreWorkspace(db, restore.revision, restore.backup)
          : (() => {
              const imported = structuredClone(restore.backup.data);
              const key = "r02.revision",
                rev =
                  Math.max(revisionOf(imported), revisionOf(dataRef.current)) +
                  1;
              imported.appMeta = imported.appMeta
                .filter((x) => x.key !== key)
                .concat({ key, value: String(rev) });
              return imported;
            })();
        setData(next);
        setProposal(undefined);
        setRestore(undefined);
        setRestoreConfirmed(false);
        setRecoveryOffered(false);
        go("data");
        notify("Dados restaurados. As 11 coleções foram substituídas juntas.");
      });
    } catch {
      /* O snapshot anterior permanece no banco em falha. */
    }
  }
  const dayPlan = useMemo(() => {
    try {
      return buildPlan(data, {
        nowUtc: now,
        timeZone: zone,
        horizonDays: 1,
        mode: "normal",
      });
    } catch {
      return undefined;
    }
  }, [data, now, zone]);
  const capacity = dayPlan?.capacityMinutes ?? 0,
    openTasks = data.tasks.filter((t) => t.status !== "concluida"),
    critical = openTasks.filter(
      (t) => deadlineDate(data, t) && deadlineDate(data, t) <= today,
    ),
    planned = data.planBlocks
      .filter(
        (b) =>
          b.source === "automatic" &&
          Date.parse(b.startAtUtc) >=
            Math.ceil(Date.parse(now) / 60000) * 60000 &&
          dateInZone(b.startAtUtc, zone) === today &&
          data.tasks.some((t) => t.id === b.taskId && t.status !== "concluida"),
      )
      .reduce((sum, b) => sum + minutesBetween(b.startAtUtc, b.endAtUtc), 0);
  const tasks = (items: Task[]) => (
    <TaskRows
      key={page === "tasks" ? JSON.stringify([page, taskFilter, courseFilter]) : page}
      data={data}
      tasks={items}
      today={today}
      busy={busy}
      now={now}
      edit={(id) => open({ kind: "task", id })}
      toggle={(t) => void toggle(t)}
    />
  );
  const timeline = (date: string) => (
    <Timeline
      data={data}
      date={date}
      editTask={(id) => open({ kind: "task", id })}
      editCommitment={(id, date) => open({ kind: "commitment", id, date })}
    />
  );
  const nav = (target: Page, label: ReactNode, kind = "small") => (
    <Button kind={kind} onClick={() => go(target)} data-page={target}>
      {label}
    </Button>
  );
  const titleActions = (
    <>
      <Button
        kind="primary"
        onClick={() => open({ kind: "task" })}
        data-action="new-task"
      >
        <Icon name="plus" />
        Nova tarefa
      </Button>
      <Button onClick={() => preview(prefs.mode)} data-action="preview-normal">
        Rever meu plano <Icon name="arrow" />
      </Button>
    </>
  );

  const privacyLink = (
    <a href="#privacy" onClick={(event) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      go("privacy", true);
    }}>Política de Privacidade</a>
  );

  function renderToday() {
    const urgent = openTasks
        .filter((t) => deadlineDate(data, t))
        .sort((a, b) =>
          deadlineDate(data, a).localeCompare(deadlineDate(data, b)),
        )
        .slice(0, 3),
      criticalMinutes = critical.reduce(
        (sum, t) => sum + t.remainingMinutes,
        0,
      );
    return (
      <>
        <Head
          page="today"
          subtitle="O que importa agora, com espaço para ajustar."
          eyebrow={dateTitle(today)}
          actions={titleActions}
        />
        {local && <p className="note-box privacy-notice">
          Seu planejamento fica neste navegador. Quem tiver acesso ao backup JSON poderá ler seu conteúdo.
          {" "}{privacyLink}
        </p>}
        <div className="day-summary">
          <div className="summary-item">
            <span>Compromissos hoje</span>
            <strong>
              {
                data.commitments.filter(
                  (c) =>
                    dateInZone(c.startAtUtc, zone) <= today &&
                    dateInZone(
                      new Date(Date.parse(c.endAtUtc) - 1).toISOString(),
                      zone,
                    ) >= today,
                ).length
              }
            </strong>
            <small>Horários que você definiu</small>
          </div>
          <div className="summary-item">
            <span>Tarefas abertas</span>
            <strong id="task-count">{openTasks.length}</strong>
            <small>
              {critical.length
                ? `${critical.length} com prazo até hoje`
                : "Prazos sempre visíveis"}
            </small>
          </div>
          <div className="summary-item">
            <span>Disponibilidade informada</span>
            <strong>{capacity ? duration(capacity) : "Não definida"}</strong>
            <small>
              {capacity
                ? "Para tarefas flexíveis"
                : "Você escolhe seus horários"}
            </small>
          </div>
        </div>
        {criticalMinutes > capacity && critical.length > 0 && (
          <section
            className="overload-notice"
            aria-label="Conflito de capacidade"
          >
            <strong>
              Há mais tarefas com prazo próximo do que espaço hoje.
            </strong>
            <p>
              {duration(criticalMinutes)} de tarefas com prazo até hoje para{" "}
              {duration(capacity)} disponíveis. Os prazos foram mantidos. Você
              pode rever a disponibilidade ou manter tarefas sem horário.
            </p>
            {nav("availability", "Rever disponibilidade")}
            <Button kind="small" onClick={() => preview(prefs.mode)}>
              Revisar proposta
            </Button>
          </section>
        )}
        <div className="grid-main">
          <div className="stack">
            <section className="card">
              <div className="card-title">
                <div>
                  <div className="section-kicker">Agenda de hoje</div>
                  <h2>Seu dia em sequência</h2>
                </div>
                {nav(
                  "agenda",
                  <>
                    Ver agenda <Icon name="arrow" />
                  </>,
                )}
              </div>
              {timeline(today)}
            </section>
            <section className="card">
              <div className="card-title">
                <div>
                  <div className="section-kicker">Uma coisa de cada vez</div>
                  <h2>Tarefas e prazos</h2>
                </div>
                {nav("tasks", "Ver todas")}
              </div>
              {tasks(openTasks)}
            </section>
          </div>
          <aside className="stack" aria-label="Seu planejamento">
            <section className="card">
              <div className="card-title">
                <h2>Espaço no seu dia</h2>
                <Icon name="clock" />
              </div>
              {capacity ? (
                <>
                  <div className="capacity-value">
                    <strong>{duration(Math.max(0, capacity - planned))}</strong>
                    <span>ainda livres na janela informada</span>
                  </div>
                  <div className="capacity-bar" aria-hidden="true">
                    <span
                      style={{
                        width: Math.min(100, (planned / capacity) * 100) + "%",
                      }}
                    />
                  </div>
                  <div className="capacity-caption">
                    <span>{duration(planned)} em blocos</span>
                    <span>{duration(capacity)} disponíveis</span>
                  </div>
                </>
              ) : (
                <p className="subhead">
                  Não há tempo livre futuro informado para hoje. Nenhum horário
                  será presumido.
                </p>
              )}
              <div className="card-footer">
                {nav(
                  "availability",
                  capacity
                    ? "Ajustar disponibilidade"
                    : "Definir disponibilidade",
                )}
              </div>
            </section>
            <section className="card focus-card">
              <div className="mode-icon">
                <Icon name="moon" />
              </div>
              <div className="section-kicker">Seu ritmo importa</div>
              <h2>
                {prefs.mode === "leve"
                  ? "Modo leve aplicado"
                  : "Precisa de mais espaço?"}
              </h2>
              <p>
                O Modo leve reduz os blocos flexíveis. Compromissos e prazos
                continuam visíveis.
              </p>
              {nav(
                "light",
                prefs.mode === "leve"
                  ? "Rever o Modo leve"
                  : "Conhecer o Modo leve",
              )}
            </section>
            <section className="card">
              <div className="card-title">
                <h2>Próximos prazos</h2>
              </div>
              {urgent.length ? (
                <ul className="compact-list">
                  {urgent.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        className="task-title-button"
                        onClick={() => open({ kind: "task", id: t.id })}
                      >
                        {t.title}
                      </button>
                      <small>{dueLabel(data, t, today, now)}</small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="subhead">
                  Quando você informar um prazo, ele aparecerá aqui.
                </p>
              )}
              <p className="micro-note">
                Replanejar muda o horário de estudo, nunca a data de entrega.
              </p>
            </section>
          </aside>
        </div>
      </>
    );
  }
  function renderAgenda() {
    const start = addDays(
      agendaDate,
      -((new Date(agendaDate + "T12:00:00Z").getUTCDay() + 6) % 7),
    );
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    return (
      <>
        <Head
          page="agenda"
          subtitle="Compromissos fixos e blocos flexíveis, em uma sequência clara."
          actions={
            <Button
              kind="primary"
              onClick={() => open({ kind: "commitment", date: agendaDate })}
              data-action="new-commitment"
            >
              <Icon name="plus" />
              Novo compromisso
            </Button>
          }
        />
        <div className="agenda-toolbar">
          <div className="date-nav">
            <Button
              kind="small"
              aria-label="Período anterior"
              onClick={() =>
                setAgendaDate(
                  addDays(agendaDate, agendaView === "day" ? -1 : -7),
                )
              }
            >
              <Icon name="left" />
            </Button>
            <strong aria-live="polite" aria-atomic="true">
              {agendaView === "day"
                ? formatDate(agendaDate, true)
                : `${formatDate(days[0])} — ${formatDate(days[6])}`}
            </strong>
            <Button
              kind="small"
              aria-label="Próximo período"
              onClick={() =>
                setAgendaDate(addDays(agendaDate, agendaView === "day" ? 1 : 7))
              }
            >
              <Icon name="right" />
            </Button>
            <Button kind="small" onClick={() => setAgendaDate(today)}>
              {local ? "Hoje" : "Dia de exemplo"}
            </Button>
          </div>
          <div
            className="filters"
            role="group"
            aria-label="Visualização da agenda"
          >
            {(["day", "week"] as const).map((v) => (
              <button
                key={v}
                type="button"
                ref={v === "day" ? agendaDayButton : undefined}
                aria-pressed={agendaView === v}
                className={agendaView === v ? "active" : ""}
                onClick={() => setAgendaView(v)}
              >
                {v === "day" ? "Dia" : "Semana"}
              </button>
            ))}
          </div>
        </div>
        {agendaView === "day" ? (
          <DayCard date={agendaDate}>{timeline(agendaDate)}</DayCard>
        ) : (
          <div className="week-list">
            {days.map((d) => (
              <section key={d} className="card week-day">
                <div className="card-title">
                  <h2>{formatDate(d, true)}</h2>
                  <Button
                    kind="small"
                    onClick={() => {
                      setAgendaDate(d);
                      setAgendaView("day");
                      agendaDayButton.current?.focus();
                    }}
                  >
                    Abrir dia
                  </Button>
                </div>
                {timeline(d)}
              </section>
            ))}
          </div>
        )}
      </>
    );
  }
  function renderTasks() {
    const shown = data.tasks.filter(
      (t) =>
        (taskFilter === "all" ||
          (taskFilter === "done"
            ? t.status === "concluida"
            : t.status !== "concluida")) &&
        (!courseFilter || t.subjectId === courseFilter),
    );
    return (
      <>
        <Head
          page="tasks"
          subtitle="Prazos e estimativas sob seu controle."
          actions={
            <Button
              kind="primary"
              onClick={() => open({ kind: "task" })}
              data-action="new-task"
            >
              <Icon name="plus" />
              Nova tarefa
            </Button>
          }
        />
        <div className="agenda-toolbar">
          <div className="filters" role="group" aria-label="Filtrar tarefas">
            {[
              ["open", "Abertas"],
              ["done", "Concluídas"],
              ["all", "Todas"],
            ].map(([v, label]) => (
              <button
                type="button"
                key={v}
                aria-pressed={taskFilter === v}
                className={taskFilter === v ? "active" : ""}
                onClick={() => setTaskFilter(v)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="field compact-field">
            <label htmlFor="task-course-filter">Disciplina</label>
            <select
              id="task-course-filter"
              value={courseFilter}
              onChange={(e) => setCourseFilter(e.target.value)}
            >
              <option value="">Todas as disciplinas</option>
              {data.subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.archivedAtUtc ? " (arquivada)" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="stack">
          <section className="card">{tasks(shown)}</section>
          <section className="card">
            <div className="card-title">
              <h2>Prazos acadêmicos</h2>
              <Button kind="small" onClick={() => open({ kind: "deadline" })}>
                Novo prazo
              </Button>
            </div>
            <p className="micro-note">
              Um prazo pode ser vinculado a mais de uma tarefa. Editá-lo aqui
              atualiza a data exibida por todas elas.
            </p>
            {data.deadlines.length ? (
              <ul className="compact-list">
                {[...data.deadlines]
                  .sort((a, b) =>
                    (a.dueDate || a.dueAtUtc || "").localeCompare(
                      b.dueDate || b.dueAtUtc || "",
                    ),
                  )
                  .map((d) => (
                    <li key={d.id}>
                      <button
                        className="task-title-button"
                        type="button"
                        onClick={() => open({ kind: "deadline", id: d.id })}
                      >
                        {d.title}
                      </button>
                      <small>
                        {d.dueDate
                          ? formatDate(d.dueDate, true)
                          : d.dueAtUtc
                            ? localInput(
                                d.dueAtUtc,
                                d.timeZone || zone,
                              ).replace("T", " ")
                            : ""}{" "}
                        · {subjectName(data, d.subjectId)} ·{" "}
                        {data.tasks.filter((t) => t.deadlineId === d.id).length}{" "}
                        tarefa(s)
                      </small>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="subhead">
                Você pode cadastrar um prazo aqui ou ao criar uma tarefa.
              </p>
            )}
          </section>
        </div>
      </>
    );
  }
  function renderSubjects() {
    const rows = data.subjects
      .filter((s) => showArchived || !s.archivedAtUtc)
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
      .map((subject) => ({
        ...subject,
        openCount: openTasks.filter((task) => task.subjectId === subject.id).length,
      }));
    return (
      <>
        <Head
          page="subjects"
          subtitle="Organize suas tarefas por disciplina. Vincular uma tarefa é opcional."
          actions={
            <Button kind="primary" onClick={() => open({ kind: "subject" })}>
              Nova disciplina
            </Button>
          }
        />
        <label className="check-label archive-filter">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Mostrar arquivadas
        </label>
        {rows.length ? (
          <div className="three-col">
            {rows.map((s) => (
              <section key={s.id} className="card course-card">
                <div className="course-mark" aria-hidden="true" />
                <h2>{s.name}</h2>
                {s.archivedAtUtc && <span className="tag">Arquivada</span>}
                <p className="subhead">
                  {s.openCount} {s.openCount === 1 ? "tarefa aberta" : "tarefas abertas"}
                </p>
                <div className="card-footer head-actions">
                  <Button
                    kind="small"
                    onClick={() => {
                      setCourseFilter(s.id);
                      setTaskFilter("all");
                      go("tasks");
                    }}
                  >
                    Ver tarefas <Icon name="arrow" />
                  </Button>
                  {!s.archivedAtUtc && (
                    <Button
                      kind="small"
                      onClick={() => open({ kind: "subject", id: s.id })}
                    >
                      Renomear
                    </Button>
                  )}
                  <Button
                    kind="small"
                    disabled={busy}
                    onClick={() =>
                      fire({
                        type: "archive-subject",
                        id: s.id,
                        archived: !s.archivedAtUtc,
                      })
                    }
                  >
                    {s.archivedAtUtc ? "Restaurar disciplina" : "Arquivar"}
                  </Button>
                </div>
              </section>
            ))}
          </div>
        ) : (
          <section className="card">
            <Empty
              title="Suas disciplinas começam aqui."
              action={
                <Button onClick={() => open({ kind: "subject" })}>
                  Criar disciplina
                </Button>
              }
            >
              Arquivar preserva tarefas, prazos e compromissos. Você pode
              restaurar a disciplina quando precisar.
            </Empty>
          </section>
        )}
      </>
    );
  }
  function renderAvailability() {
    return (
      <>
        <Head
          page="availability"
          subtitle="Informe o tempo que você realmente quer reservar para tarefas."
        />
        <div className="two-col">
          <section className="card">
            <div className="card-title">
              <h2>Janelas semanais</h2>
              <Button kind="small" onClick={() => open({ kind: "rule" })}>
                Nova janela
              </Button>
            </div>
            <p className="subhead">
              Horários que se repetem na semana. Compromissos fixos são
              descontados automaticamente.
            </p>
            {data.availabilityRules.length ? (
              <ul className="compact-list">
                {[...data.availabilityRules]
                  .sort(
                    (a, b) =>
                      a.weekday - b.weekday ||
                      a.startLocalTime.localeCompare(b.startLocalTime),
                  )
                  .map((r) => (
                    <li key={r.id}>
                      <button
                        className="task-title-button"
                        type="button"
                        onClick={() => open({ kind: "rule", id: r.id })}
                      >
                        {weekdays[r.weekday]} · {r.startLocalTime}–
                        {r.endLocalTime}
                      </button>
                      <small>
                        {r.enabled ? "Ativa" : "Pausada"} · {r.timeZone}
                      </small>
                    </li>
                  ))}
              </ul>
            ) : (
              <Empty
                title="Nenhuma janela semanal."
                action={
                  <Button onClick={() => open({ kind: "rule" })}>
                    Informar horário
                  </Button>
                }
              >
                O CAMPULSO não presume que um intervalo vazio esteja livre.
              </Empty>
            )}
          </section>
          <section className="card">
            <div className="card-title">
              <h2>Exceções por data</h2>
              <Button
                kind="small"
                onClick={() => open({ kind: "exception", date: today })}
              >
                Nova exceção
              </Button>
            </div>
            <p className="subhead">
              Use uma janela diferente ou reserve um dia sem sugestões de
              tarefas.
            </p>
            {data.availabilityExceptions.length ? (
              <ul className="compact-list">
                {[...data.availabilityExceptions]
                  .sort((a, b) => a.localDate.localeCompare(b.localDate))
                  .map((e) => (
                    <li key={e.id}>
                      <button
                        type="button"
                        className="task-title-button"
                        onClick={() => open({ kind: "exception", id: e.id })}
                      >
                        {formatDate(e.localDate, true)}
                      </button>
                      <small>
                        {e.type === "unavailable"
                          ? "Indisponível"
                          : e.startLocalTime && e.endLocalTime
                            ? `${e.startLocalTime}–${e.endLocalTime}`
                            : `Tipo importado: ${e.type}`}
                      </small>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="subhead">Nenhuma exceção cadastrada.</p>
            )}
          </section>
        </div>
        <div className="note-box">
          Janelas específicas substituem os horários semanais da data.
          Sobreposições não contam tempo duas vezes. Ao reduzir a
          disponibilidade, blocos automáticos que deixarem de caber ficam sem
          horário; as tarefas e seus prazos são preservados. Novos blocos
          dependem de uma proposta aplicada por você.
        </div>
        <div className="preview-actions">
          <Button kind="primary" onClick={() => preview(prefs.mode)}>
            Rever planejamento
          </Button>
        </div>
      </>
    );
  }
  function planList(
    blocks: { taskId: string; startAtUtc: string; endAtUtc: string }[],
    empty: string,
  ) {
    return blocks.length ? (
      <ul className="compact-list">
        {blocks.map((b, i) => (
          <li key={i}>
            <strong>
              {formatDate(dateInZone(b.startAtUtc, zone))} ·{" "}
              {timeOf(b.startAtUtc, zone)}–{timeOf(b.endAtUtc, zone)}
            </strong>
            <span>
              {data.tasks.find((t) => t.id === b.taskId)?.title ||
                "Tarefa indisponível"}
            </span>
          </li>
        ))}
      </ul>
    ) : (
      <p className="subhead">{empty}</p>
    );
  }
  function renderPreview() {
    if (!proposal)
      return (
        <>
          <Head
            page="preview"
            subtitle="Confira o que mudaria antes de aplicar."
          />
          <section className="card">
            <Empty
              title="Nenhuma proposta aberta."
              action={
                <Button kind="primary" onClick={() => preview(prefs.mode)}>
                  Gerar proposta
                </Button>
              }
            >
              O plano atual só muda quando você confirma uma proposta.
            </Empty>
          </section>
        </>
      );
    const before = data.planBlocks.filter(
        (b) =>
          b.source === "automatic" &&
          Date.parse(b.startAtUtc) >=
            Math.ceil(Date.parse(proposal.options.nowUtc) / 60000) * 60000 &&
          dateInZone(new Date(Date.parse(b.endAtUtc) - 1).toISOString(), zone) <
            proposal.endDateExclusive &&
          dateInZone(b.startAtUtc, zone) >= proposal.startDate &&
          dateInZone(b.startAtUtc, zone) < proposal.endDateExclusive,
      ),
      stale = proposal.inputRevision !== revisionOf(data);
    return (
      <>
        <Head
          page="preview"
          subtitle={
            proposal.mode === "leve"
              ? "Uma proposta com menos tempo de tarefas flexíveis."
              : "Confira o que mudaria antes de aplicar."
          }
          eyebrow={`${formatDate(proposal.startDate)} a ${formatDate(addDays(proposal.endDateExclusive, -1))}`}
        />
        <div className="note-box">
          Nada muda até você aplicar. Compromissos fixos, blocos manuais, prazos
          e conclusões são preservados.
        </div>
        {stale && (
          <p className="form-error" role="alert">
            Os dados mudaram depois desta prévia. Gere outra proposta antes de
            aplicar.
          </p>
        )}
        <div className="day-summary">
          <div className="summary-item">
            <span>Antes</span>
            <strong>
              {duration(
                before.reduce(
                  (sum, b) => sum + minutesBetween(b.startAtUtc, b.endAtUtc),
                  0,
                ),
              )}
            </strong>
            <small>Em blocos automáticos</small>
          </div>
          <div className="summary-item">
            <span>Nesta proposta</span>
            <strong>{duration(proposal.usedMinutes)}</strong>
            <small>Limite: {duration(proposal.budgetMinutes)}</small>
          </div>
          <div className="summary-item">
            <span>Sem horário completo</span>
            <strong>{proposal.unscheduled.length}</strong>
            <small>As tarefas continuam abertas</small>
          </div>
        </div>
        <div className="compare two-col">
          <section className="card compare-panel">
            <h2>Antes</h2>
            {planList(before, "Nenhum bloco automático neste período.")}
          </section>
          <section className="card compare-panel proposed">
            <h2>Proposta</h2>
            {planList(
              proposal.blocks,
              "Nenhum bloco cabe no horário informado.",
            )}
          </section>
        </div>
        {proposal.warnings.length > 0 && (
          <section className="overload-notice" aria-label="Avisos da proposta">
            <h2>Confira estes limites</h2>
            <ul>
              {proposal.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </section>
        )}
        {proposal.unscheduled.length > 0 && (
          <section className="card section-gap">
            <h2>Tarefas que continuam sem horário completo</h2>
            <ul className="compact-list">
              {proposal.unscheduled.map((u) => (
                <li key={u.taskId}>
                  <strong>
                    {data.tasks.find((t) => t.id === u.taskId)?.title}
                  </strong>
                  <small>{duration(u.remainingMinutes)} sem alocação</small>
                  <p>{u.reason}</p>
                </li>
              ))}
            </ul>
            {nav("availability", "Rever disponibilidade")}
          </section>
        )}
        <section className="card section-gap">
          <h2>Por que esta proposta?</h2>
          <p className="subhead">
            O plano considera risco de prazo, importância e tarefas destacadas,
            dentro do tempo que você informou. Estimativa restante,
            compromissos, blocos manuais e limite diário delimitam as sugestões.
          </p>
          {proposal.mode === "leve" && (
            <p>
              O Modo leve usa {Math.round((prefs.lightModeRatio ?? 0.6) * 100)}%
              da capacidade flexível, conforme seus ajustes. Esse parâmetro de
              organização é configurável.
            </p>
          )}
          <details className="faq">
            <summary>Ver os motivos das sugestões</summary>
            <ul className="compact-list">
              {proposal.decisions.map((d, i) => (
                <li key={i}>
                  {d.taskId && (
                    <strong>
                      {data.tasks.find((t) => t.id === d.taskId)?.title}
                    </strong>
                  )}
                  <span>{d.reason}</span>
                </li>
              ))}
            </ul>
          </details>
        </section>
        <div className="preview-actions">
          <Button
            disabled={busy}
            onClick={() => {
              setProposal(undefined);
              go("today");
              notify("Proposta descartada. O plano atual foi preservado.");
            }}
            data-action="discard-proposal"
          >
            Descartar proposta
          </Button>
          {!stale && (
            <Button disabled={busy} onClick={() => void recalculate()}>
              Recalcular proposta
            </Button>
          )}
          {stale ? (
            <Button
              kind="primary"
              disabled={busy}
              onClick={() => void recalculate()}
            >
              Recalcular proposta
            </Button>
          ) : (
            <Button
              kind="primary"
              disabled={busy}
              onClick={() => void apply()}
              data-action="apply-proposal"
            >
              {busy
                ? "Aplicando…"
                : proposal.mode === "leve"
                  ? "Aplicar Modo leve"
                  : "Aplicar proposta"}
            </Button>
          )}
        </div>
      </>
    );
  }
  function renderLight() {
    return (
      <>
        <Head
          page="light"
          subtitle="Você escolhe quando reservar mais espaço no seu dia."
        />
        <div className="two-col">
          <section className="card focus-card">
            <div className="mode-icon">
              <Icon name="moon" />
            </div>
            <span className="tag">
              {prefs.mode === "leve"
                ? "Modo leve aplicado"
                : "Ainda não aplicado"}
            </span>
            <h2>Um plano mais leve, por sua escolha.</h2>
            <p>
              Veja uma proposta com menos blocos flexíveis. Aulas, compromissos
              e prazos continuam visíveis. Ativar esse modo não conclui tarefas
              nem muda suas datas de entrega.
            </p>
            <Button
              kind="primary"
              data-action={
                prefs.mode === "leve" ? "preview-normal" : "preview-light"
              }
              onClick={() => preview(prefs.mode === "leve" ? "normal" : "leve")}
            >
              {prefs.mode === "leve"
                ? "Rever plano normal"
                : "Ver proposta mais leve"}
            </Button>
          </section>
          <section className="card">
            <h2>O que você poderá conferir</h2>
            <ul className="compact-list">
              <li>O plano atual e a proposta, lado a lado.</li>
              <li>Quais tarefas continuam sem horário e seus prazos.</li>
              <li>O tempo reservado antes e depois.</li>
              <li>As opções de aplicar ou descartar.</li>
            </ul>
            <p>
              Seu ajuste atual usa{" "}
              {Math.round((prefs.lightModeRatio ?? 0.6) * 100)}% da capacidade
              flexível, depois dos compromissos e bloqueios.
            </p>
            {nav("settings", "Ajustar proporção")}
            <p className="micro-note">
              É uma preferência de organização. Não há avaliação de saúde ou
              inferência de como você está se sentindo.
            </p>
          </section>
        </div>
      </>
    );
  }
  async function savePreferences(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget),
      limit = String(form.get("limit") ?? "");
    try {
      await command({
        type: "save-preferences",
        timeZone: String(form.get("timeZone")),
        planningHorizonDays: Number(form.get("horizon")),
        dailyFlexibleLimitMinutes: limit === "" ? null : Number(limit),
        lightModeRatio: Number(form.get("ratio")) / 100,
      });
      setSettingsDirty(false);
    } catch {
      /* Edição continua disponível. */
    }
  }
  function renderSettings() {
    return (
      <>
        <Head
          page="settings"
          subtitle="Escolhas simples para organizar seu espaço."
        />
        <div className="two-col">
          <section className="card">
            <h2>Seu planejamento</h2>
            <form
              className="form-grid"
              onChangeCapture={() => setSettingsDirty(true)}
              onSubmit={savePreferences}
              key={prefs.updatedAtUtc}
            >
              <div className="field">
                <label htmlFor="settings-zone">Fuso horário</label>
                <input
                  id="settings-zone"
                  name="timeZone"
                  required
                  defaultValue={zone}
                />
                <small>
                  Compromissos já cadastrados conservam seus instantes. A agenda
                  passa a exibi-los neste fuso.
                </small>
              </div>
              <div className="field">
                <label htmlFor="settings-horizon">
                  Planejar os próximos dias
                </label>
                <input
                  id="settings-horizon"
                  name="horizon"
                  type="number"
                  min={1}
                  max={31}
                  step={1}
                  defaultValue={prefs.planningHorizonDays ?? 7}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="settings-limit">
                  Limite diário de tarefas (minutos)
                </label>
                <input
                  id="settings-limit"
                  name="limit"
                  type="number"
                  min={0}
                  step={1}
                  defaultValue={prefs.dailyFlexibleLimitMinutes ?? ""}
                />
                <small>
                  Vazio: sem limite adicional à disponibilidade. Zero: sem novos
                  blocos automáticos.
                </small>
              </div>
              <div className="field">
                <label htmlFor="settings-ratio">
                  Capacidade no Modo leve (%)
                </label>
                <input
                  id="settings-ratio"
                  name="ratio"
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={Math.round((prefs.lightModeRatio ?? 0.6) * 100)}
                  required
                />
                <small>
                  60% é o ajuste inicial, não uma recomendação de saúde.
                </small>
              </div>
              <Button kind="primary" type="submit" disabled={busy}>
                Salvar ajustes
              </Button>
            </form>
          </section>
          <div className="stack">
            <section className="card">
              <h2>Sua organização</h2>
              <div className="settings-list">
                {(["availability", "light", "data", "help"] as Page[]).map(
                  (p) => (
                    <div className="setting" key={p}>
                      <div className="setting-main">
                        <strong>{names[p]}</strong>
                      </div>
                      {nav(p, "Abrir")}
                    </div>
                  ),
                )}
              </div>
            </section>
            <section className="card">
              <h2>Armazenamento neste dispositivo</h2>
              <p className="subhead">
                O navegador pode remover dados locais. Mantenha cópias
                exportadas em um local escolhido por você.
              </p>
              <Button
                kind="small"
                onClick={() =>
                  void (async () => {
                    try {
                      const granted = await navigator.storage?.persist?.();
                      setStorageMessage(
                        granted
                          ? "O navegador concedeu armazenamento persistente. Continue mantendo backups."
                          : "O navegador não concedeu a proteção adicional. Você pode continuar usando e exportar backups.",
                      );
                    } catch (e) {
                      setStorageMessage(message(e));
                    }
                  })()
                }
              >
                Solicitar proteção de armazenamento
              </Button>
              {storageMessage && <p role="status">{storageMessage}</p>}
              <p className="micro-note">
                A instalação como aplicativo é opcional. O modo offline fica
                disponível depois do primeiro carregamento completo da versão de
                distribuição. CAMPULSO {APP_VERSION}.
              </p>
            </section>
          </div>
        </div>
      </>
    );
  }
  function renderData() {
    return (
      <>
        <Head
          page="data"
          subtitle="Guarde uma cópia e recupere seus dados com conferência."
        />
        <div className="note-box">
          {local
            ? "Os dados deste espaço ficam neste navegador."
            : "Você está na demonstração. A exportação contém somente os dados deste cenário."}{" "}
          O arquivo JSON não é criptografado e pode conter informações
          acadêmicas. Guarde-o em local privado. {privacyLink}
        </div>
        <div className="two-col">
          <section className="card">
            <h2>Exportar uma cópia</h2>
            <p className="subhead">
              A cópia reúne disciplinas, tarefas, compromissos, prazos,
              disponibilidade, preferências e planejamento, com verificação de
              integridade.
            </p>
            <div className="card-footer">
              <Button
                kind="primary"
                disabled={busy}
                onClick={() => void offerBackup()}
              >
                Exportar JSON
              </Button>
            </div>
            <p className="micro-note">
              Após o download, confira o arquivo na pasta escolhida. O CAMPULSO
              não verifica onde você o guardou.
            </p>
          </section>
          <section className="card">
            <h2>Restaurar com conferência</h2>
            <p className="subhead">
              O arquivo é validado antes de qualquer alteração. Você verá um
              resumo e poderá cancelar.
            </p>
            <div className="card-footer">
              {nav("restore", "Escolher arquivo para restaurar", "primary")}
            </div>
            <p className="micro-note">
              O formato criptografado CB-1 da POC-001 será integrado em uma
              etapa própria.
            </p>
          </section>
        </div>
        <details className="card section-gap">
          <summary>Apagar os dados deste espaço</summary>
          <p>
            Esta ação remove os dados{" "}
            {local ? "deste navegador" : "do cenário de demonstração"}. Os
            arquivos de backup guardados fora do aplicativo permanecem onde você
            os salvou.
          </p>
          <label className="check-label">
            <input
              type="checkbox"
              checked={clearConfirmed}
              onChange={(e) => setClearConfirmed(e.target.checked)}
            />
            Entendo a remoção e quero apagar os dados deste espaço.
          </label>
          <Button
            kind="danger"
            disabled={!clearConfirmed || busy}
            onClick={() =>
              void command({ type: "clear-all" })
                .then(() => {
                  setClearConfirmed(false);
                  setProposal(undefined);
                  setRestore(undefined);
                  notify(
                    "Dados deste espaço apagados. Backups externos não foram alterados.",
                  );
                })
                .catch(() => {})
            }
          >
            Confirmar remoção dos dados
          </Button>
        </details>
      </>
    );
  }
  function renderRestore() {
    return (
      <>
        <Head
          page="restore"
          subtitle="Validação, resumo e confirmação antes de qualquer substituição."
        />
        <section className="card">
          <div className="field">
            <label htmlFor="backup-file">Arquivo JSON do CAMPULSO</label>
            <input
              id="backup-file"
              aria-describedby="backup-file-hint"
              type="file"
              accept=".json,application/json"
              disabled={busy}
              onChange={(e) => void readBackup(e.target.files?.[0])}
            />
            <small id="backup-file-hint">
              Até 20 MiB. Arquivos incompatíveis ou alterados são rejeitados sem
              gravar dados. O backup JSON contém dados em texto legível.
            </small>
          </div>
          {restore && (
            <div className="section-gap">
              <span className="tag">Arquivo validado</span>
              <h2>Conferir antes de continuar</h2>
              <p className="file-name">{restore.filename}</p>
              <ul className="compact-list">
                <li>
                  Exportado em{" "}
                  {new Date(restore.backup.exportedAtUtc).toLocaleString(
                    "pt-BR",
                    { timeZone: zone },
                  )}{" "}
                  ({zone}).
                </li>
                <li>
                  {restore.backup.data.subjects.length} disciplinas,{" "}
                  {restore.backup.data.tasks.length} tarefas,{" "}
                  {restore.backup.data.commitments.length} compromissos e{" "}
                  {restore.backup.data.deadlines.length} prazos.
                </li>
                <li>
                  {restore.backup.data.planBlocks.length} blocos de
                  planejamento. Todas as 11 coleções serão importadas.
                </li>
              </ul>
              <div className="note-box">
                Continuar substituirá todos os dados deste espaço. Antes,
                ofereça uma cópia do estado atual para download e confirme que a
                guardou.
              </div>
              <Button disabled={busy} onClick={() => void offerBackup(true)}>
                {recoveryOffered
                  ? "Oferecer novamente a cópia atual"
                  : "Baixar cópia antes de substituir"}
              </Button>
              <label className="check-label section-gap">
                <input
                  type="checkbox"
                  checked={restoreConfirmed}
                  disabled={!recoveryOffered || busy}
                  onChange={(e) => setRestoreConfirmed(e.target.checked)}
                />
                Guardei minha cópia e confirmo a substituição de todos os dados
                deste espaço.
              </label>
              <div className="modal-actions">
                <Button
                  disabled={busy}
                  onClick={() => {
                    setRestore(undefined);
                    setRestoreConfirmed(false);
                    setRecoveryOffered(false);
                    go("data");
                  }}
                >
                  Cancelar
                </Button>
                <Button
                  kind="primary"
                  disabled={
                    !recoveryOffered ||
                    !restoreConfirmed ||
                    busy ||
                    restore.revision !== revisionOf(data)
                  }
                  onClick={() => void doRestore()}
                >
                  {busy ? "Restaurando…" : "Confirmar restauração"}
                </Button>
              </div>
            </div>
          )}
        </section>
      </>
    );
  }
  function renderHelp() {
    const questions = [
      [
        "Qual é a diferença entre tarefa e compromisso?",
        "Compromisso tem data e horário fixos. Tarefa é uma atividade flexível, com estimativa, tempo restante e prazo opcional. Uma tarefa pode continuar sem horário.",
      ],
      [
        "Uma proposta muda minha agenda automaticamente?",
        "Não. Gerar e descartar uma prévia preserva o plano. Aplicar substitui apenas blocos automáticos do período mostrado. Compromissos, blocos manuais, prazos e conclusões permanecem iguais.",
      ],
      [
        "O que acontece quando não há tempo suficiente?",
        "As tarefas que não cabem continuam abertas com seus prazos visíveis. Você pode revisar disponibilidade, estimativa e prioridades ou mantê-las sem horário. Uma tarefa vencida continua identificada como vencida.",
      ],
      [
        "Como funciona o Modo leve?",
        "Você confere um plano que usa uma proporção menor da capacidade disponível e escolhe aplicar ou descartar. A proporção é configurável em Ajustes. É uma escolha de organização, sem avaliação de saúde.",
      ],
      [
        "Meus dados ficam salvos?",
        local
          ? "Sim, após a confirmação de cada gravação neste navegador. Use Exportar JSON para manter cópias externas. O modo privado, a limpeza do navegador ou a falta de espaço podem afetar o armazenamento."
          : "Este cenário usa apenas memória. Recarregar reinicia os exemplos. Selecione Ensaio local para salvar dados no navegador.",
      ],
      [
        "Posso usar o CAMPULSO sem internet?",
        "Após o primeiro carregamento completo da versão de distribuição, os arquivos do aplicativo ficam disponíveis offline. Os dados continuam no navegador e não são enviados a um servidor.",
      ],
      [
        "Posso usar em qualquer graduação?",
        "Sim. A estrutura é comum a todas as graduações. Os nomes de disciplinas da demonstração são apenas exemplos.",
      ],
    ];
    return (
      <>
        <Head
          page="help"
          subtitle="Orientações para usar seu espaço com autonomia."
        />
        <section className="card">
          {questions.map(([q, a], i) => (
            <details key={q} className="faq" open={i === 0 ? true : undefined}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </section>
      </>
    );
  }
  const renderers: Record<Page, () => ReactNode> = {
    today: renderToday,
    agenda: renderAgenda,
    tasks: renderTasks,
    subjects: renderSubjects,
    availability: renderAvailability,
    preview: renderPreview,
    light: renderLight,
    settings: renderSettings,
    data: renderData,
    restore: renderRestore,
    help: renderHelp,
    privacy: () => <Privacy />,
  };
  const navigation = (p: Page, icon: string) => (
    <button
      type="button"
      key={p}
      data-page={p}
      className={page === p ? "active" : ""}
      aria-current={page === p ? "page" : undefined}
      onClick={() => go(p)}
    >
      <Icon name={icon} />
      <span>{p === "data" ? "Seus dados" : names[p]}</span>
    </button>
  );
  return (
    <>
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        Ir para o conteúdo
      </a>
      <aside className="sidebar" aria-label="Barra lateral">
        <a
          className="brand"
          href="#today"
          aria-label="CAMPULSO, Meu dia"
          onClick={(e) => {
            e.preventDefault();
            go("today");
          }}
        >
          <img src={logo} alt="CAMPULSO" width="186" height="50" />
        </a>
        <p className="nav-caption">SEU ESPAÇO</p>
        <nav className="nav" aria-label="Navegação principal">
          {navigation("today", "day")}
          {navigation("agenda", "calendar")}
          {navigation("tasks", "tasks")}
          {navigation("subjects", "book")}
          {navigation("settings", "settings")}
        </nav>
        <div className="sidebar-bottom">
          <p className="nav-caption">DO SEU JEITO</p>
          <nav className="nav secondary-nav" aria-label="Recursos de apoio">
            {navigation("availability", "clock")}
            {navigation("data", "data")}
            {navigation("help", "help")}
          </nav>
          <div className="brand-note">
            <span className="small-dot" aria-hidden="true" />
            <p>
              No ritmo da sua
              <br />
              vida universitária.
            </p>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <a
            className="mobile-brand"
            href="#today"
            aria-label="CAMPULSO, Meu dia"
            onClick={(e) => {
              e.preventDefault();
              go("today");
            }}
          >
            <img src={logo} alt="CAMPULSO" width="160" height="44" />
          </a>
          <div className="breadcrumb">
            <span>Meu espaço</span>
            <span aria-hidden="true">/</span>
            <strong>{names[page]}</strong>
          </div>
          <span className="prototype-badge">
            <span aria-hidden="true" />
            {local ? "Ensaio local" : "Prévia R02"}
          </span>
        </header>
        <aside className="review-bar" aria-label="Controles do espaço">
          <div className="review-copy">
            <strong>
              {local ? "Seu espaço neste navegador" : "Explore a demonstração"}
            </strong>
            <span>
              {local
                ? busy
                  ? "Salvando alteração…"
                  : offline
                    ? "Sem conexão · dados locais disponíveis"
                    : offlineReady
                      ? "Dados locais · aplicativo disponível offline"
                      : "Dados locais · mantenha cópias exportadas"
                : "Dados fictícios · 23/11/2026 · alterações apenas nesta sessão"}
            </span>
          </div>
          <div className="review-controls">
            <label htmlFor="demo-scenario">Cenário</label>
            <select
              id="demo-scenario"
              value={scenario}
              disabled={busy}
              onChange={(e) => {
                if (
                  (settingsDirty || proposal || restore) &&
                  !window.confirm(
                    "Sair deste cenário descarta alterações e prévias ainda não salvas. Continuar?",
                  )
                )
                  return;
                const url = new URL(location.href);
                url.searchParams.set("scenario", e.target.value);
                url.hash = "today";
                location.assign(url.href);
              }}
            >
              <option value="planned">Dia planejado</option>
              <option value="empty">Primeiro acesso</option>
              <option value="overloaded">Sobrecarga</option>
              <option value="local">Ensaio local</option>
            </select>
            <button
              className="reset-button"
              type="button"
              disabled={busy}
              onClick={() => {
                if (editor) return;
                if (settingsDirty || proposal || restore) {
                  if (
                    !window.confirm(
                      "Descartar alterações e prévias pendentes e recarregar os dados?",
                    )
                  )
                    return;
                }
                location.reload();
              }}
            >
              {local ? "Recarregar" : "Reiniciar"}
            </button>
          </div>
        </aside>
        <main id="main" tabIndex={-1} aria-busy={busy}>
          {error && (
            <div className="form-error" role="alert">
              <strong>Não foi possível concluir.</strong>
              <p>{error}</p>
              {error.includes("Outra aba") && (
                <Button
                  kind="small"
                  onClick={() => {
                    if (
                      editor &&
                      !window.confirm(
                        "Recarregar descarta a edição não salva. Continuar?",
                      )
                    )
                      return;
                    location.reload();
                  }}
                >
                  Recarregar dados
                </Button>
              )}
              <Button kind="small" onClick={() => setError("")}>
                Fechar aviso
              </Button>
            </div>
          )}
          {update && (
            <div className="note-box" role="status">
              <p>
                Uma atualização do aplicativo está pronta. Seus dados locais
                serão mantidos.
              </p>
              <Button
                disabled={
                  busy || !!editor || !!proposal || !!restore || settingsDirty
                }
                onClick={() =>
                  void update()
                    .then(() => location.reload())
                    .catch((e) => setError(message(e)))
                }
              >
                Atualizar aplicativo
              </Button>
              {(editor || proposal || restore || settingsDirty) && (
                <small>
                  Conclua ou descarte a edição ou prévia aberta antes de
                  atualizar.
                </small>
              )}
            </div>
          )}
          <section
            className="page active"
            id={"page-" + page}
            aria-labelledby={page + "-title"}
          >
            {renderers[page]()}
          </section>
        </main>
        <footer className="workspace-footer">
          CAMPULSO <span aria-hidden="true">·</span> Uma coisa de cada vez, no
          seu ritmo.
          {privacyLink}
        </footer>
      </div>
      <nav className="mobile-nav" aria-label="Navegação no celular">
        {navigation("today", "day")}
        {navigation("agenda", "calendar")}
        {navigation("tasks", "tasks")}
        <button
          type="button"
          id="more-btn"
          ref={moreButton}
          aria-expanded={more}
          aria-controls="more-menu"
          className={
            !["today", "agenda", "tasks"].includes(page) ? "active" : ""
          }
          onClick={() => setMore(!more)}
        >
          <Icon name="more" />
          <span>Mais</span>
        </button>
      </nav>
      <div
        ref={moreRef}
        id="more-menu"
        role="navigation"
        className="more-menu"
        hidden={!more}
        aria-label="Mais destinos"
      >
        <p>Seu espaço</p>
        {(
          [
            "subjects",
            "availability",
            "light",
            "settings",
            "data",
            "help",
          ] as Page[]
        ).map((p) => (
          <button type="button" key={p} aria-current={page === p ? "page" : undefined} onClick={() => go(p)}>
            {p === "data" ? "Seus dados" : names[p]}
          </button>
        ))}
      </div>
      {editor && (
        <Editor
          key={editor.kind + "-" + (editor.id || "new")}
          spec={editor}
          data={data}
          today={today}
          busy={busy}
          onSave={command}
          onClose={() => setEditor(undefined)}
        />
      )}
      <div
        id="toast"
        className={toast ? "show" : ""}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {toast}
        {undo && (
          <>
          <button
            className="toast-undo"
            disabled={busy}
            onClick={() => {
              const previous = undo;
              void command({
                type: "set-task-status",
                id: previous.id,
                status: previous.status,
                remainingMinutes: previous.remainingMinutes,
              })
                .then(() =>
                  notify(
                    "Conclusão desfeita. Revise o plano para sugerir novos blocos.",
                  ),
                )
                .catch(() => {});
            }}
          >
            Desfazer
          </button>
          <button
            className="toast-undo"
            type="button"
            aria-label="Fechar aviso de conclusão"
            onClick={() => {
              setUndo(undefined);
              setToast("");
              document.getElementById(page + "-title")?.focus();
            }}
          >
            Fechar
          </button>
          </>
        )}
      </div>
    </>
  );
}
