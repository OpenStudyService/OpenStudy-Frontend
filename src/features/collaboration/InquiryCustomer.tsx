import { useEffect, useRef, useState } from "react";
import { useApp } from "../../app/context";
import { seatApi } from "../seats/api";
import { CustomerSelector } from "../payments/shared";
import { Button, FieldError } from "../../shared/ui/primitives";
import { Field } from "../organization/shared";

/** Exact lookup is recorded by Backend for this actor and branch; an arbitrary ID is never accepted. */
export function InquiryCustomer({
  branchId,
  value,
  onChange,
}: {
  branchId: string;
  value: string;
  onChange: (id: string) => void;
}) {
  const { session } = useApp();
  const [mode, setMode] = useState("search"),
    [kind, setKind] = useState("memberNo"),
    [text, setText] = useState("");
  const [items, setItems] = useState<
      { id: string; name: string; memberNo: string }[]
    >([]),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  function clearLookup() {
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setItems([]);
    setError("");
    onChange("");
  }
  async function lookup() {
    if (!branchId || controller.current) return;
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setError("");
    setItems([]);
    try {
      const result = await seatApi.lookup(
        { branchId, [kind]: text },
        current.signal,
      );
      current.signal.throwIfAborted();
      setItems(result.items.map((i) => i.customer));
      if (!result.items.length) setError("정확히 일치하는 고객이 없습니다.");
    } catch (e) {
      if (!current.signal.aborted) setError((e as Error).message);
    } finally {
      if (!current.signal.aborted) {
        controller.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <div className="grid gap-3">
      <Field label="고객 선택 방법">
        <select
          aria-label="고객 선택 방법"
          value={mode}
          onChange={(e) => {
            setMode(e.target.value);
            clearLookup();
          }}
        >
          <option value="search">허용된 고객 검색</option>
          <option value="exact">회원번호·연락처 정확 일치</option>
        </select>
      </Field>
      {mode === "search" ? (
        <CustomerSelector value={value} onChange={onChange} />
      ) : (
        <>
          <Field label="정확 일치 기준">
            <select
              aria-label="정확 일치 기준"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                clearLookup();
              }}
            >
              <option value="memberNo">회원번호</option>
              <option value="phone">연락처</option>
            </select>
          </Field>
          <Field label="정확 일치 검색어">
            <input
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                clearLookup();
              }}
            />
          </Field>
          <Button
            type="button"
            disabled={busy || !branchId || !text.trim()}
            onClick={() => void lookup()}
          >
            정확 일치 조회
          </Button>
          <Field label="조회된 고객">
            <select
              aria-label="조회된 고객"
              required
              value={value}
              onChange={(e) => onChange(e.target.value)}
            >
              <option value="">고객 선택</option>
              {items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.memberNo}
                </option>
              ))}
            </select>
          </Field>
          {error && <FieldError>{error}</FieldError>}
        </>
      )}
      {!session.user.owner && (
        <p className="help">
          조회 가능한 고객 또는 이 지점에서 정확 일치로 찾은 고객을 선택하세요.
        </p>
      )}
    </div>
  );
}
