import { describe, expect, it } from "vitest";
import {
  canonicalize,
  createBackup,
  emptyBackupData,
  validateBackup,
  validateBackupData,
} from "../src/domain/backup.js";
import { validateTask } from "../src/domain/model.js";

const validTask = {
  id: "task-1", title: "Tarefa sintética", estimateMinutes: 30, remainingMinutes: 30,
  importance: "media" as const, status: "aberta" as const,
  createdAtUtc: "2026-11-21T12:00:00.000Z", updatedAtUtc: "2026-11-21T12:00:00.000Z", revision: 1,
};

function sampleData() {
  const data = emptyBackupData();
  data.subjects.push({ id: "subject-1", name: "Disciplina sintética", createdAtUtc: "2026-11-21T12:00:00.000Z", revision: 1 });
  data.tasks.push({ ...validTask, subjectId: "subject-1", dueDate: "2026-11-25" });
  return data;
}

describe("contratos do backup", () => {
  it("canonicaliza objetos independentemente da ordem das chaves", () => {
    expect(canonicalize({ b: 2, a: 1 })).toBe(canonicalize({ a: 1, b: 2 }));
  });

  it("preserva a ordem de arrays e rejeita valores ausentes", () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
    expect(() => canonicalize([undefined])).toThrow(/array/i);
  });

  it("omite undefined em objetos como JSON.stringify", () => {
    expect(canonicalize({ optional: undefined, title: "ok" })).toBe('{"title":"ok"}');
  });

  it("rejeita tarefa inválida e relações órfãs", () => {
    expect(() => validateTask({ ...validTask, estimateMinutes: 10 })).toThrow(/15 minutos/i);
    const data = emptyBackupData();
    data.tasks.push({ ...validTask, subjectId: "missing" });
    expect(() => validateBackupData(data)).toThrow(/disciplina inexistente/i);
  });

  it("mantém o envelope de backup v1 / esquema v2 compatível com a POC-001", async () => {
    const backup = await createBackup(sampleData(), {
      exportedAtUtc: "2026-11-21T12:00:00.000Z",
      appVersion: "0.1.0-poc002",
    });
    const restored = await validateBackup(JSON.parse(JSON.stringify(backup)));
    expect(restored.backupFormatVersion).toBe(1);
    expect(restored.dbSchemaVersion).toBe(2);
    expect(restored.data.tasks[0]?.id).toBe("task-1");
  });

  it("rejeita adulteração sem recalcular o digest", async () => {
    const backup = await createBackup(sampleData(), {
      exportedAtUtc: "2026-11-21T12:00:00.000Z",
      appVersion: "0.1.0-poc002",
    });
    const tampered = structuredClone(backup);
    tampered.data.tasks[0]!.title = "Conteúdo adulterado";
    await expect(validateBackup(tampered)).rejects.toThrow(/SHA-256 falhou/i);
  });
});
