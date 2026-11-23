import { Buffer } from "node:buffer";
import { beforeAll, expect, it } from "vitest";
import { createBackup, createBackupFile, emptyBackupData } from "../src/domain/backup";
import type { CampulsoBackup } from "../src/domain/model";
import { parseBackupText } from "../src/application/workspace";
import { downloadJson } from "../r02/view";

const fileLimit = 20 * 1024 * 1024;
let atLimit: CampulsoBackup;

beforeAll(async () => {
  const metadata = { exportedAtUtc: "2026-11-22T12:00:00Z", appVersion: "0.2.1" };
  const data = emptyBackupData();
  data.appMeta = Array.from({ length: 6_000 }, (_, index) => ({ key: String(index), value: "v" }));
  const envelope = await createBackup(data, metadata);
  let bytesLeft = fileLimit - Buffer.byteLength(JSON.stringify(envelope));
  // Fill valid metadata rows with UTF-8 text. Each row stays below 2,000 characters.
  for (const row of data.appMeta) {
    if (!bytesLeft) break;
    const budget = Math.min(bytesLeft, 5_700);
    row.value += "学".repeat(Math.floor(budget / 3)) + "a".repeat(budget % 3);
    bytesLeft -= budget;
  }
  atLimit = await createBackup(data, metadata);
});

it("reimporta os bytes efetivamente exportados no limite de 20 MiB", async () => {
  const file = createBackupFile(atLimit);
  expect(file.size).toBe(fileLimit);
  const restored = await parseBackupText(await file.text());
  expect(restored.integrity.dataDigestHex).toBe(atLimit.integrity.dataDigestHex);
  expect(restored.data.appMeta).toHaveLength(6_000);
});

it("interrompe o download de recuperação quando um byte excede o limite", () => {
  // appVersion is outside the data digest. The envelope and digest remain valid.
  const aboveLimit = { ...atLimit, appVersion: atLimit.appVersion + "1" };
  expect(() => downloadJson(aboveLimit, "CAMPULSO-antes-da-restauracao.json")).toThrow(/20 MiB/);
});
