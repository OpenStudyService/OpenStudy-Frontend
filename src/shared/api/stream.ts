const connections = new Set<() => void>();

/** End private streams synchronously when credentials are revoked. */
export function closeStreams() {
  for (const stop of connections) stop();
}

/** A single connection with bounded backoff and an event cursor across reconnects. */
export function openStream(
  url: string,
  listeners: Record<string, (event: MessageEvent) => void>,
  status: (connected: boolean) => void,
) {
  let source: EventSource | undefined,
    timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false,
    attempt = 0,
    cursor = "";
  function connect() {
    if (stopped) return;
    const target = new URL(url, window.location.origin);
    if (cursor) target.searchParams.set("cursor", cursor);
    const current = new EventSource(target, { withCredentials: true });
    source = current;
    source.onopen = () => {
      if (stopped || source !== current) return;
      attempt = 0;
      status(true);
    };
    for (const [type, listener] of Object.entries(listeners))
      source.addEventListener(type, (event) => {
        if (stopped || source !== current) return;
        const message = event as MessageEvent;
        if (message.lastEventId) cursor = message.lastEventId;
        listener(message);
      });
    source.onerror = () => {
      current.close();
      if (stopped || source !== current) return;
      status(false);
      if (!stopped)
        timer = setTimeout(connect, Math.min(1000 * 2 ** attempt++, 10000));
    };
  }
  connect();
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    source?.close();
    connections.delete(stop);
  };
  connections.add(stop);
  return stop;
}
