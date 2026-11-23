import { useEffect, useRef, useState, type FormEvent } from "react";
import type { BackupData, Importance, Commitment } from "../src/domain/model";
import type { Command } from "../src/application/workspace";
import { instantForLocal } from "../src/domain/planner";
import { Button, Icon } from "./components";
import { formatDate, localInput, preferences, weekdays } from "./view";

export interface EditorSpec {
  kind: "task" | "commitment" | "subject" | "deadline" | "rule" | "exception";
  id?: string;
  date?: string;
  subjectId?: string;
}
interface Props {
  spec: EditorSpec;
  data: BackupData;
  today: string;
  busy: boolean;
  onSave: (command: Command) => Promise<void>;
  onClose: () => void;
}
export function Editor({ spec, data, today, busy, onSave, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null),
    [error, setError] = useState(""),
    [deleting, setDeleting] = useState(false);
  const task =
      spec.kind === "task"
        ? data.tasks.find((t) => t.id === spec.id)
        : undefined,
    commitment =
      spec.kind === "commitment"
        ? data.commitments.find((c) => c.id === spec.id)
        : undefined,
    subject =
      spec.kind === "subject"
        ? data.subjects.find((s) => s.id === spec.id)
        : undefined,
    deadline =
      spec.kind === "deadline"
        ? data.deadlines.find((d) => d.id === spec.id)
        : undefined,
    rule =
      spec.kind === "rule"
        ? data.availabilityRules.find((r) => r.id === spec.id)
        : undefined,
    exception =
      spec.kind === "exception"
        ? data.availabilityExceptions.find((e) => e.id === spec.id)
        : undefined;
  const zone =
    commitment?.timeZone ||
    rule?.timeZone ||
    deadline?.timeZone ||
    preferences(data).timeZone;
  const linked = data.deadlines.find((d) => d.id === task?.deadlineId);
  const [deadlineMode, setDeadlineMode] = useState(
    task?.deadlineId
      ? "linked"
      : task?.dueDate
        ? "legacy"
        : deadline?.dueAtUtc
          ? "instant"
          : spec.kind === "deadline"
            ? "date"
            : "none",
  );
  const [exceptionType, setExceptionType] = useState(
    exception && !["r02-janela", "unavailable"].includes(exception.type)
      ? "imported"
      : exception?.type === "unavailable"
        ? exception.startLocalTime
          ? "unavailable-window"
          : "unavailable"
        : "r02-janela",
  );
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    document.body.classList.add("modal-open");
    return () => {
      document.body.classList.remove("modal-open");
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      else
        document
          .querySelector<HTMLElement>(".page.active h1")
          ?.focus({ preventScroll: true });
    };
  }, []);
  const label = {
    task: "tarefa",
    commitment: "compromisso",
    subject: "disciplina",
    deadline: "prazo",
    rule: "janela semanal",
    exception: "exceção por data",
  }[spec.kind];
  const selectedSubject =
    task?.subjectId ||
    commitment?.subjectId ||
    deadline?.subjectId ||
    spec.subjectId ||
    "";
  const activeSubjects = data.subjects
    .filter((s) => !s.archivedAtUtc || s.id === selectedSubject)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const subjectField = (
    <div className="field">
      <label htmlFor="item-course">Disciplina (opcional)</label>
      <select id="item-course" name="subjectId" defaultValue={selectedSubject}>
        <option value="">Sem disciplina</option>
        {activeSubjects.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
            {s.archivedAtUtc ? " (arquivada)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget),
      s = (key: string) => String(form.get(key) ?? ""),
      n = (key: string) => Number(s(key));
    const optional = (key: string) => s(key) || undefined;
    const fromLocal = (value: string) => {
      const [date, time] = value.split("T");
      return instantForLocal(date, time, s("timeZone") || zone);
    };
    try {
      let command: Command;
      switch (spec.kind) {
        case "subject":
          command = { type: "save-subject", id: spec.id, name: s("name") };
          break;
        case "task": {
          const inlineDeadline =
            deadlineMode === "date"
              ? { dueDate: s("dueDate") }
              : deadlineMode === "instant"
                ? { dueAtUtc: fromLocal(s("dueAt")), timeZone: s("timeZone") }
                : undefined;
          command = {
            type: "save-task",
            id: spec.id,
            title: s("title"),
            subjectId: optional("subjectId"),
            estimateMinutes: n("estimateMinutes"),
            remainingMinutes: n("remainingMinutes"),
            importance: s("importance") as Importance,
            pinned: form.has("pinned"),
            deadlineId:
              deadlineMode === "linked" ? optional("deadlineId") : undefined,
            clearLegacyDueDate: deadlineMode !== "legacy",
            inlineDeadline,
          };
          break;
        }
        case "commitment":
          command = {
            type: "save-commitment",
            id: spec.id,
            title: s("title"),
            subjectId: optional("subjectId"),
            startAtUtc: fromLocal(s("start")),
            endAtUtc: fromLocal(s("end")),
            timeZone: s("timeZone"),
            kind: s("kind") as Commitment["kind"],
          };
          break;
        case "deadline":
          command = {
            type: "save-deadline",
            id: spec.id,
            title: s("title"),
            subjectId: optional("subjectId"),
            ...(deadlineMode === "instant"
              ? { dueAtUtc: fromLocal(s("dueAt")), timeZone: s("timeZone") }
              : { dueDate: s("dueDate") }),
          };
          break;
        case "rule":
          command = {
            type: "save-rule",
            id: spec.id,
            weekday: n("weekday"),
            startLocalTime: s("startLocalTime"),
            endLocalTime: s("endLocalTime"),
            timeZone: s("timeZone"),
            enabled: form.has("enabled"),
          };
          break;
        case "exception":
          if (exceptionType === "imported")
            throw Error(
              "Este tipo importado foi preservado. Escolha explicitamente outro tipo para convertê-lo.",
            );
          command = {
            type: "save-exception",
            id: spec.id,
            localDate: s("localDate"),
            exceptionType:
              exceptionType === "r02-janela" ? "r02-janela" : "unavailable",
            ...(exceptionType !== "unavailable"
              ? {
                  startLocalTime: s("startLocalTime"),
                  endLocalTime: s("endLocalTime"),
                }
              : {}),
          };
          break;
      }
      await onSave(command);
      onClose();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Não foi possível salvar. A edição foi mantida.",
      );
    }
  }
  async function remove() {
    const type = {
      task: "delete-task",
      commitment: "delete-commitment",
      deadline: "delete-deadline",
      rule: "delete-rule",
      exception: "delete-exception",
      subject: "archive-subject",
    }[spec.kind];
    try {
      if (!spec.id) return;
      await onSave(
        type === "archive-subject"
          ? { type, id: spec.id, archived: true }
          : {
              type: type as
                | "delete-task"
                | "delete-commitment"
                | "delete-deadline"
                | "delete-rule"
                | "delete-exception",
              id: spec.id,
            },
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível excluir.");
    }
  }
  const dueFields = (
    <>
      <div className="field">
        <label htmlFor="deadline-mode">
          {spec.kind === "task" ? "Prazo (opcional)" : "Tipo de prazo"}
        </label>
        <select
          id="deadline-mode"
          value={deadlineMode}
          onChange={(e) => setDeadlineMode(e.target.value)}
        >
          {spec.kind === "task" && (
            <>
              <option value="none">Sem prazo</option>
              {task?.dueDate && (
                <option value="legacy">
                  Manter data existente: {formatDate(task.dueDate)}
                </option>
              )}
              <option value="linked">Usar prazo cadastrado</option>
            </>
          )}
          <option value="date">Data, sem horário</option>
          <option value="instant">Data e horário definidos</option>
        </select>
      </div>
      {deadlineMode === "linked" && (
        <div className="field">
          <label htmlFor="task-deadline">Prazo cadastrado</label>
          <select
            id="task-deadline"
            name="deadlineId"
            defaultValue={task?.deadlineId || ""}
            required
          >
            <option value="">Selecione um prazo</option>
            {data.deadlines.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title} ·{" "}
                {d.dueDate
                  ? formatDate(d.dueDate)
                  : d.dueAtUtc
                    ? localInput(d.dueAtUtc, d.timeZone || zone).replace(
                        "T",
                        " ",
                      )
                    : ""}
              </option>
            ))}
          </select>
          <small>
            Para editar um prazo compartilhado, abra Prazos acadêmicos em
            Tarefas.
          </small>
        </div>
      )}
      {deadlineMode === "date" && (
        <div className="field">
          <label htmlFor="item-date">Data do prazo</label>
          <input
            id="item-date"
            type="date"
            name="dueDate"
            required
            defaultValue={
              deadline?.dueDate || linked?.dueDate || task?.dueDate || ""
            }
          />
          <small>A data será preservada sem acrescentar um horário.</small>
        </div>
      )}
      {deadlineMode === "instant" && (
        <>
          <div className="field">
            <label htmlFor="item-date-time">Data e horário do prazo</label>
            <input
              id="item-date-time"
              type="datetime-local"
              name="dueAt"
              required
              defaultValue={
                deadline?.dueAtUtc
                  ? localInput(deadline.dueAtUtc, zone)
                  : linked?.dueAtUtc
                    ? localInput(linked.dueAtUtc, zone)
                    : ""
              }
            />
          </div>
          <div className="field">
            <label htmlFor="item-zone">Fuso horário</label>
            <input
              id="item-zone"
              name="timeZone"
              required
              defaultValue={zone}
              autoComplete="off"
            />
          </div>
        </>
      )}
    </>
  );
  return (
    <dialog
      ref={dialog}
      id="editor"
      aria-labelledby="editor-title"
      className="modal"
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
    >
      <div className="editor-header">
        <h2 id="editor-title">
          {spec.id
            ? "Editar"
            : ["compromisso", "prazo"].includes(label)
              ? "Novo"
              : "Nova"}{" "}
          {label}
        </h2>
        <button
          type="button"
          className="editor-close"
          aria-label="Fechar edição"
          onClick={onClose}
          disabled={busy}
        >
          <Icon name="close" />
        </button>
      </div>
      <form id="editor-form" onSubmit={submit}>
        <fieldset disabled={busy} className="form-grid form-fieldset">
          {spec.kind === "subject" ? (
            <div className="field">
              <label htmlFor="subject-name">Nome da disciplina</label>
              <input
                id="subject-name"
                name="name"
                maxLength={120}
                required
                defaultValue={subject?.name || ""}
                autoFocus
              />
            </div>
          ) : (
            ["task", "commitment", "deadline"].includes(spec.kind) && (
              <>
                <div className="field">
                  <label htmlFor="item-title">Título</label>
                  <input
                    id="item-title"
                    name="title"
                    maxLength={160}
                    required
                    defaultValue={
                      task?.title || commitment?.title || deadline?.title || ""
                    }
                    autoFocus
                  />
                </div>
                {subjectField}
              </>
            )
          )}
          {spec.kind === "task" && (
            <>
              <div className="two-col">
                <div className="field">
                  <label htmlFor="item-duration">Estimativa total (min)</label>
                  <input
                    id="item-duration"
                    name="estimateMinutes"
                    type="number"
                    min={15}
                    step={1}
                    required
                    defaultValue={task?.estimateMinutes ?? 30}
                  />
                </div>
                <div className="field">
                  <label htmlFor="task-remaining">Tempo restante (min)</label>
                  <input
                    id="task-remaining"
                    name="remainingMinutes"
                    type="number"
                    min={0}
                    step={1}
                    required
                    defaultValue={task?.remainingMinutes ?? 30}
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="task-importance">Importância</label>
                <select
                  id="task-importance"
                  name="importance"
                  defaultValue={task?.importance || "media"}
                >
                  <option value="baixa">Baixa</option>
                  <option value="media">Média</option>
                  <option value="alta">Alta</option>
                </select>
              </div>
              <label className="check-label">
                <input
                  type="checkbox"
                  name="pinned"
                  defaultChecked={task?.pinned}
                />
                Destacar esta tarefa no planejamento
              </label>
              {dueFields}
              <p className="micro-note">
                Só você informa o progresso. Reduzir o tempo restante não
                conclui a tarefa automaticamente.
              </p>
            </>
          )}
          {spec.kind === "deadline" && dueFields}
          {spec.kind === "commitment" && (
            <>
              <div className="two-col">
                <div className="field">
                  <label htmlFor="event-start">Início</label>
                  <input
                    id="event-start"
                    type="datetime-local"
                    name="start"
                    required
                    defaultValue={
                      commitment
                        ? localInput(commitment.startAtUtc, zone)
                        : `${spec.date || today}T09:00`
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor="event-end">Fim</label>
                  <input
                    id="event-end"
                    type="datetime-local"
                    name="end"
                    required
                    defaultValue={
                      commitment
                        ? localInput(commitment.endAtUtc, zone)
                        : `${spec.date || today}T10:00`
                    }
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="event-kind">Tipo</label>
                <select
                  id="event-kind"
                  name="kind"
                  defaultValue={commitment?.kind || "outro"}
                >
                  <option value="aula">Aula</option>
                  <option value="avaliacao">Avaliação</option>
                  <option value="estagio">Estágio</option>
                  <option value="outro">Outro</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="event-zone">Fuso horário</label>
                <input
                  id="event-zone"
                  name="timeZone"
                  required
                  defaultValue={zone}
                />
              </div>
              <p className="micro-note">
                Compromissos são fixos. O planejamento adapta os blocos de
                tarefas ao redor deles.
              </p>
            </>
          )}
          {spec.kind === "rule" && (
            <>
              <div className="field">
                <label htmlFor="rule-weekday">Dia da semana</label>
                <select
                  id="rule-weekday"
                  name="weekday"
                  defaultValue={rule?.weekday ?? 1}
                >
                  {weekdays.map((name, i) => (
                    <option key={i} value={i}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
              <label className="check-label">
                <input
                  type="checkbox"
                  name="enabled"
                  defaultChecked={rule?.enabled ?? true}
                />
                Janela ativa
              </label>
              <div className="field">
                <label htmlFor="rule-zone">Fuso horário</label>
                <input
                  id="rule-zone"
                  name="timeZone"
                  defaultValue={zone}
                  required
                />
              </div>
            </>
          )}
          {spec.kind === "exception" && (
            <>
              <div className="field">
                <label htmlFor="exception-date">Data da exceção</label>
                <input
                  id="exception-date"
                  name="localDate"
                  type="date"
                  required
                  defaultValue={exception?.localDate || spec.date || today}
                />
              </div>
              <div className="field">
                <label htmlFor="exception-type">
                  Disponibilidade nesta data
                </label>
                <select
                  id="exception-type"
                  value={exceptionType}
                  onChange={(e) => setExceptionType(e.target.value)}
                >
                  <option value="r02-janela">Usar janela específica</option>
                  <option value="unavailable">Dia indisponível</option>
                  <option value="unavailable-window">
                    Bloquear um intervalo
                  </option>
                  {exceptionType === "imported" && (
                    <option value="imported">
                      Manter tipo importado: {exception?.type}
                    </option>
                  )}
                </select>
              </div>
              <p className="micro-note">
                Uma janela específica substitui as janelas semanais desta data.
                Você pode adicionar mais de uma janela. Um dia indisponível
                bloqueia todas.
              </p>
              {exceptionType === "imported" && (
                <p className="note-box">
                  Este tipo importado está preservado: {exception?.type}{" "}
                  {exception?.startLocalTime}–{exception?.endLocalTime}. Escolha
                  outro tipo somente se quiser convertê-lo. Para manter
                  exatamente o registro, feche a edição.
                </p>
              )}
            </>
          )}
          {(spec.kind === "rule" ||
            (spec.kind === "exception" &&
              ["r02-janela", "unavailable-window"].includes(
                exceptionType,
              ))) && (
            <div className="two-col">
              <div className="field">
                <label htmlFor="window-start">Início</label>
                <input
                  id="window-start"
                  name="startLocalTime"
                  type="time"
                  required
                  defaultValue={
                    rule?.startLocalTime || exception?.startLocalTime || "14:00"
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="window-end">Fim</label>
                <input
                  id="window-end"
                  name="endLocalTime"
                  type="time"
                  required
                  defaultValue={
                    rule?.endLocalTime || exception?.endLocalTime || "16:00"
                  }
                />
              </div>
            </div>
          )}
        </fieldset>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {deleting ? (
          <div className="note-box">
            <p>
              Excluir {label}?{" "}
              {spec.kind === "task"
                ? "A tarefa, seus blocos e suas decisões de planejamento serão removidos."
                : "Esta alteração será salva no espaço atual."}
            </p>
            <div className="head-actions">
              <Button disabled={busy} onClick={() => setDeleting(false)}>
                Manter
              </Button>
              <Button
                kind="danger"
                disabled={busy}
                onClick={() => void remove()}
              >
                Confirmar exclusão
              </Button>
            </div>
          </div>
        ) : (
          spec.id &&
          spec.kind !== "subject" && (
            <Button
              kind="danger small"
              onClick={() => setDeleting(true)}
              disabled={busy}
            >
              Excluir {label}
            </Button>
          )
        )}
        <div className="modal-actions">
          <Button onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button
            type="submit"
            kind="primary"
            disabled={
              busy ||
              (spec.kind === "exception" && exceptionType === "imported")
            }
          >
            {busy ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
