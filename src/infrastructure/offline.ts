/// <reference types="vite/client" />

export interface OfflineOptions {
  /** Activate only after the user accepts; the caller decides when to reload. */
  onUpdateReady: (activate: () => Promise<void>) => void;
  onOfflineReady?: () => void;
  onError?: (message: string) => void;
}

/** Register only the production shell. IndexedDB is never handled by the worker. */
export function registerOffline(options: OfflineOptions): void {
  if (!import.meta.env.PROD || typeof window === "undefined") return;
  if (!("serviceWorker" in navigator) || !window.isSecureContext) {
    options.onError?.("Este navegador não oferece a abertura offline. Os dados locais continuam disponíveis enquanto o aplicativo estiver aberto.");
    return;
  }

  void (async () => {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/", updateViaCache: "none",
      });
      let notified: ServiceWorker | null = null;
      const offerUpdate = () => {
        const waiting = registration.waiting;
        if (!waiting || waiting === notified || !navigator.serviceWorker.controller) return;
        notified = waiting;
        options.onUpdateReady(async () => {
          if (registration.waiting !== waiting) {
            throw new Error("Esta atualização já foi aplicada ou mudou. Reabra o aplicativo quando terminar sua edição.");
          }
          await new Promise<void>((resolve, reject) => {
            const onChange = () => { cleanup(); resolve(); };
            const timeout = window.setTimeout(() => {
              cleanup();
              reject(new Error("A atualização ainda não respondeu. Seus dados não foram alterados; tente novamente quando terminar sua edição."));
            }, 15000);
            const cleanup = () => {
              window.clearTimeout(timeout);
              navigator.serviceWorker.removeEventListener("controllerchange", onChange);
            };
            navigator.serviceWorker.addEventListener("controllerchange", onChange);
            waiting.postMessage({ type: "CAMPULSO_ACTIVATE_UPDATE" });
          });
        });
      };
      const watchInstalling = () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed") offerUpdate();
        });
      };
      registration.addEventListener("updatefound", watchInstalling);
      watchInstalling();
      offerUpdate();
      await navigator.serviceWorker.ready;
      options.onOfflineReady?.();
      // No controllerchange listener reloads the page. Other tabs retain forms.
      if (navigator.onLine) void registration.update().catch(() => undefined);
    } catch {
      options.onError?.("Não foi possível preparar a abertura offline. Continue usando o aplicativo e tente reabri-lo com conexão disponível.");
    }
  })();
}
