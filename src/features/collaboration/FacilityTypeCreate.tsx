import { useState } from "react";
import { useApp } from "../../app/context";
import { api, ApiError } from "../../shared/api/client";
import { Button, FieldError } from "../../shared/ui/primitives";
import { Field } from "../organization/shared";
import { recordApi } from "./api";
import { useRecordWrite } from "./hooks";

export function FacilityTypeCreate({ onCreated }: { onCreated: () => void }) {
  const { session } = useApp();
  const [name, setName] = useState(""),
    [days, setDays] = useState("14"),
    [error, setError] = useState<Error>();
  const write = useRecordWrite("facilities");
  if (!session.user.owner) return null;
  async function save() {
    const body = { name: name.trim(), defaultInspectionDays: Number(days) };
    if (
      write.busy ||
      !body.name ||
      !Number.isSafeInteger(body.defaultInspectionDays) ||
      body.defaultInspectionDays < 1
    )
      return;
    setError(undefined);
    try {
      await write.run("facility-types:create", body, async (signal, key) => {
        const result = await api<{ id: string }>("/facility-types", {
          method: "POST",
          body,
          signal,
          key,
        });
        // Verify the created code exists in the canonical list before claiming success.
        const list = await recordApi.types(signal);
        if (!result?.id || !list.items.some((t) => t.id === result.id))
          throw new ApiError(0, {
            code: "INVALID_RESPONSE",
            message: "유형 등록 결과를 확인하지 못했습니다.",
          });
      });
      setName("");
      onCreated();
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError"))
        setError(e as Error);
    }
  }
  return (
    <details>
      <summary>시설 유형 추가 (사장님)</summary>
      <fieldset disabled={write.busy} className="grid gap-3 mt-3">
        <Field label="새 유형 이름">
          <input
            aria-label="새 유형 이름"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="유형 기본 주기 (일)">
          <input
            aria-label="유형 기본 주기 (일)"
            type="number"
            min={1}
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
        </Field>
        <Button
          type="button"
          disabled={!name.trim()}
          onClick={() => void save()}
        >
          유형 등록
        </Button>
      </fieldset>
      {error && <FieldError>{error.message}</FieldError>}
    </details>
  );
}
