import { STORE_NAMES, validateSubject, validateTask } from "./model.js";
export function canonicalize(value, path = "$") {
    if (value === null || typeof value === "string" || typeof value === "boolean")
        return JSON.stringify(value);
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            throw new Error("Número não finito no backup.");
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        const items = [];
        for (let i = 0; i < value.length; i++) {
            if (!(i in value) || value[i] === undefined) {
                throw new Error(`Valor ausente ou indefinido em array do backup em ${path}[${i}].`);
            }
            items.push(canonicalize(value[i], `${path}[${i}]`));
        }
        return `[${items.join(",")}]`;
    }
    if (typeof value === "object") {
        const obj = value;
        const prototype = Object.getPrototypeOf(obj);
        if (prototype !== Object.prototype && prototype !== null) {
            throw new Error(`Objeto não permitido no backup em ${path} (${Object.prototype.toString.call(obj)}).`);
        }
        // IndexedDB pode preservar propriedades opcionais com valor undefined.
        // JSON.stringify omite essas propriedades em objetos; o hash deve seguir
        // a mesma representação para que exportação e importação coincidam.
        const keys = Object.keys(obj).filter(k => obj[k] !== undefined).sort();
        return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalize(obj[k], `${path}.${k}`)}`).join(",")}}`;
    }
    throw new Error(`Tipo não permitido no backup em ${path} (typeof ${typeof value}).`);
}
export async function sha256Hex(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}
export async function createBackup(data) {
    const dataDigestHex = await sha256Hex(canonicalize(data));
    return {
        product: "CAMPULSO",
        backupFormatVersion: 1,
        dbSchemaVersion: 2,
        exportedAtUtc: new Date().toISOString(),
        appVersion: "0.1.8-poc001",
        data,
        integrity: { algorithm: "SHA-256", canonicalization: "CAMPULSO-CJSON-1", dataDigestHex }
    };
}
export async function validateBackup(value) {
    if (!value || typeof value !== "object")
        throw new Error("Arquivo JSON inválido.");
    const b = value;
    if (b.product !== "CAMPULSO")
        throw new Error("O arquivo não é um backup CAMPULSO.");
    if (b.backupFormatVersion !== 1 || b.dbSchemaVersion !== 2)
        throw new Error("Versão de backup incompatível.");
    if (!b.data || typeof b.data !== "object")
        throw new Error("Estrutura de dados ausente.");
    if (!b.integrity || b.integrity.algorithm !== "SHA-256" || b.integrity.canonicalization !== "CAMPULSO-CJSON-1")
        throw new Error("Metadados de integridade incompatíveis.");
    for (const store of STORE_NAMES) {
        if (!Array.isArray(b.data[store]))
            throw new Error(`Coleção ausente ou inválida: ${store}.`);
    }
    const actual = await sha256Hex(canonicalize(b.data));
    if (actual !== b.integrity.dataDigestHex)
        throw new Error("A verificação SHA-256 falhou. Nenhum dado foi alterado.");
    const data = b.data;
    const subjects = new Set();
    const taskIds = new Set();
    for (const s of data.subjects) {
        validateSubject(s);
        if (subjects.has(s.id))
            throw new Error("Disciplina duplicada no backup.");
        subjects.add(s.id);
    }
    for (const t of data.tasks) {
        validateTask(t);
        if (taskIds.has(t.id))
            throw new Error("Tarefa duplicada no backup.");
        taskIds.add(t.id);
        if (t.subjectId && !subjects.has(t.subjectId))
            throw new Error(`A tarefa “${t.title}” aponta para uma disciplina inexistente.`);
    }
    return b;
}
export function emptyBackupData() {
    return {
        preferences: [], subjects: [], commitments: [], deadlines: [], tasks: [],
        availabilityRules: [], availabilityExceptions: [], planRuns: [], planBlocks: [],
        planDecisions: [], appMeta: []
    };
}
export function summarizeBackup(data) {
    return STORE_NAMES.map(store => `${store}: ${data[store].length}`);
}
//# sourceMappingURL=backup.js.map