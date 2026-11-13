import { useTableSort } from "../../shared/ui/table-sort";
import { invalidateReads } from "../../shared/api/invalidateReads";
import { useDraftGuard } from "../../shared/ui/leaveGuard";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { useApp } from "../../app/context";
import { api, queryString, MOCK } from "../../shared/api/client";
import type { components } from "../../shared/api/foundation.generated";
import { permissions } from "../../shared/domain/schema";
import { useIdempotency } from "../../shared/api/useIdempotency";
import {
  Button,
  Badge,
  ErrorState,
  Panel,
  State,
} from "../../shared/ui/primitives";
import { Icon } from "../../shared/ui/Icon";
import {
  ListCard,
  ListFilters,
  ListFooter,
  ListTable,
} from "../../shared/ui/ListLayout";
import { Field, SaveError, useListSearch } from "../organization/shared";
import { rolePermissions } from "../organization/model";
type Invitation = components["schemas"]["Invitation"];
const PAGE_SIZE = 20;
// 초기화 대상: URL의 검색어·페이지(상태 필터는 화면 상태). tab은 남긴다.
const INVITATION_FILTER_KEYS = [
  "invitationSearch",
  "invitationPage",
  "invitationSort",
  "invitationDirection",
];
const expiry = (value: string) => new Date(value).toLocaleString("ko-KR");
export function InvitationManagement() {
  const { session, scope } = useApp(),
    query = useQueryClient(),
    { page, search, setPage, setSearch } = useListSearch("invitation"),
    key = useIdempotency(),
    [, setParams] = useSearchParams();
  const sorting = useTableSort(
    { sort: "createdAt", direction: "desc" },
    "invitation",
  );
  const [error, setError] = useState<Error | null>(null),
    [busy, setBusy] = useState(false),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [reason, setReason] = useState(""),
    [filter, setFilter] = useState(""),
    [creating, setCreating] = useState(false);
  const rejection = useDraftGuard(reason);
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
      sorting.value,
    ],
    queryFn: ({ signal }) =>
      api<components["schemas"]["InvitationPage"]>(
        `/invitations?${queryString({ scope, page, pageSize: PAGE_SIZE, q: search, status: filter, ...sorting.value })}`,
        { signal },
      ),
    retry: false,
    enabled: managed.length > 0,
  });
  const detailKey = [
    "data",
    session.user.id,
    scope,
    "invitations",
    "detail",
    selectedId,
  ];
  const detail = useQuery({
    queryKey: detailKey,
    queryFn: ({ signal }) =>
      api<Invitation>(
        `/invitations/${encodeURIComponent(selectedId!)}?${queryString({ scope })}`,
        { signal },
      ),
    enabled: managed.length > 0 && selectedId !== null,
    retry: false,
  });
  const selected = selectedId ? detail.data : undefined;
  const commandDisabled = busy || detail.isFetching || detail.isError;
  async function refresh() {
    await invalidateReads(
      query,
      session.user.id,
      "invitations",
      "organization",
      "lookups",
    );
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
      query.setQueryData(detailKey, updated);
      rejection.saved("");
      setReason("");
      await refresh();
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  }
  function openDetail(id: string) {
    if (!rejection.confirm()) return;
    setSelectedId(id);
    setError(null);
    setReason("");
  }
  function closeDetail() {
    if (!rejection.confirm()) return;
    setSelectedId(null);
    setError(null);
    setReason("");
  }
  const branchName = (id: string) =>
    session.branches.find((b) => b.id === id)?.name ?? id;
  if (!managed.length) return <State title="초대 관리 권한이 없어요" />;
  return (
    <section>
      {rejection.guard}
      {MOCK && (
        <p className="help mb-4">데모에서는 이메일을 실제 발송하지 않습니다.</p>
      )}
      <ListCard>
        <ListFilters
          actions={
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Icon name="plus" size={16} />
              직원 초대
            </Button>
          }
        >
          <input
            type="search"
            aria-label="초대 이름·이메일 검색"
            placeholder="초대 이름·이메일 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            aria-label="초대 상태 필터"
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
          <Button
            variant="quiet"
            onClick={() => {
              setFilter("");
              setParams(
                (current) => {
                  const next = new URLSearchParams(current);
                  INVITATION_FILTER_KEYS.forEach((k) => next.delete(k));
                  return next;
                },
                { replace: true },
              );
            }}
          >
            초기화
          </Button>
        </ListFilters>
        <p className="px-5 pb-3 text-xs text-muted">
          초대 상태와 이메일 발송 상태는 별개입니다. 발송 완료만으로 직원이
          활성화되지 않습니다. 회수한 소속은 기존 계정으로 수락 후 승인해야
          복구됩니다.
        </p>
        <ListTable
          label="초대 목록"
          columns={[
            sorting.column("초대 이름", "name"),
            "이메일",
            "지점·역할",
            "초대 상태",
            "발송 상태",
            sorting.column("수락 기한", "expiresAt"),
          ]}
          loading={rows.isPending}
          error={rows.error}
          onRetry={() => void rows.refetch()}
          isEmpty={!rows.data?.items.length}
          empty={{ title: "초대 내역이 없어요" }}
        >
          {rows.data?.items.map((i) => (
            <tr key={i.id}>
              <td>
                <button
                  className="cell-link"
                  disabled={busy}
                  onClick={() => openDetail(i.id)}
                >
                  {i.name}
                </button>
              </td>
              <td>{i.email}</td>
              <td>
                {branchName(i.branchId)}
                <span className="help block">
                  {i.role === "admin" ? "지점 관리자" : "일반 직원"}
                </span>
              </td>
              <td>
                <Badge>{i.status}</Badge>
              </td>
              <td>
                <Badge>{i.delivery}</Badge>
              </td>
              <td>{expiry(i.expiresAt)}</td>
            </tr>
          ))}
        </ListTable>
        <ListFooter
          page={page}
          pageSize={PAGE_SIZE}
          total={rows.data?.meta.total ?? 0}
          loading={rows.isPending}
          error={!!rows.error}
          onChange={setPage}
        />
      </ListCard>
      <Panel
        open={creating}
        onClose={() => setCreating(false)}
        title="직원 초대"
        description="초대 이메일을 보내고, 수락 후 승인하면 직원으로 등록돼요."
      >
        {/* 패널을 닫으면 폼이 사라지므로 입력 중인 초안은 패널의 확인을 거쳐 버린다. */}
        {creating && (
          <InvitationCreateForm
            managed={managed}
            onSaved={async () => {
              setCreating(false);
              await refresh();
            }}
            refresh={refresh}
          />
        )}
      </Panel>
      <Panel
        open={selectedId !== null}
        onClose={closeDetail}
        closeDisabled={busy}
        title="초대 상세"
      >
        {detail.isPending ? (
          <State loading />
        ) : detail.error ? (
          <ErrorState
            error={detail.error}
            retry={() => void detail.refetch()}
          />
        ) : (
          selected && (
            <section className="grid gap-3">
              <h3>{selected.name} 초대 처리</h3>
              <p>
                {selected.status} · {selected.delivery} · 버전{" "}
                {selected.version}
              </p>
              <p className="help">
                {selected.email} · {branchName(selected.branchId)} ·{" "}
                {selected.role === "admin" ? "지점 관리자" : "일반 직원"} · 수락
                기한 {expiry(selected.expiresAt)}
              </p>
              {selected.rejectionReason && (
                <p>반려 사유: {selected.rejectionReason}</p>
              )}
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
                        disabled={commandDisabled}
                        onClick={() => void action(selected, "reissue")}
                      >
                        새 24시간으로 재발급
                      </Button>
                    </>
                  )}
                  {selected.status === "초대 대기" && (
                    <Button
                      disabled={commandDisabled}
                      onClick={() => void action(selected, "cancel")}
                    >
                      초대 취소
                    </Button>
                  )}
                  {selected.status === "승인 대기" && (
                    <>
                      <p className="help">
                        승인 대기에는 별도 수락 기한이 없습니다. 신규 직원은
                        승인 뒤 다시 로그인해야 합니다.
                      </p>
                      <Button
                        disabled={commandDisabled}
                        onClick={() => void action(selected, "approve")}
                      >
                        최종 승인
                      </Button>
                      <Field label="반려 사유">
                        <input
                          disabled={busy}
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          maxLength={1000}
                        />
                      </Field>
                      <Button
                        disabled={commandDisabled || !reason.trim()}
                        onClick={() => void action(selected, "reject")}
                      >
                        초대 반려
                      </Button>
                    </>
                  )}
                </>
              )}
              <SaveError
                error={error}
                refresh={async () => {
                  await refresh();
                }}
              />
            </section>
          )
        )}
      </Panel>
    </section>
  );
}

function InvitationCreateForm({
  managed,
  onSaved,
  refresh,
}: {
  managed: { id: string; name: string; status: string }[];
  onSaved: () => Promise<void>;
  refresh: () => Promise<void>;
}) {
  const { session, scope } = useApp(),
    key = useIdempotency();
  const [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [branchId, setBranch] = useState(scope === "all" ? "" : scope),
    [role, setRole] = useState<"staff" | "admin">("staff"),
    [grants, setGrants] = useState<components["schemas"]["Permissions"]>([]),
    [error, setError] = useState<Error | null>(null),
    [busy, setBusy] = useState(false);
  const leave = useDraftGuard({ name, email, branchId, role, grants });
  return (
    <>
      {leave.guard}
      <form
        className="grid gap-3"
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
            leave.saved({
              name: "",
              email: "",
              branchId,
              role,
              grants,
            });
            setName("");
            setEmail("");
            await onSaved();
          } catch (e) {
            setError(e as Error);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset className="contents" disabled={busy}>
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
          <Button type="submit" variant="primary" disabled={busy}>
            초대 이메일 발송 요청
          </Button>
        </fieldset>
        <SaveError
          error={error}
          refresh={async () => {
            await refresh();
          }}
        />
      </form>
    </>
  );
}
