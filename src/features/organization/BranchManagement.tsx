import { useState, type FormEvent } from "react";
import { useApp } from "../../app/context";
import { api, queryString } from "../../shared/api/client";
import { useIdempotency } from "../../shared/api/useIdempotency";
import {
  Badge,
  Button,
  ErrorState,
  Heading,
  Panel,
  State,
} from "../../shared/ui/primitives";
import { organizationRead } from "./api";
import { canManageBranch, defaultHours, hoursError, weekdays } from "./model";
import type { Branch, BranchInput } from "./model";
import {
  ContractNotice,
  Field,
  Pager,
  SaveError,
  useListSearch,
  useOrganizationList,
  useRefreshOrganization,
} from "./shared";

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
  const [selected, setSelected] = useState<Branch | "new" | null>(null);
  const data = useOrganizationList<"BranchPage">(
    `/branches?${queryString({ scope, page, pageSize: 20, q: search })}`,
  );
  const refresh = useRefreshOrganization();
  return (
    <section className="card mb-5 p-5">
      <Heading
        title="지점 설정"
        description="7요일 운영시간과 지점 정보를 관리해요."
      >
        {session.user.owner && (
          <Button onClick={() => setSelected("new")}>지점 등록</Button>
        )}
      </Heading>
      <ContractNotice />
      <Field label="지점 검색">
        <input value={search} onChange={(e) => setSearch(e.target.value)} />
      </Field>
      {data.isPending ? (
        <State loading />
      ) : data.error ? (
        <ErrorState error={data.error} retry={() => void data.refetch()} />
      ) : (
        <>
          {!data.data.items.length && <State title="등록된 지점이 없어요" />}
          {data.data.items.map((branch) => (
            <article
              className="my-3 rounded-xl border border-line p-4"
              key={branch.id}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3>{branch.name}</h3>
                  <p className="help">
                    {branch.code} · {branch.address} · {branch.phone}
                  </p>
                  <p className="help">{branch.hours}</p>
                  <Badge>{branch.status}</Badge>
                </div>
                {canManageBranch(session.user, branch.id) && (
                  <Button onClick={() => setSelected(branch)}>
                    지점 수정: {branch.name}
                  </Button>
                )}
              </div>
            </article>
          ))}
          <Pager page={page} total={data.data.meta.total} onChange={setPage} />
        </>
      )}
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
    </section>
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
      await onSaved();
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="grid gap-4">
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
                <Field key={key} label={`${weekdays[index]}요일 ${label}(분)`}>
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
    </form>
  );
}
