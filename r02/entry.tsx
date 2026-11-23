import { createRoot } from "react-dom/client";
import { openDatabase } from "../src/infrastructure/database";
import { loadWorkspace } from "../src/application/workspace";
import { R02App } from "./App";
import { createDemo } from "./demo";
import type { Scenario } from "./view";

const root = createRoot(document.getElementById("app-root")!);
const choice = new URLSearchParams(location.search).get("scenario");
const scenario: Scenario =
  choice === null ? "local" : choice === "local" || choice === "empty" || choice === "overloaded"
    ? choice
    : "planned";
async function start() {
  if (scenario !== "local") {
    root.render(
      <R02App initialData={createDemo(scenario)} scenario={scenario} />,
    );
    return;
  }
  const db = await openDatabase("campulso-poc002-r02");
  try {
    const data = await loadWorkspace(db);
    root.render(<R02App initialData={data} scenario="local" db={db} />);
  } catch (error) {
    db.close();
    throw error;
  }
}
void start().catch((error) =>
  root.render(
    <main className="card" role="alert">
      <h1>Não foi possível abrir seu espaço</h1>
      <p>
        {error instanceof Error
          ? error.message
          : "O armazenamento local não pôde ser acessado."}
      </p>
      <p>
        Os dados não foram substituídos. Confira o espaço disponível e se o
        navegador permite armazenar dados neste endereço.
      </p>
      <button type="button" className="btn" onClick={() => location.reload()}>
        Tentar novamente
      </button>
      <a className="btn" href="?scenario=planned">
        Abrir demonstração
      </a>
      <a className="btn" href="?scenario=empty#privacy">Política de Privacidade</a>
    </main>,
  ),
);
