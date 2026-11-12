import { hasBlockingReadError } from "../../shared/api/read-model";
import { useDraftGuard } from "../../shared/ui/leaveGuard";
import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { useApp } from "../../app/context";
import { admin, can } from "../../shared/domain/schema";
import { BranchClosures } from "./BranchClosures";
import { api, queryString } from "../../shared/api/client";
import { useIdempotency } from "../../shared/api/useIdempotency";
import { Badge, Button, Heading, Panel } from "../../shared/ui/primitives";
import {
  ListCard,
  ListFilters,
  ListFooter,
  ListTable,
} from "../../shared/ui/ListLayout";
import { organizationRead } from "./api";
import { canManageBranch, defaultHours, hoursError, weekdays } from "./model";
import type { Branch, BranchInput } from "./model";
import {
  ContractNotice,
  Field,
  SaveError,
  useListSearch,
  useOrganizationList,
  useRefreshOrganization,
} from "./shared";

const PAGE_SIZE = 20;

export function BranchManagement() {
  const { session, scope } = useApp();
  return (
    <BranchManagementContent
      key={JSON.stringify([
        session.user.id,
        scope,
        session.user.owner,
        session.user.status,
        session.user.memberships,
      ])}
    />
  );
}
function BranchManagementContent() {
  const { session, scope } = useApp();
  const { page, search, setPage, setSearch } = useListSearch("branch");
  const [, setParams] = useSearchParams();
  const [selected, setSelected] = useState<Branch | "new" | null>(null);
  const [closureBranch, setClosureBranch] = useState<Branch | null>(null);
  const data = useOrganizationList<"BranchPage">(
    `/branches?${queryString({ scope, page, pageSize: PAGE_SIZE, q: search })}`,
  );
  const refresh = useRefreshOrganization();
  return (
    <>
      <Heading
        title="지점 관리"
        description="요일별 운영시간과 지점 정보를 관리해요."
      />
      <ContractNotice />
      <ListCard>
        <ListFilters
          actions={
            session.user.owner && (
              <Button variant="primary" onClick={() => setSelected("new")}>
                지점 등록
              </Button>
            )
          }
        >
          <input
            type="search"
            aria-label="지점 검색"
            placeholder="지점 이름·코드 검색"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Button
            variant="quiet"
            onClick={() =>
              setParams(
                (current) => {
                  const next = new URLSearchParams(current);
                  next.delete("branchSearch");
                  next.delete("branchPage");
                  return next;
                },
                { replace: true },
              )
            }
          >
            초기화
          </Button>
        </ListFilters>
        <ListTable
          label="지점 목록"
          columns={["지점명", "주소", "연락처", "운영시간", "상태", "휴무일"]}
          loading={data.isPending}
          error={!data.data || hasBlockingReadError(data) ? data.error : null}
          onRetry={() => void data.refetch()}
          isEmpty={!data.data?.items.length}
          empty={{
            title: search
              ? "조건에 맞는 지점이 없어요"
              : "등록된 지점이 없어요",
          }}
        >
          {data.data?.items.map((branch) => {
            const closureAction = admin(session.user, branch.id)
              ? "휴무일 관리"
              : "휴무일 보기";
            return (
              <tr key={branch.id}>
                <td>
                  {canManageBranch(session.user, branch.id) ? (
                    <button
                      className="cell-link"
                      aria-label={`지점 수정: ${branch.name}`}
                      onClick={() => setSelected(branch)}
                    >
                      {branch.name}
                    </button>
                  ) : (
                    branch.name
                  )}
                  <span className="help block">{branch.code}</span>
                </td>
                <td>{branch.address}</td>
                <td>{branch.phone}</td>
                <td>{branch.hours}</td>
                <td>
                  <Badge>{branch.status}</Badge>
                </td>
                <td>
                  {can(session.user, branch.id) && (
                    <Button
                      aria-label={`${closureAction}: ${branch.name}`}
                      onClick={() => setClosureBranch(branch)}
                    >
                      {closureAction}
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </ListTable>
        <ListFooter
          page={page}
          pageSize={PAGE_SIZE}
          total={data.data?.meta.total ?? 0}
          loading={data.isPending}
          error={!!data.error}
          onChange={setPage}
        />
      </ListCard>
      <Panel
        open={closureBranch !== null}
        onClose={() => setClosureBranch(null)}
        title={`휴무일 · ${closureBranch?.name ?? ""}`}
      >
        {closureBranch && (
          <BranchClosures key={closureBranch.id} branch={closureBranch} />
        )}
      </Panel>
      <Panel
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected === "new" ? "지점 등록" : "지점 수정"}
      >
        {selected && (
          <BranchForm
            key={selected === "new" ? "new" : selected.id}
            branch={selected === "new" ? undefined : selected}
            scope={scope}
            onSaved={async () => {
              setSelected(null);
              await refresh();
            }}
          />
        )}
      </Panel>
    </>
  );
}
export function BranchForm({
  branch,
  scope,
  onSaved,
}: {
  branch?: Branch;
  scope: string;
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<BranchInput>(() =>
    branch
      ? {
          name: branch.name,
          address: branch.address,
          phone: branch.phone,
          status: branch.status,
          weeklyHours: structuredClone(branch.weeklyHours),
        }
      : {
          name: "",
          address: "",
          phone: "",
          status: "운영 중",
          weeklyHours: defaultHours(),
        },
  );
  const [version, setVersion] = useState(branch?.version),
    [error, setError] = useState<Error | null>(null),
    [busy, setBusy] = useState(false),
    [latest, setLatest] = useState(""),
    [profileSaved, setProfileSaved] = useState(false);
  const leave = useDraftGuard(draft);
  const idempotency = useIdempotency();
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setProfileSaved(false);
    const invalid = hoursError(draft.weeklyHours);
    if (invalid) {
      setError(new Error(invalid));
      return;
    }
    setBusy(true);
    try {
      if (branch) {
        const body = {
          name: draft.name,
          address: draft.address,
          phone: draft.phone,
          weeklyHours: draft.weeklyHours,
        };
        const updated = await api<Branch>(
          `/branches/${branch.id}?${queryString({ scope })}`,
          { method: "PATCH", body: { ...body, version } },
        );
        // Operating status has its own versioned command. Do not combine it with the profile PATCH.
        setVersion(updated.version);
        setProfileSaved(true);
        if (draft.status !== updated.status)
          await api(`/branches/${branch.id}/status?${queryString({ scope })}`, {
            method: "POST",
            body: { version: updated.version, status: draft.status },
          });
      } else
        await api("/branches", {
          method: "POST",
          body: draft,
          key: idempotency.key("create-branch", draft),
        });
      idempotency.committed();
      leave.saved();
      await onSaved();
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="grid gap-4">
      {leave.guard}
      <fieldset className="contents" disabled={busy}>
        {error && profileSaved && (
          <p className="help" role="status">
            지점 기본 정보·운영시간은 저장되었지만 운영 상태는 저장하지
            못했습니다. 최신 내용을 확인한 뒤 다시 시도해 주세요.
          </p>
        )}
        <SaveError
          error={error}
          latest={latest}
          refresh={async () => {
            try {
              const current = await organizationRead<Branch>(
                `/branches/${branch!.id}?${queryString({ scope })}`,
              );
              setVersion(current.version);
              setLatest(
                `${current.name} / ${current.address} / ${current.phone} / ${current.status} / ${current.hours} (v${current.version})`,
              );
            } catch (e) {
              setError(e as Error);
            }
          }}
        />
        {(
          [
            ["name", "지점 이름"],
            ["address", "주소"],
            ["phone", "연락처"],
          ] as const
        ).map(([key, label]) => (
          <Field label={label} key={key}>
            <input
              required={key !== "phone"}
              maxLength={key === "address" ? 300 : key === "phone" ? 30 : 120}
              value={draft[key]}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
            />
          </Field>
        ))}
        <Field label="운영 상태">
          <select
            value={draft.status}
            onChange={(e) =>
              setDraft({
                ...draft,
                status: e.target.value as BranchInput["status"],
              })
            }
          >
            <option>운영 중</option>
            <option>운영 중지</option>
          </select>
        </Field>
        <fieldset>
          <legend>요일별 운영시간</legend>
          <p className="help mb-3">
            분 단위입니다. 00:00=0, 24:00=1440, 익일 02:00=1560. 휴무는
            시작·종료를 저장하지 않습니다.
          </p>
          {draft.weeklyHours.map((hours, index) => (
            <div
              key={hours.weekday}
              className="mb-3 flex flex-wrap items-center gap-3"
            >
              <b>{weekdays[hours.weekday - 1]}요일</b>
              <label>
                <input
                  type="checkbox"
                  checked={hours.isClosed}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      weeklyHours: draft.weeklyHours.map((h, i) =>
                        i !== index
                          ? h
                          : {
                              ...h,
                              isClosed: e.target.checked,
                              opensMinute: e.target.checked ? null : 0,
                              closesMinute: e.target.checked ? null : 1440,
                            },
                      ),
                    })
                  }
                />{" "}
                휴무
              </label>
              {!hours.isClosed &&
                (
                  [
                    ["opensMinute", "시작"],
                    ["closesMinute", "종료"],
                  ] as const
                ).map(([key, label]) => (
                  <Field
                    key={key}
                    label={`${weekdays[index]}요일 ${label}(분)`}
                  >
                    <input
                      type="number"
                      required
                      min={key === "opensMinute" ? 0 : 1}
                      max={key === "opensMinute" ? 1439 : 2880}
                      value={hours[key] ?? ""}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          weeklyHours: draft.weeklyHours.map((h, i) =>
                            i === index
                              ? {
                                  ...h,
                                  [key]:
                                    e.target.value === ""
                                      ? null
                                      : Number(e.target.value),
                                }
                              : h,
                          ),
                        })
                      }
                    />
                  </Field>
                ))}
            </div>
          ))}
        </fieldset>
        <Button type="submit" disabled={busy}>
          {busy ? "저장 중" : "지점 저장"}
        </Button>
      </fieldset>
    </form>
  );
}
