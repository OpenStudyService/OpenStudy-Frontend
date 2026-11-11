import { useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { useUi } from "./store";

export function AppRuntime({ query }: { query: QueryClient }) {
  const theme = useUi((s) => s.theme),
    notice = useUi((s) => s.notice),
    clear = useUi((s) => s.clearPrivate);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    const expire = (event: Event) => {
      const expired =
        (event as CustomEvent<string>).detail === "SESSION_EXPIRED" &&
        (!!query.getQueryData(["session"]) ||
          /^\/(app(?:\/|$)|pending-approval\/?$)/.test(
            window.location.pathname,
          ));
      clear();
      void query.cancelQueries();
      query.removeQueries({
        predicate: (entry) => entry.queryKey[0] !== "session",
      });
      query.getMutationCache().clear();
      query.setQueryData(["session"], null);
      if (expired)
        useUi.getState().toast("세션이 만료됐어요. 다시 로그인해 주세요.");
    };
    window.addEventListener("openstudy:session-expired", expire);
    return () =>
      window.removeEventListener("openstudy:session-expired", expire);
  }, [clear, query]);
  return (
    <div aria-live="polite" aria-atomic="true" role="status">
      {notice && <div className="toast">{notice}</div>}
    </div>
  );
}
