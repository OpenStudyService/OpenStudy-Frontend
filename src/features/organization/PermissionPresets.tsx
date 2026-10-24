import { useState } from "react";
import { api } from "../../shared/api/client";
import type { components } from "../../shared/api/foundation.generated";
import { permissions } from "../../shared/domain/schema";
import { Button, Panel } from "../../shared/ui/primitives";
import { organizationRead } from "./api";
import { rolePermissions } from "./model";
import type { Preset } from "./model";
import { Field, SaveError } from "./shared";

export function PresetManagement({
  presets,
  adminOnly,
  onSaved,
}: {
  presets: Preset[];
  adminOnly: string[];
  onSaved: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<Preset | "new" | null>(null);
  return (
    <section className="card mt-5 p-4">
      <h2>권한 프리셋</h2>
      <p className="help">
        프리셋 수정은 기존 직원·초대에 자동 반영되지 않습니다. 시스템 기본값은
        수정할 수 없습니다.
      </p>
      {presets.map((p) => (
        <div
          className="my-3 flex flex-wrap items-center justify-between gap-2"
          key={p.id}
        >
          <span>
            {p.name} · {p.permissions.length}종 {p.system && "(시스템)"}
          </span>
          {!p.system && (
            <Button onClick={() => setSelected(p)}>
              프리셋 수정: {p.name}
            </Button>
          )}
        </div>
      ))}
      <Button onClick={() => setSelected("new")}>프리셋 등록</Button>
      <Panel
        open={selected !== null}
        onClose={() => setSelected(null)}
        title="권한 프리셋 관리"
      >
        {selected && (
          <PresetForm
            key={selected === "new" ? "new" : selected.id}
            preset={selected === "new" ? undefined : selected}
            adminOnly={adminOnly}
            onSaved={async () => {
              setSelected(null);
              await onSaved();
            }}
          />
        )}
      </Panel>
    </section>
  );
}
function PresetForm({
  preset,
  adminOnly,
  onSaved,
}: {
  preset?: Preset;
  adminOnly: string[];
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(preset?.name || ""),
    [role, setRole] = useState<Preset["role"]>(preset?.role || "staff"),
    [grants, setGrants] = useState(preset?.permissions || []),
    [version, setVersion] = useState(preset?.version),
    [latest, setLatest] = useState(""),
    [error, setError] = useState<Error | null>(null),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="grid gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api(
            preset ? `/permission-presets/${preset.id}` : "/permission-presets",
            {
              method: preset ? "PATCH" : "POST",
              body: preset
                ? ({
                    version: version!,
                    name,
                    permissions: grants,
                  } satisfies components["schemas"]["PresetUpdate"])
                : ({
                    name,
                    role,
                    permissions: grants,
                  } satisfies components["schemas"]["PresetCreate"]),
            },
          );
          await onSaved();
        } catch (e) {
          setError(e as Error);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="프리셋 이름">
        <input
          required
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="프리셋 역할">
        <select
          disabled={!!preset}
          value={role}
          onChange={(e) => {
            const value = e.target.value as Preset["role"];
            setRole(value);
            setGrants(rolePermissions(value));
          }}
        >
          <option value="staff">일반 직원</option>
          <option value="admin">지점 관리자</option>
        </select>
      </Field>
      {permissions.map((code) => (
        <label key={code}>
          <input
            type="checkbox"
            checked={grants.includes(code)}
            disabled={role === "staff" && adminOnly.includes(code)}
            onChange={(e) =>
              setGrants(
                e.target.checked
                  ? [...grants, code]
                  : grants.filter((p) => p !== code),
              )
            }
          />{" "}
          {code}
        </label>
      ))}
      <SaveError
        error={error}
        latest={latest}
        refresh={async () => {
          try {
            let page = 1,
              found: Preset | undefined;
            while (!found) {
              const result = await organizationRead<
                components["schemas"]["PermissionPresetPage"]
              >(`/permission-presets?pageSize=100&page=${page}`);
              found = result.items.find((p) => p.id === preset?.id);
              if (found || page * 100 >= result.meta.total) break;
              page += 1;
            }
            if (!found)
              throw new Error(
                "이 프리셋을 찾을 수 없습니다. 목록을 다시 확인해 주세요.",
              );
            setVersion(found.version);
            setLatest(
              `${found.name} / 권한 ${found.permissions.join(", ") || "없음"} (v${found.version})`,
            );
          } catch (e) {
            setError(e as Error);
          }
        }}
      />
      <Button type="submit" disabled={busy}>
        프리셋 저장
      </Button>
    </form>
  );
}
