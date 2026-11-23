import { useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { BackupData, Task } from "../src/domain/model";
import { dateInZone } from "../src/domain/planner";
import {
  dateTitle,
  deadlineDate,
  dueLabel,
  duration,
  minutesBetween,
  names,
  preferences,
  subjectName,
  timeOf,
  type Page,
} from "./view";

export function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    left: <path d="m14 6-6 6 6 6" />,
    right: <path d="m10 6 6 6-6 6" />,
    moon: <path d="M20.8 13A9 9 0 0 1 11 3.2 9 9 0 1 0 20.8 13Z" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
  };
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name] || <use href={"#i-" + name} />}
    </svg>
  );
}
export function Button({
  children,
  kind = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: string }) {
  return (
    <button
      type="button"
      {...props}
      className={"btn " + kind + (props.className ? " " + props.className : "")}
    >
      {children}
    </button>
  );
}
export function Head({
  page,
  subtitle,
  actions,
  eyebrow,
}: {
  page: Page;
  subtitle: string;
  actions?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 id={page + "-title"} tabIndex={-1}>
          {names[page]}
        </h1>
        <p className="subhead">{subtitle}</p>
      </div>
      {actions && <div className="head-actions">{actions}</div>}
    </div>
  );
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function TaskRows({
  data,
  tasks,
  today,
  edit,
  toggle,
  busy,
  now,
}: {
  data: BackupData;
  tasks: Task[];
  today: string;
  edit: (id?: string) => void;
  toggle: (t: Task) => void;
  busy: boolean;
  now: string;
}) {
  const pageSize = 50;
  const [limit, setLimit] = useState(pageSize);
  const list = useRef<HTMLDivElement>(null);
  const firstAdded = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (firstAdded.current === null) return;
    list.current?.children[firstAdded.current]?.querySelector<HTMLButtonElement>(".task-title-button")?.focus();
    firstAdded.current = null;
  }, [limit]);
  const shown = tasks.slice(0, limit);
  if (!tasks.length)
    return (
      <Empty
        title="Nenhuma tarefa nesta lista."
        action={
          <Button onClick={() => edit()}>
            <Icon name="plus" />
            Nova tarefa
          </Button>
        }
      >
        Você pode criar uma tarefa sem vinculá-la a uma disciplina.
      </Empty>
    );
  return (
    <>
    <div ref={list} className="task-list" role="list">
      {shown.map((t, index) => (
        <article
          key={t.id}
          className={"task-row " + (t.status === "concluida" ? "is-done" : "")}
          role="listitem"
          aria-posinset={index + 1}
          aria-setsize={tasks.length}
        >
          <button
            type="button"
            className={"check " + (t.status === "concluida" ? "done" : "")}
            aria-pressed={t.status === "concluida"}
            aria-label={
              (t.status === "concluida" ? "Reabrir: " : "Concluir: ") + t.title
            }
            disabled={busy}
            onClick={() => toggle(t)}
            data-action="toggle-task"
            data-id={t.id}
          >
            <span aria-hidden="true" />
          </button>
          <div className="task-main">
            <button
              type="button"
              className="task-title-button"
              data-action="edit-task"
              onClick={() => edit(t.id)}
            >
              {t.title}
            </button>
            <div className="task-meta">
              {subjectName(data, t.subjectId)} ·{" "}
              {duration(
                t.status === "concluida"
                  ? t.estimateMinutes
                  : t.remainingMinutes,
              )}
              {t.pinned ? " · Destacada" : ""}
            </div>
            <div
              className={
                "task-due " +
                (deadlineDate(data, t) &&
                deadlineDate(data, t) <= today &&
                t.status !== "concluida"
                  ? "today"
                  : "")
              }
            >
              {dueLabel(data, t, today, now)}
            </div>
          </div>
          {t.status === "concluida" && <span className="tag">Concluída</span>}
        </article>
      ))}
    </div>
    {tasks.length > pageSize && (
      <div className="card-footer">
        <p className="micro-note" role="status">
          {shown.length} de {tasks.length} tarefas exibidas
        </p>
        {shown.length < tasks.length && (
          <Button kind="small" onClick={() => {
            firstAdded.current = shown.length;
            setLimit(limit + pageSize);
          }}>
            Mostrar mais tarefas
          </Button>
        )}
      </div>
    )}
    </>
  );
}
export function Timeline({
  data,
  date,
  editTask,
  editCommitment,
}: {
  data: BackupData;
  date: string;
  editTask: (id: string) => void;
  editCommitment: (id?: string, date?: string) => void;
}) {
  const zone = preferences(data).timeZone;
  const entries = [
    ...data.commitments
      .filter(
        (c) =>
          dateInZone(c.startAtUtc, zone) <= date &&
          dateInZone(
            new Date(Date.parse(c.endAtUtc) - 1).toISOString(),
            zone,
          ) >= date,
      )
      .map((c) => ({
        id: c.id,
        title: c.title,
        subjectId: c.subjectId,
        start: c.startAtUtc,
        end: c.endAtUtc,
        type: "commitment",
        manual: false,
      })),
    ...data.planBlocks.flatMap((b) => {
      const t = data.tasks.find(
        (t) => t.id === b.taskId && t.status !== "concluida",
      );
      return t &&
        dateInZone(b.startAtUtc, zone) <= date &&
        dateInZone(new Date(Date.parse(b.endAtUtc) - 1).toISOString(), zone) >=
          date
        ? [
            {
              id: t.id,
              title: t.title,
              subjectId: t.subjectId,
              start: b.startAtUtc,
              end: b.endAtUtc,
              type: "block",
              manual: b.source === "manual",
            },
          ]
        : [];
    }),
  ].sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
  if (!entries.length)
    return (
      <Empty
        title="Este dia está livre de horários."
        action={
          <Button onClick={() => editCommitment(undefined, date)}>
            Adicionar compromisso
          </Button>
        }
      >
        Compromissos e blocos aplicados aparecerão aqui.
      </Empty>
    );
  return (
    <div className="timeline">
      {entries.map((e, i) => (
        <div className="timeline-item" key={e.id + "-" + i}>
          <div className="time">
            {dateInZone(e.start, zone) < date ? "00:00" : timeOf(e.start, zone)}
            <small>
              {dateInZone(e.end, zone) > date ? "24:00" : timeOf(e.end, zone)}
            </small>
          </div>
          <div className="time-dot" aria-hidden="true" />
          <div
            className={
              "event " + (e.type === "commitment" ? "fixed" : "flexible")
            }
          >
            <div className="event-meta">
              <span
                className={
                  "tag " + (e.type === "commitment" ? "fixed" : "task")
                }
              >
                {e.type === "commitment"
                  ? "Compromisso fixo"
                  : e.manual
                    ? "Bloco manual"
                    : "Bloco flexível"}
              </span>
              <span>
                {duration(minutesBetween(e.start, e.end))}
                {dateInZone(e.start, zone) !== dateInZone(e.end, zone)
                  ? " no total"
                  : ""}
              </span>
            </div>
            <button
              type="button"
              className="task-title-button event-title"
              onClick={() =>
                e.type === "commitment" ? editCommitment(e.id) : editTask(e.id)
              }
            >
              {e.title}
            </button>
            <div className="event-meta">{subjectName(data, e.subjectId)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
export function DayCard({
  date,
  children,
}: {
  date: string;
  children: ReactNode;
}) {
  return (
    <section className="card">
      <div className="card-title">
        <h2>{dateTitle(date)}</h2>
      </div>
      {children}
    </section>
  );
}
