import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { router } from "./app/Router";
import { closeStreams } from "./shared/api/stream";
import { useUi } from "./app/store";
import "./app/styles.css";
const query = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: true },
    mutations: { retry: false },
  },
});
function App() {
  const theme = useUi((s) => s.theme),
    notice = useUi((s) => s.notice),
    clear = useUi((s) => s.clearPrivate);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    const expire = () => {
      closeStreams();
      clear();
      void query.cancelQueries({ queryKey: ["data"] });
      query.removeQueries({ queryKey: ["data"] });
      query.setQueryData(["session"], null);
    };
    window.addEventListener("openstudy:session-expired", expire);
    return () =>
      window.removeEventListener("openstudy:session-expired", expire);
  }, [clear]);
  return (
    <>
      <RouterProvider router={router} />
      <div aria-live="polite" aria-atomic="true" role="status">
        {notice && <div className="toast">{notice}</div>}
      </div>
    </>
  );
}
async function bootstrap() {
  if (import.meta.env.VITE_API_MODE === "mock") {
    const { worker } = await import("./mocks/browser");
    await worker.start({ onUnhandledFrame: "bypass", quiet: true });
  } else if ("serviceWorker" in navigator) {
    const workerURL = new URL(
      "mockServiceWorker.js",
      new URL(import.meta.env.BASE_URL, window.location.origin),
    );
    const isPreviousMockWorker = (worker: ServiceWorker | null) => {
      if (!worker) return false;
      const script = new URL(worker.scriptURL);
      return (
        script.origin === workerURL.origin &&
        script.pathname === workerURL.pathname
      );
    };
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations
        .filter((r) =>
          [r.active, r.waiting, r.installing].some(isPreviousMockWorker),
        )
        .map((r) => r.unregister()),
    );
    const recoveryKey = "openstudy:live-worker-recovery";
    if (isPreviousMockWorker(navigator.serviceWorker.controller)) {
      // unregister() does not release the controller of the current document.
      // Navigate once before rendering anything that could request real data.
      let alreadyRetried: boolean;
      try {
        alreadyRetried = sessionStorage.getItem(recoveryKey) === "pending";
        sessionStorage.setItem(recoveryKey, "pending");
      } catch {
        // Without a persistent guard, fail closed instead of risking a reload
        // loop while the old worker can still fabricate successful responses.
        throw new Error(
          "서비스 워커 복구 상태를 저장하지 못했습니다. 이 탭을 닫고 다시 열어 주세요.",
        );
      }
      if (alreadyRetried)
        throw new Error(
          "시연용 서비스 워커를 해제하지 못했습니다. 이 탭을 닫고 다시 열어 주세요.",
        );
      window.location.reload();
      return;
    }
    try {
      sessionStorage.removeItem(recoveryKey);
    } catch {
      // A fresh live page needs no browser storage to release a demo worker.
    }
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <QueryClientProvider client={query}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  );
}
void bootstrap().catch((error) => {
  const root = document.getElementById("root")!;
  root.textContent = `앱을 시작하지 못했습니다. 새로고침 후 다시 시도해 주세요. ${(error as Error).message}`;
});
