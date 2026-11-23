export const STORE_NAMES = [
    "preferences", "subjects", "commitments", "deadlines", "tasks",
    "availabilityRules", "availabilityExceptions", "planRuns", "planBlocks",
    "planDecisions", "appMeta"
];
export function validateTask(value) {
    if (!value || typeof value !== "object")
        throw new Error("Tarefa inválida.");
    const t = value;
    if (typeof t.id !== "string" || !t.id.trim())
        throw new Error("Identificador da tarefa inválido.");
    if (typeof t.title !== "string" || !t.title.trim() || t.title.length > 160)
        throw new Error("O título deve ter entre 1 e 160 caracteres.");
    if (!Number.isInteger(t.estimateMinutes) || (t.estimateMinutes ?? 0) < 15)
        throw new Error("A duração estimada mínima é de 15 minutos.");
    if (!Number.isInteger(t.remainingMinutes) || (t.remainingMinutes ?? -1) < 0 || (t.remainingMinutes ?? Infinity) > (t.estimateMinutes ?? 0))
        throw new Error("Tempo restante inválido.");
    if (!["baixa", "media", "alta"].includes(t.importance ?? ""))
        throw new Error("Importância inválida.");
    if (!["aberta", "em_andamento", "concluida"].includes(t.status ?? ""))
        throw new Error("Estado da tarefa inválido.");
    if (!Number.isInteger(t.revision) || (t.revision ?? 0) < 1)
        throw new Error("Revisão da tarefa inválida.");
    if (t.dueDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(t.dueDate))
        throw new Error("Prazo deve usar o formato AAAA-MM-DD.");
}
export function validateSubject(value) {
    if (!value || typeof value !== "object")
        throw new Error("Disciplina inválida.");
    const s = value;
    if (typeof s.id !== "string" || !s.id.trim())
        throw new Error("Identificador da disciplina inválido.");
    if (typeof s.name !== "string" || !s.name.trim() || s.name.length > 120)
        throw new Error("Nome da disciplina inválido.");
    if (!Number.isInteger(s.revision) || (s.revision ?? 0) < 1)
        throw new Error("Revisão da disciplina inválida.");
}
//# sourceMappingURL=model.js.map