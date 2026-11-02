import { useContext, useEffect, useRef } from "react";
import { UNSAFE_DataRouterContext, useBlocker } from "react-router";

export const seatLeaveMessage =
  "저장하지 않은 입력이 있어요. 화면을 나가면 입력이 사라집니다. 이동할까요?";
function RouterGuard({ dirty }: { dirty: { current: boolean } }) {
  const blocker = useBlocker(
    ({ nextLocation }) =>
      dirty.current &&
      !["/login", "/pending-approval"].includes(nextLocation.pathname),
  );
  useEffect(() => {
    if (blocker.state === "blocked") {
      if (window.confirm(seatLeaveMessage)) blocker.proceed();
      else blocker.reset();
    }
  }, [blocker]);
  return null;
}
export function useSeatLeaveGuard(changed: boolean) {
  const dirty = useRef(changed);
  const router = useContext(UNSAFE_DataRouterContext);
  useEffect(() => {
    dirty.current = changed;
  }, [changed]);
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
    guard: router ? <RouterGuard dirty={dirty} /> : null,
    saved: () => {
      dirty.current = false;
    },
  };
}
