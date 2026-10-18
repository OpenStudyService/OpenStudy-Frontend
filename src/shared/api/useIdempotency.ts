import { useRef } from "react";

/** Keep a logical write's key on retry, including when its response was lost. */
export function useIdempotency() {
  const pending = useRef(new Map<string, string>());
  return {
    key: (operation: string, body: unknown) => {
      const fingerprint = JSON.stringify([operation, body]);
      let key = pending.current.get(fingerprint);
      if (!key) {
        key = crypto.randomUUID();
        pending.current.set(fingerprint, key);
      }
      return key;
    },
    committed: () => pending.current.clear(),
  };
}
