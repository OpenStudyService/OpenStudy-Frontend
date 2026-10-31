import { useEffect, useRef, useState } from "react";

const activeIntents = new Set<string>();
const rememberedKeys = new Map<string, string>();
const storagePrefix = "openstudy:payment-intent:";

async function storageId(fingerprint: string) {
  try {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(fingerprint),
    );
    return (
      storagePrefix +
      Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("")
    );
  } catch {
    return undefined;
  }
}

async function intentKey(fingerprint: string) {
  const storedId = await storageId(fingerprint);
  let key = rememberedKeys.get(fingerprint);
  try {
    if (storedId) key ??= sessionStorage.getItem(storedId) ?? undefined;
  } catch {
    /* Memory fallback when browser storage is unavailable. */
  }
  key ??= crypto.randomUUID();
  rememberedKeys.set(fingerprint, key);
  try {
    if (storedId) sessionStorage.setItem(storedId, key);
  } catch {
    /* Memory fallback. */
  }
  return key;
}

async function committed(fingerprint: string) {
  rememberedKeys.delete(fingerprint);
  const storedId = await storageId(fingerprint);
  try {
    if (storedId) sessionStorage.removeItem(storedId);
  } catch {
    /* Memory fallback. */
  }
}

/** A response loss keeps the intent key; a confirmed result starts a new intent. */
export function useSubmission<TBody, TResult>(
  operation: string,
  submit: (body: TBody, key: string) => Promise<TResult>,
) {
  const busy = useRef(false);
  const lifecycle = useRef(0);
  useEffect(() => {
    lifecycle.current += 1;
    return () => {
      lifecycle.current += 1;
    };
  }, [operation]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [result, setResult] = useState<TResult>();

  async function run(body: TBody): Promise<TResult | undefined> {
    // React state alone cannot prevent two clicks in the same event turn.
    const fingerprint = JSON.stringify([operation, body]);
    const generation = lifecycle.current;
    if (busy.current || activeIntents.has(fingerprint)) return undefined;
    busy.current = true;
    activeIntents.add(fingerprint);
    setPending(true);
    setError(null);
    try {
      const response = await submit(body, await intentKey(fingerprint));
      await committed(fingerprint);
      if (generation !== lifecycle.current) return undefined;
      setResult(response);
      return response;
    } catch (cause) {
      if (generation === lifecycle.current)
        setError(cause instanceof Error ? cause : new Error(String(cause)));
      throw cause;
    } finally {
      busy.current = false;
      activeIntents.delete(fingerprint);
      if (generation === lifecycle.current) setPending(false);
    }
  }

  return { run, pending, error, result };
}
