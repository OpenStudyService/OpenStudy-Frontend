import { useState } from "react";
import { useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "../../app/context";
import { api, queryString } from "../../shared/api/client";
import type { components } from "../../shared/api/foundation.generated";
import { permissions } from "../../shared/domain/schema";
import {
  Badge,
  Button,
  ErrorState,
  Heading,
  Panel,
  State,
} from "../../shared/ui/primitives";
import { InvitationManagement } from "../invitations/Management";
import { organizationRead } from "./api";
import {
  canManageMembership,
  copyPreset,
  membershipBody,
  rolePermissions,
} from "./model";
import type { Employee, Membership, MembershipInput, Preset } from "./model";
import { PresetManagement } from "./PermissionPresets";
import {
  ContractNotice,
  Field,
  Pager,
  SaveError,
  useListSearch,
  useOrganizationList,
  useRefreshOrganization,
} from "./shared";

export function EmployeeManagement() {
  const { session, scope } = useApp();
  return (
    <EmployeeManagementContent
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
function EmployeeManagementContent() {
  const { session, scope } = useApp();
  const { page, search, setPage, setSearch } = useListSearch("employee");
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "invitations" ? "invitations" : "employees";
  const [selected, setSelected] = useState<Employee | null>(null);
  function setTab(next: string) {
    setParams((current) => {
      const updated = new URLSearchParams(current);
      updated.set("tab", next);
      return updated;
    });
  }
  const allowed =
    session.user.owner ||
    session.user.memberships.some(
      (m) =>
        (scope === "all" || m.branchId === scope) &&
        m.role === "admin" &&
        (!m.status || m.status === "활성") &&
        m.permissions.includes("people:manage"),
    );
  const data = useOrganizationList<"EmployeePage">(
    `/employees?${queryString({ scope, page, pageSize: 20, q: search })}`,
    allowed,
  );
  const presets = useOrganizationList<"PermissionPresetPage">(
    "/permission-presets?pageSize=100",
    allowed,
  );
  const definitions = useQuery({
    queryKey: ["data", session.user.id, scope, "organization", "permissions"],
    queryFn: ({ signal }) =>
      organizationRead<components["schemas"]["PermissionDefinition"][]>(
        "/permissions",
        signal,
      ),
    enabled: allowed,
    retry: false,
  });
  const refresh = useRefreshOrganization();
  if (!allowed)
    return (
      <div className="page">
        <State
          title="직원 관리 권한이 없어요"
          message="사장님 또는 직원 관리 권한을 가진 담당 지점 관리자만 이용할 수 있습니다."
        />
      </div>
    );
  return (
    <div className="page">
      <Heading
        title="직원 관리"
        description="계정 공통 정보와 지점별 소속·권한을 구분해서 관리해요."
      />
      <div className="mb-5 flex gap-2">
        <Button
          aria-pressed={tab === "employees"}
          onClick={() => setTab("employees")}
        >
          직원 목록
        </Button>
        <Button
          aria-pressed={tab === "invitations"}
          onClick={() => setTab("invitations")}
        >
          초대·승인
        </Button>
      </div>
      {tab === "invitations" ? (
        <InvitationManagement />
      ) : (
        <>
          <ContractNotice />
          <Field label="직원 이름·이메일 검색">
            <input value={search} onChange={(e) => setSearch(e.target.value)} />
          </Field>
          {data.isPending ? (
            <State loading />
          ) : data.error ? (
            <ErrorState error={data.error} retry={() => void data.refetch()} />
          ) : (
            <>
              {!data.data.items.length && (
                <State title="조회 가능한 직원이 없어요" />
              )}
              {data.data.items.map((employee) => (
                <article className="card my-3 p-4" key={employee.id}>
                  <div className="flex flex-wrap justify-between gap-3">
                    <div>
                      <h2>
                        {employee.name} {employee.owner && "(사장님)"}
                      </h2>
                      <p className="help">{employee.email}</p>
                      <Badge>{employee.status}</Badge>
                      <p className="help">
                        {employee.memberships
                          .map(
                            (m) =>
                              `${session.branches.find((b) => b.id === m.branchId)?.name || m.branchId}: ${m.role === "admin" ? "지점 관리자" : "일반 직원"} · ${m.status}`,
                          )
                          .join(" / ") || "지점 소속 없음"}
                      </p>
                    </div>
                    <Button onClick={() => setSelected(employee)}>
                      직원 상세: {employee.name}
                    </Button>
                  </div>
                </article>
              ))}
              <Pager
                page={page}
                total={data.data.meta.total}
                onChange={setPage}
              />
            </>
          )}
          {presets.error && (
            <ErrorState
              error={presets.error}
              retry={() => void presets.refetch()}
            />
          )}
          {definitions.error && (
            <ErrorState
              error={definitions.error}
              retry={() => void definitions.refetch()}
            />
          )}
          {session.user.owner && presets.data && (
            <PresetManagement
              presets={presets.data.items}
              adminOnly={[
                "people:manage",
                ...(definitions.data
                  ?.filter((p) => p.adminOnly)
                  .map((p) => p.code) || []),
              ]}
              onSaved={refresh}
            />
          )}
        </>
      )}
      <Panel
        open={!!selected}
        onClose={() => setSelected(null)}
        title="직원 상세·권한 관리"
      >
        {selected && (
          <EmployeeDetail
            key={selected.id}
            employee={selected}
            presets={presets.data?.items || []}
            definitions={definitions.data || []}
            onSaved={async () => {
              await refresh();
            }}
          />
        )}
      </Panel>
    </div>
  );
}
export function EmployeeDetail({
  employee: initial,
  presets,
  definitions,
  onSaved,
}: {
  employee: Employee;
  presets: Preset[];
  definitions: components["schemas"]["PermissionDefinition"][];
  onSaved: () => Promise<void>;
}) {
  const { session, scope } = useApp();
  const [employee, setEmployee] = useState(initial);
  async function refresh() {
    const current = await organizationRead<Employee>(
      `/employees/${employee.id}?${queryString({ scope })}`,
    );
    setEmployee(current);
    return current;
  }
  return (
    <div className="grid gap-5">
      <Field label="로그인 이메일 (변경 불가)">
        <input
          aria-label="로그인 이메일 (변경 불가)"
          value={employee.email}
          readOnly
        />
      </Field>
      <p className="help">
        로그인 ID는 변경할 수 없습니다.
        {!session.user.owner &&
          "이름·계정 전체 상태는 사장님만 변경할 수 있습니다."}
      </p>
      {session.user.owner && (
        <EmployeeProfile
          employee={employee}
          refresh={refresh}
          onSaved={async () => {
            await refresh();
            await onSaved();
          }}
        />
      )}
      {employee.memberships.map((m) => (
        <section className="rounded-xl border border-line p-4" key={m.branchId}>
          <h3>
            {session.branches.find((b) => b.id === m.branchId)?.name ||
              m.branchId}
          </h3>
          <Badge>{m.status}</Badge>
          {canManageMembership(session.user, employee, m) ? (
            <MembershipForm
              employee={employee}
              membership={m}
              presets={presets}
              definitions={definitions}
              refresh={refresh}
              onSaved={async () => {
                await refresh();
                await onSaved();
              }}
            />
          ) : (
            <p className="help mt-3">
              {m.status === "회수"
                ? "복구는 재초대 → 본인 수락 → 최종 승인으로 진행합니다."
                : m.status === "승인 대기"
                  ? "승인 대기는 초대·승인 화면에서 처리합니다."
                  : employee.owner
                    ? "사장님 계정의 소속 권한은 여기서 수정할 수 없습니다."
                    : employee.id === session.user.id
                      ? "자신의 권한은 직접 수정할 수 없습니다."
                      : "지점 관리자 소속 변경은 사장님만 처리할 수 있습니다."}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
function EmployeeProfile({
  employee,
  refresh,
  onSaved,
}: {
  employee: Employee;
  refresh: () => Promise<Employee>;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(employee.name),
    [status, setStatus] = useState(employee.status),
    [version, setVersion] = useState(employee.version),
    [error, setError] = useState<Error | null>(null),
    [latest, setLatest] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="grid gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const updated = await api<Employee>(`/employees/${employee.id}`, {
            method: "PATCH",
            body: {
              version,
              name,
              ...(status === "승인 대기" ? {} : { status }),
            } satisfies components["schemas"]["EmployeeUpdate"],
          });
          setVersion(updated.version);
          await onSaved();
        } catch (e) {
          setError(e as Error);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="직원 이름">
        <input
          required
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="계정 전체 상태">
        <select
          value={status}
          disabled={employee.status === "승인 대기"}
          onChange={(e) => setStatus(e.target.value as Employee["status"])}
        >
          {employee.status === "승인 대기" && <option>승인 대기</option>}
          {["활성", "이용 제한", "비활성"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </Field>
      <p className="help">
        이 변경은 모든 지점에 영향을 줍니다. 승인 대기 계정은 여기서 활성화할 수
        없습니다.
      </p>
      <SaveError
        error={error}
        latest={latest}
        refresh={async () => {
          try {
            const current = await refresh();
            setVersion(current.version);
            setLatest(
              `${current.name} / ${current.status} (v${current.version})`,
            );
          } catch (e) {
            setError(e as Error);
          }
        }}
      />
      <Button type="submit" disabled={busy}>
        계정 정보 저장
      </Button>
    </form>
  );
}
export function MembershipForm({
  employee,
  membership,
  presets,
  definitions,
  refresh,
  onSaved,
}: {
  employee: Employee;
  membership: Membership;
  presets: Preset[];
  definitions: components["schemas"]["PermissionDefinition"][];
  refresh: () => Promise<Employee>;
  onSaved: () => Promise<void>;
}) {
  const { session, scope } = useApp();
  const [draft, setDraft] = useState<
    Pick<MembershipInput, "role" | "permissions" | "status" | "presetId">
  >({
    role: membership.role,
    permissions: [...membership.permissions],
    status: "활성",
  });
  const [versions, setVersions] = useState({
      employeeVersion: employee.version,
      version: membership.version,
    }),
    [error, setError] = useState<Error | null>(null),
    [latest, setLatest] = useState(""),
    [busy, setBusy] = useState(false),
    [blocked, setBlocked] = useState(false);
  const adminOnly = [
    "people:manage",
    ...definitions.filter((p) => p.adminOnly).map((p) => p.code),
  ];
  return (
    <form
      className="mt-3 grid gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
          const updated = await api<components["schemas"]["MembershipResult"]>(
            `/employees/${employee.id}/memberships/${membership.branchId}?${queryString({ scope })}`,
            {
              method: "PUT",
              body: {
                ...membershipBody(employee, membership, draft),
                ...versions,
              },
            },
          );
          setVersions({
            employeeVersion: updated.employeeVersion,
            version: updated.membership.version,
          });
          await onSaved();
        } catch (e) {
          setError(e as Error);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="help">
        이 지점의 소속만 저장합니다. 다른 지점 소속은 전송하거나 삭제하지
        않습니다.
      </p>
      <Field label="소속 역할">
        <select
          value={draft.role}
          disabled={!session.user.owner}
          onChange={(e) => {
            const role = e.target.value as Membership["role"];
            setDraft({
              ...draft,
              role,
              presetId: undefined,
              permissions: rolePermissions(role),
            });
          }}
        >
          <option value="staff">일반 직원</option>
          {session.user.owner && <option value="admin">지점 관리자</option>}
        </select>
      </Field>
      <Field label="권한 프리셋 복사">
        <select
          value={draft.presetId || ""}
          onChange={(e) => {
            const preset = presets.find((p) => p.id === e.target.value);
            if (preset) setDraft({ ...draft, ...copyPreset(preset) });
          }}
        >
          <option value="">직접 조정</option>
          {presets
            .filter((p) => p.role === draft.role)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
      </Field>
      <p className="help">
        일반 직원 기본 권한은 없음, 지점 관리자 기본 권한은 9종 전체입니다.
        프리셋을 복사한 후 개별 조정하며 기존 소속에는 자동 반영되지 않습니다.
      </p>
      <fieldset>
        <legend>업무 권한</legend>
        {permissions.map((code) => (
          <label key={code} className="mb-2 block">
            <input
              type="checkbox"
              checked={draft.permissions.includes(code)}
              disabled={draft.role === "staff" && adminOnly.includes(code)}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  permissions: e.target.checked
                    ? [...draft.permissions, code]
                    : draft.permissions.filter((p) => p !== code),
                })
              }
            />{" "}
            {definitions.find((p) => p.code === code)?.description || code}
            {adminOnly.includes(code) && " (관리자 전용)"}
          </label>
        ))}
      </fieldset>
      <Field label="지점 소속 상태">
        <select
          value={draft.status}
          onChange={(e) =>
            setDraft({ ...draft, status: e.target.value as "활성" | "회수" })
          }
        >
          <option>활성</option>
          <option>회수</option>
        </select>
      </Field>
      {draft.status === "회수" && (
        <p className="help">
          회수하면 이 지점에 접근할 수 없습니다. 복구하려면 재초대·수락·승인이
          필요합니다.
        </p>
      )}
      <SaveError
        error={error}
        latest={latest}
        refresh={async () => {
          try {
            const current = await refresh();
            const updated = current.memberships.find(
              (m) => m.branchId === membership.branchId,
            );
            if (
              !updated ||
              !canManageMembership(session.user, current, updated)
            ) {
              setBlocked(true);
              setError(
                new Error(
                  "현재 소속은 더 이상 수정할 수 없습니다. 화면을 닫고 새로 확인해 주세요.",
                ),
              );
              return;
            }
            setVersions({
              employeeVersion: current.version,
              version: updated.version,
            });
            setLatest(
              `${updated.role === "admin" ? "지점 관리자" : "일반 직원"} / ${updated.status} / 권한 ${updated.permissions.join(", ") || "없음"} (계정 v${current.version}, 소속 v${updated.version})`,
            );
          } catch (e) {
            setError(e as Error);
          }
        }}
      />
      <Button type="submit" disabled={busy || blocked}>
        이 지점 소속 저장
      </Button>
    </form>
  );
}
