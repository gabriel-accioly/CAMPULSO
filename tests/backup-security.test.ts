import { describe, expect, it } from "vitest";
import {
  BACKUP_LIMITS,
  createBackup,
  emptyBackupData,
  validateBackup,
  validateBackupData,
} from "../src/domain/backup.js";

const metadata = {
  exportedAtUtc: "2026-11-22T12:00:00.000Z",
  appVersion: "0.2.0",
};

describe("limites defensivos do backup", () => {
  it("aceita um backup vazio válido", async () => {
    const backup = await createBackup(emptyBackupData(), metadata);
    await expect(validateBackup(backup)).resolves.toEqual(backup);
  });

  it("rejeita coleções acima do limite antes da validação por registro", () => {
    const data = emptyBackupData();
    data.appMeta = Array.from({ length: BACKUP_LIMITS.maxRowsPerStore + 1 }, (_, i) => ({ key: `k${i}`, value: "v" }));
    expect(() => validateBackupData(data)).toThrow(/excede o limite/);
  });

  it("rejeita árvores JSON excessivamente profundas", () => {
    const data = emptyBackupData() as unknown as Record<string, unknown>;
    let nested: Record<string, unknown> = {};
    const root = nested;
    for (let i = 0; i < BACKUP_LIMITS.maxObjectDepth + 2; i += 1) {
      const child: Record<string, unknown> = {};
      nested.next = child;
      nested = child;
    }
    data.unexpectedNested = root;
    expect(() => validateBackupData(data)).toThrow(/profundidade máxima/);
  });

  it("rejeita propriedades desconhecidas no envelope", async () => {
    const backup = await createBackup(emptyBackupData(), metadata);
    await expect(validateBackup({ ...backup, injected: true })).rejects.toThrow(/propriedades não reconhecidas/);
  });

  it("rejeita propriedades desconhecidas nos metadados de integridade", async () => {
    const backup = await createBackup(emptyBackupData(), metadata);
    await expect(validateBackup({ ...backup, integrity: { ...backup.integrity, extra: "x" } })).rejects.toThrow(/integridade contém propriedades/);
  });

  it("rejeita tipo de exceção de disponibilidade desconhecido", () => {
    const data = emptyBackupData();
    data.availabilityExceptions.push({ id: "e1", localDate: "2026-11-23", type: "unknown" });
    expect(() => validateBackupData(data)).toThrow(/Tipo de exceção/);
  });

  it("rejeita parâmetros de decisão aninhados ou não escalares", () => {
    const data = emptyBackupData();
    data.planRuns.push({
      id: "run1", createdAtUtc: "2026-11-22T12:00:00.000Z", algorithmVersion: "1",
      inputRevision: 1, mode: "normal", status: "proposta", summary: "x", reasonCodes: [],
    });
    data.planDecisions.push({
      id: "d1", planRunId: "run1", code: "x", messageKey: "x",
      parameters: { nested: { value: 1 } as never },
    });
    expect(() => validateBackupData(data)).toThrow(/parâmetro da decisão inválido/);
  });
});

describe("contrato da Correção 002", () => {
  it.each([
    ["", false], [" ", false], ["x", true], ["x".repeat(100), true], ["x".repeat(101), false],
  ] as const)("valida o código de motivo %j", (code, valid) => {
    const data = emptyBackupData();
    data.planRuns.push({
      id: "r", createdAtUtc: metadata.exportedAtUtc, inputRevision: 1, mode: "normal",
      status: "aplicado", algorithmVersion: "1", summary: "", reasonCodes: [code],
    });
    if (valid) expect(() => validateBackupData(data)).not.toThrow();
    else expect(() => validateBackupData(data)).toThrow(/planejamento/);
  });

  it.each(["disponivel", "replacement", "replace", "available", "r02-janela", "unavailable", "blocked", "block"])(
    "mantém tipo histórico %s e o digest na ida e volta", async (type) => {
      const data = emptyBackupData();
      data.availabilityExceptions.push({ id: "exc", type, localDate: "2026-11-23" });
      const envelope = await createBackup(data, metadata);
      const restored = await validateBackup(JSON.parse(JSON.stringify(envelope)));
      expect(restored.data.availabilityExceptions).toEqual(data.availabilityExceptions);
      expect((await createBackup(restored.data, metadata)).integrity).toEqual(envelope.integrity);
    },
  );

  it("preserva a cópia de um tipo local ainda não interpretado e recusa a importação", async () => {
    const data = emptyBackupData();
    data.availabilityExceptions.push({ id: "local", type: "future-extension", localDate: "2026-11-23" });
    const copy = await createBackup(data, metadata);
    expect(copy.data).toEqual(data);
    await expect(validateBackup(copy)).rejects.toThrow(/Tipo de exceção/);
  });

  it("rejeita metadados de versão excessivos mesmo com digest de dados válido", async () => {
    const copy = await createBackup(emptyBackupData(), metadata);
    await expect(validateBackup({ ...copy, appVersion: "x".repeat(4097) })).rejects.toThrow(/Versão/);
  });
});
