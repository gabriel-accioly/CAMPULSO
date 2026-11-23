import { describe, it, expect } from "vitest";
import { isValidInstant, validateSubject } from "../src/domain/model";
import {
  createBackup,
  emptyBackupData,
  validateBackup,
} from "../src/domain/backup";
describe("datas e metadados importados", () => {
  it("aceita instantes com fuso explícito sem normalizar data civil impossível", () => {
    for (const value of [
      "2026-11-23T11:00:00Z",
      "2024-02-29T08:00:00.000-03:00",
      "2026-11-23T11:00+00:00",
    ])
      expect(isValidInstant(value)).toBe(true);
    for (const value of [
      "2026-02-30T11:00:00Z",
      "2025-02-29T11:00:00Z",
      "2026-04-31T11:00:00Z",
      "2026-11-23T24:00:00Z",
      "2026-11-23T11:00:00",
      "2026-11-23T11:60:00Z",
    ])
      expect(isValidInstant(value)).toBe(false);
  });
  it("rejeita data de arquivamento inválida sem tratar objeto como disciplina arquivada válida", () => {
    const subject = {
      id: "s",
      name: "Disciplina",
      createdAtUtc: "2026-11-23T11:00:00Z",
      revision: 1,
    };
    expect(() =>
      validateSubject({ ...subject, archivedAtUtc: "2026-02-30T11:00:00Z" }),
    ).toThrow(/arquivamento/);
    expect(() => validateSubject({ ...subject, archivedAtUtc: {} })).toThrow(
      /arquivamento/,
    );
  });
  it("mantém o contrato e digest de um JSON válido sem reescrever instantes", async () => {
    const data = emptyBackupData();
    data.subjects.push({
      id: "s",
      name: "Disciplina",
      createdAtUtc: "2024-02-29T08:00:00-03:00",
      revision: 1,
    });
    const backup = await createBackup(data, {
      appVersion: "0.2.0",
      exportedAtUtc: "2026-11-23T11:00:00Z",
    });
    expect(await validateBackup(JSON.parse(JSON.stringify(backup)))).toEqual(
      backup,
    );
  });
});
