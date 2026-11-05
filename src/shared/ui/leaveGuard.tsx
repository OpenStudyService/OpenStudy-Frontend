import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode, RefObject } from "react";
import { UNSAFE_DataRouterContext, useBlocker } from "react-router";

type Registry = Set<RefObject<boolean>>;
const NavigationDrafts = createContext<Registry | null>(null);
export const PanelDrafts = createContext<Registry | null>(null);
export const leaveMessage =
  "저장하지 않은 변경사항이 있어요. 입력을 버리고 이동할까요?";

export function confirmDiscard(drafts: Registry, clear = true) {
  if (![...drafts].some((draft) => draft.current)) return true;
  if (!window.confirm(leaveMessage)) return false;
  if (clear)
    drafts.forEach((draft) => {
      draft.current = false;
    });
  return true;
}

function RouterGuard({ drafts }: { drafts: Registry }) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search ||
        currentLocation.hash !== nextLocation.hash) &&
      !["/login", "/pending-approval"].includes(nextLocation.pathname) &&
      [...drafts].some((draft) => draft.current),
  );
  useEffect(() => {
    if (blocker.state === "blocked") {
      if (confirmDiscard(drafts)) blocker.proceed();
      else blocker.reset();
    }
  }, [blocker, drafts]);
  return null;
}

export function useConfirmDiscard() {
  const drafts = useContext(NavigationDrafts);
  return () => !drafts || confirmDiscard(drafts, false);
}

export function UnsavedChangesBoundary({ children }: { children: ReactNode }) {
  const [drafts] = useState<Registry>(() => new Set());
  return (
    <NavigationDrafts.Provider value={drafts}>
      <RouterGuard drafts={drafts} />
      {children}
    </NavigationDrafts.Provider>
  );
}

function Registration({ dirty }: { dirty: RefObject<boolean> }) {
  const navigation = useContext(NavigationDrafts);
  const panel = useContext(PanelDrafts);
  const router = useContext(UNSAFE_DataRouterContext);
  const [fallback] = useState<Registry>(() => new Set([dirty]));
  useEffect(() => {
    navigation?.add(dirty);
    panel?.add(dirty);
    return () => {
      navigation?.delete(dirty);
      panel?.delete(dirty);
    };
  }, [navigation, panel, dirty]);
  return router && !navigation ? <RouterGuard drafts={fallback} /> : null;
}

export function useLeaveGuard(changed: boolean, revision?: string) {
  const dirty = useRef(changed);
  useEffect(() => {
    dirty.current = changed;
  }, [changed, revision]);
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, []);
  return {
    guard: <Registration dirty={dirty} />,
    confirm: () => confirmDiscard(new Set([dirty])),
    saved: (keepChanges = false) => {
      dirty.current = keepChanges;
    },
  };
}

// Draft values stay in component memory; successful writes establish a new baseline.
export function useDraftGuard(value: unknown) {
  const serialized = JSON.stringify(value);
  const [baseline, setBaseline] = useState(serialized);
  const latest = useRef(serialized);
  useLayoutEffect(() => {
    latest.current = serialized;
  }, [serialized]);
  const leave = useLeaveGuard(serialized !== baseline, baseline);
  return {
    guard: leave.guard,
    confirm: leave.confirm,
    saved: (nextValue: unknown = value) => {
      // A delayed success must not clear edits made after the submitted snapshot.
      leave.saved(latest.current !== serialized);
      setBaseline(JSON.stringify(nextValue));
    },
  };
}
