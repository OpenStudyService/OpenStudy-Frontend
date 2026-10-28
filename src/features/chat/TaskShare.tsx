import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "../../app/context";
import { useIdempotency } from "../../shared/api/useIdempotency";
import { Button, ErrorState, FieldError } from "../../shared/ui/primitives";
import type { Task } from "../../shared/domain/schema";
import { useTaskWrite } from "../tasks/hooks";
import { chatApi } from "./api";

export function TaskShare({
  task,
  onSaved,
}: {
  task: Task;
  onSaved: () => void;
}) {
  const { session, scope } = useApp(),
    [channelId, setChannel] = useState(""),
    [error, setError] = useState<Error | null>(null),
    write = useTaskWrite(),
    ids = useIdempotency();
  const channels = useQuery({
    queryKey: ["data", session.user.id, scope, "chat", "channels"],
    queryFn: ({ signal }) => chatApi.channels(scope, signal),
    retry: false,
  });
  const eligible =
    channels.data?.filter(
      (c) => c.kind === "channel" && c.participantIds.includes(session.user.id),
    ) ?? [];
  async function share(event: React.FormEvent) {
    event.preventDefault();
    if (write.busy || !eligible.some((c) => c.id === channelId)) return;
    const clientMessageId = ids.key("task-share", {
      channelId,
      taskId: task.id,
    });
    const body = {
      text: "업무를 공유했어요.",
      taskId: task.id,
      parentId: "",
      clientMessageId,
    };
    try {
      await write.run(`task-share/${task.id}`, body, (signal) =>
        chatApi.send(channelId, body, signal),
      );
      ids.committed();
      onSaved();
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError"))
        setError(e as Error);
    }
  }
  return (
    <form className="form-grid" onSubmit={share}>
      <label className="field">
        <span>공유할 채널</span>
        <select
          aria-label="공유할 채널"
          value={channelId}
          disabled={channels.isPending || !!channels.error || write.busy}
          onChange={(e) => setChannel(e.target.value)}
        >
          <option value="">참여 중인 채널을 선택해 주세요</option>
          {eligible.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {channels.isPending && (
        <p role="status">참여 중인 채널을 확인하고 있어요.</p>
      )}
      {channels.error && (
        <ErrorState
          error={channels.error}
          retry={() => void channels.refetch()}
        />
      )}
      {channels.isSuccess && !eligible.length && (
        <p className="help">공유 가능한 참여 채널이 없어요.</p>
      )}
      {error && <FieldError>{error.message}</FieldError>}
      <Button
        type="submit"
        variant="primary"
        disabled={
          write.busy ||
          !eligible.some((c) => c.id === channelId) ||
          !!channels.error
        }
      >
        {write.busy ? "처리 중…" : "운영 채널에 공유"}
      </Button>
    </form>
  );
}
