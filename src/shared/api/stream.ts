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
    source = new EventSource(target, { withCredentials: true });
    source.onopen = () => {
      attempt = 0;
      status(true);
    };
    for (const [type, listener] of Object.entries(listeners))
      source.addEventListener(type, (event) => {
        const message = event as MessageEvent;
        if (message.lastEventId) cursor = message.lastEventId;
        listener(message);
      });
    source.onerror = () => {
      source?.close();
      status(false);
      if (!stopped)
        timer = setTimeout(connect, Math.min(1000 * 2 ** attempt++, 10000));
    };
  }
  connect();
  return () => {
    stopped = true;
    clearTimeout(timer);
    source?.close();
  };
}
