import { useEffect, useState } from "react";
import { openDatabase } from "../infrastructure/database.js";
import type { CampulsoDexieDB } from "../infrastructure/database.js";
import { STORE_NAMES } from "../domain/model.js";

const emptyCounts = Object.fromEntries(STORE_NAMES.map((store) => [store, 0])) as Record<(typeof STORE_NAMES)[number], number>;

export function App() {
  const [status, setStatus] = useState("Aguardando abertura do banco isolado…");
  const [counts, setCounts] = useState(emptyCounts);
  const [db, setDb] = useState<CampulsoDexieDB | null>(null);

  useEffect(() => {
    let active = true;
    let opened: CampulsoDexieDB | null = null;

    void openDatabase().then(async (database) => {
      opened = database;
      const currentCounts = await database.counts();
      if (!active) {
        database.close();
        return;
      }
      setDb(database);
      setCounts(currentCounts);
      setStatus("Banco Dexie aberto. Esta base é isolada e não contém dados da POC-001.");
    }).catch((error: unknown) => {
      if (active) setStatus(error instanceof Error ? error.message : "Falha ao abrir o banco Dexie.");
    });

    return () => {
      active = false;
      opened?.close();
    };
  }, []);

  async function refresh() {
    if (!db) return;
    setCounts(await db.counts());
    setStatus("Contagens relidas do banco Dexie.");
  }

  return (
    <main className="diagnostic-shell">
      <header className="diagnostic-header">
        <p className="eyebrow">CAMPULSO · ETAPA 5</p>
        <h1>Integração React + Dexie</h1>
        <p>POC-002 · ambiente técnico isolado · interface R02 preservada</p>
      </header>
      <nav aria-label="Interface R02"><a href="/index.html">Abrir a interface R02</a></nav>
      <section className="status-panel" aria-live="polite">
        <strong>Estado da persistência</strong>
        <p>{status}</p>
        <button type="button" onClick={() => void refresh()} disabled={!db}>Atualizar diagnóstico</button>
      </section>
      <section className="stores-panel" aria-labelledby="stores-title">
        <h2 id="stores-title">Coleções locais</h2>
        <dl>
          {STORE_NAMES.map((store) => (
            <div className="store-row" key={store}>
              <dt>{store}</dt>
              <dd>{counts[store]}</dd>
            </div>
          ))}
        </dl>
      </section>
      <p className="diagnostic-note">
        Esta tela serve somente para validar a camada React/Vite/Dexie. Não é a interface final do CAMPULSO,
        não importa dados automaticamente e não altera a POC-001 nem a R02 aprovada.
      </p>
    </main>
  );
}
