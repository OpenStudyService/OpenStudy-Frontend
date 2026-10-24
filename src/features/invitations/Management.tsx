import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApp } from "../../app/context";
import { api, queryString, MOCK } from "../../shared/api/client";
import type { components } from "../../shared/api/foundation.generated";
import { permissions } from "../../shared/domain/schema";
import { useIdempotency } from "../../shared/api/useIdempotency";
import { Button, Badge, ErrorState, State } from "../../shared/ui/primitives";
import { Field, Pager, SaveError, useListSearch } from "../organization/shared";
import { rolePermissions } from "../organization/model";
type Invitation = components["schemas"]["Invitation"];
export function InvitationManagement() {
  const { session, scope } = useApp(),
    query = useQueryClient(),
    { page, search, setPage, setSearch } = useListSearch("invitation"),
    key = useIdempotency();
  const [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [branchId, setBranch] = useState(scope === "all" ? "" : scope),
    [role, setRole] = useState<"staff" | "admin">("staff"),
    [grants, setGrants] = useState<components["schemas"]["Permissions"]>([]),
    [error, setError] = useState<Error | null>(null),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<Invitation | null>(null),
    [reason, setReason] = useState(""),
    [filter, setFilter] = useState("");
  const managed = session.branches
    .filter(
      (b) =>
        session.user.owner ||
        session.user.memberships.some(
          (m) =>
            m.branchId === b.id &&
            m.role === "admin" &&
            (!m.status || m.status === "활성") &&
            m.permissions.includes("people:manage"),
        ),
    )
    .filter((b) => scope === "all" || b.id === scope);
  const rows = useQuery({
    queryKey: [
      "data",
      session.user.id,
      scope,
      "invitations",
      page,
      search,
      filter,
    ],
    queryFn: ({ signal }) =>
      api<components["schemas"]["InvitationPage"]>(
        `/invitations?${queryString({ scope, page, pageSize: 20, q: search, status: filter })}`,
        { signal },
      ),
    retry: false,
    enabled: managed.length > 0,
  });
  async function refresh() {
    await query.invalidateQueries({ queryKey: ["data", session.user.id] });
  }
  async function action(i: Invitation, command: string) {
    setBusy(true);
    setError(null);
    try {
      const body =
        command === "reject"
          ? { version: i.version, reason }
          : { version: i.version };
      const updated = await api<Invitation>(
        `/invitations/${i.id}/${command}?${queryString({ scope })}`,
        { method: "POST", body, key: key.key(`${i.id}/${command}`, body) },
      );
      key.committed();
      setSelected(updated);
      setReason("");
      await refresh();
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  }
  if (!managed.length) return <State title="초대 관리 권한이 없어요" />;
  return (
    <section className="grid gap-4">
      <h2>초대·승인 관리</h2>
      {MOCK && (
        <p className="help">데모에서는 이메일을 실제 발송하지 않습니다.</p>
      )}
      <p className="help">
        초대 상태와 이메일 발송 상태는 별개입니다. 발송 완료만으로 직원이
        활성화되지 않습니다. 회수한 소속은 기존 계정으로 수락 후 승인해야
        복구됩니다.
      </p>
      <form
        className="card grid gap-3 p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setBusy(true);
          try {
            const body: components["schemas"]["InvitationCreate"] = {
              name,
              email,
              branchId,
              role,
              permissions: grants,
            };
            await api<Invitation>("/invitations", {
              method: "POST",
              body,
              key: key.key("create", body),
            });
            key.committed();
            setName("");
            setEmail("");
            await refresh();
          } catch (e) {
            setError(e as Error);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h3>직원 초대</h3>
        <Field label="초대 이름">
          <input
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="초대 이메일 (발송 후 변경 불가)">
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="초대 지점">
          <select
            required
            value={branchId}
            onChange={(e) => setBranch(e.target.value)}
          >
            <option value="">지점 선택</option>
            {managed
              .filter((b) => b.status === "운영 중")
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="초대 역할">
          <select
            value={role}
            onChange={(e) => {
              const r = e.target.value as "staff" | "admin";
              setRole(r);
              setGrants(rolePermissions(r));
            }}
          >
            <option value="staff">일반 직원</option>
            {session.user.owner && <option value="admin">지점 관리자</option>}
          </select>
        </Field>
        <fieldset>
          <legend>예정 권한 (선택한 값을 복사하여 승인 시 적용)</legend>
          {permissions
            .filter((p) => role === "admin" || p !== "people:manage")
            .map((p) => (
              <label className="block" key={p}>
                <input
                  type="checkbox"
                  checked={grants.includes(p)}
                  onChange={(e) =>
                    setGrants(
                      e.target.checked
                        ? [...grants, p]
                        : grants.filter((x) => x !== p),
                    )
                  }
                />{" "}
                {p}
              </label>
            ))}
        </fieldset>
        <Button type="submit" disabled={busy}>
          초대 이메일 발송 요청
        </Button>
      </form>
      <Field label="초대 이름·이메일 검색">
        <input value={search} onChange={(e) => setSearch(e.target.value)} />
      </Field>
      <Field label="초대 상태 필터">
        <select
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">전체 상태</option>
          {["초대 대기", "승인 대기", "활성", "거절", "취소", "만료"].map(
            (s) => (
              <option key={s}>{s}</option>
            ),
          )}
        </select>
      </Field>
      {rows.isPending ? (
        <State loading />
      ) : rows.error ? (
        <ErrorState error={rows.error} retry={() => void rows.refetch()} />
      ) : (
        <>
          {!rows.data.items.length && <State title="초대 내역이 없어요" />}
          {rows.data.items.map((i) => (
            <article className="card p-4" key={i.id}>
              <h3>
                {i.name} · {i.email}
              </h3>
              <p>
                {session.branches.find((b) => b.id === i.branchId)?.name} ·{" "}
                {i.role === "admin" ? "지점 관리자" : "일반 직원"}
              </p>
              <Badge>{i.status}</Badge> <Badge>{i.delivery}</Badge>
              <p className="help">
                수락 기한: {new Date(i.expiresAt).toLocaleString("ko-KR")}
              </p>
              {i.rejectionReason && <p>반려 사유: {i.rejectionReason}</p>}
              <Button
                onClick={() => {
                  setSelected(i);
                  setError(null);
                  setReason("");
                }}
              >
                초대 상세: {i.name}
              </Button>
            </article>
          ))}
          <Pager page={page} total={rows.data.meta.total} onChange={setPage} />
        </>
      )}
      {selected && (
        <section className="card grid gap-3 p-4">
          <h3>{selected.name} 초대 처리</h3>
          <p>
            {selected.status} · {selected.delivery} · 버전 {selected.version}
          </p>
          {selected.role === "admin" && !session.user.owner ? (
            <p>지점 관리자 초대 처리는 사장님만 할 수 있습니다.</p>
          ) : (
            <>
              {["초대 대기", "만료"].includes(selected.status) && (
                <>
                  <p className="help">
                    재발급하면 이전 링크는 폐기되고 지금부터 새 24시간이
                    부여됩니다. 자동 메일 재시도는 기한을 연장하지 않습니다.
                  </p>
                  <Button
                    disabled={busy}
                    onClick={() => void action(selected, "reissue")}
                  >
                    새 24시간으로 재발급
                  </Button>
                </>
              )}
              {selected.status === "초대 대기" && (
                <Button
                  disabled={busy}
                  onClick={() => void action(selected, "cancel")}
                >
                  초대 취소
                </Button>
              )}
              {selected.status === "승인 대기" && (
                <>
                  <p className="help">
                    승인 대기에는 별도 수락 기한이 없습니다. 신규 직원은 승인 뒤
                    다시 로그인해야 합니다.
                  </p>
                  <Button
                    disabled={busy}
                    onClick={() => void action(selected, "approve")}
                  >
                    최종 승인
                  </Button>
                  <Field label="반려 사유">
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      maxLength={1000}
                    />
                  </Field>
                  <Button
                    disabled={busy || !reason.trim()}
                    onClick={() => void action(selected, "reject")}
                  >
                    초대 반려
                  </Button>
                </>
              )}
            </>
          )}
          <Button onClick={() => setSelected(null)}>상세 닫기</Button>
        </section>
      )}
      <SaveError
        error={error}
        refresh={async () => {
          if (selected)
            setSelected(
              await api<Invitation>(
                `/invitations/${selected.id}?${queryString({ scope })}`,
              ),
            );
          await refresh();
        }}
      />
    </section>
  );
}
