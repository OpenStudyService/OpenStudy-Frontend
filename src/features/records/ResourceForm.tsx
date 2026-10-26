import { useId, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ApiError } from "../../shared/api/client";
import type { Entity, LookupData } from "../../shared/domain/schema";
import { text, value } from "../../shared/domain/schema";
import {
  employeeLookupInBranch,
  employeeLookupNeedsScope,
} from "../../shared/domain/lookup-employees";
import type { Field } from "../../shared/domain/catalog";
import { Button, FieldError } from "../../shared/ui/primitives";

const localDateTime = (v: unknown) =>
  typeof v === "string" && v.includes("T")
    ? new Date(Date.parse(v) + 9 * 3600000).toISOString().slice(0, 16)
    : v;
function initial(
  fields: Field[],
  row: Entity | undefined,
  scope: string,
  defaults: Record<string, unknown>,
) {
  return Object.fromEntries(
    fields.map((f) => {
      let v = defaults[f.key] ?? (row ? value(row, f.key) : undefined);
      if (v === undefined)
        v =
          f.key === "branchId"
            ? scope === "all"
              ? ""
              : scope
            : f.type === "multiselect"
              ? []
              : f.type === "checkbox"
                ? false
                : f.type === "number"
                  ? (f.min ?? 0)
                  : (f.options?.[0] ?? "");
      if (f.type === "datetime-local") v = localDateTime(v);
      if (f.type === "checks" && Array.isArray(v))
        v = v
          .map((c) => {
            const check = c as { text: string; done: boolean };
            return `${check.done ? "[x]" : "[ ]"} ${check.text}`;
          })
          .join("\n");
      return [f.key, v];
    }),
  );
}
export function ResourceForm({
  fields,
  row,
  scope,
  lookups,
  onSubmit,
  label = "저장하기",
  defaults = {},
}: {
  fields: Field[];
  row?: Entity;
  scope: string;
  lookups: LookupData;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  label?: string;
  defaults?: Record<string, unknown>;
}) {
  const id = useId(),
    [error, setError] = useState("");
  const schema = z.record(z.string(), z.unknown()).superRefine((data, ctx) => {
    for (const f of fields) {
      const v = data[f.key];
      if (
        f.required &&
        f.type !== "checkbox" &&
        (v === undefined || v === null || String(v).trim() === "")
      )
        ctx.addIssue({
          code: "custom",
          path: [f.key],
          message: `${f.label} 항목을 입력해 주세요.`,
        });
      if (
        f.type === "number" &&
        (typeof v !== "number" ||
          !Number.isFinite(v) ||
          (f.min !== undefined && v < f.min))
      )
        ctx.addIssue({
          code: "custom",
          path: [f.key],
          message: `${f.min ?? 0} 이상의 숫자를 입력해 주세요.`,
        });
      if (f.key === "email" && v && !z.email().safeParse(v).success)
        ctx.addIssue({
          code: "custom",
          path: [f.key],
          message: "이메일 형식을 확인해 주세요.",
        });
    }
  });
  const form = useForm<Record<string, unknown>>({
    resolver: zodResolver(schema),
    defaultValues: initial(fields, row, scope, defaults),
  });
  const selectedBranch =
    (useWatch({ control: form.control, name: "branchId" }) as string) ||
    row?.branchId ||
    scope;
  const selectedMember = useWatch({
    control: form.control,
    name: "memberId",
  }) as string;
  const employeeFields = fields.filter((field) => field.ref === "employees");
  const employeeValues = useWatch({
    control: form.control,
    name: employeeFields.map((field) => field.key),
  });
  const employeeScopeUnavailable = employeeLookupNeedsScope(
    lookups.employees,
    selectedBranch,
    scope,
  );
  const employeeScopeMessage =
    "이 지점의 직원을 선택하려면 해당 지점으로 이동해 주세요.";
  function options(f: Field) {
    if (!f.ref)
      return (f.options || []).map((v) => ({
        id: v,
        label: v === "admin" ? "지점 관리자" : v === "staff" ? "일반 직원" : v,
      }));
    if (f.ref === "employees")
      return employeeScopeUnavailable
        ? []
        : lookups.employees
            .filter((employee) =>
              employeeLookupInBranch(employee, selectedBranch, scope),
            )
            .map((employee) => ({ id: employee.id, label: employee.name }));
    const rows = (lookups[f.ref as keyof LookupData] || []) as Entity[];
    return rows
      .filter((r) => {
        if (f.ref === "passes" && selectedMember)
          return (
            text(r, "memberId") === selectedMember &&
            text(r, "status") === "활성"
          );
        if (f.ref === "members") return true;
        return (
          f.ref === "branches" ||
          selectedBranch === "all" ||
          !selectedBranch ||
          r.branchId === selectedBranch ||
          r.branchId === "all"
        );
      })
      .map((r) => ({
        id: r.id,
        label:
          text(r, "name") ||
          text(r, "title") ||
          `${text(r, "employeeId")} · ${text(r, "startedAt") || text(r, "startsAt")}`,
      }));
  }
  async function submit(data: Record<string, unknown>) {
    setError("");
    if (employeeScopeUnavailable) {
      const unavailable = fields.filter((field) => field.ref === "employees");
      for (const field of unavailable)
        form.setError(field.key, { message: employeeScopeMessage });
      if (unavailable.length) return;
    }
    const payload = { ...data };
    for (const f of fields) {
      if (f.type === "datetime-local" && payload[f.key])
        payload[f.key] = new Date(`${payload[f.key]}:00+09:00`).toISOString();
      if (f.type === "checks")
        payload[f.key] = String(payload[f.key] || "")
          .split("\n")
          .map((t) => t.trim())
          .filter(Boolean)
          .map((t) => ({
            text: t.replace(/^\[[ xX]?\]\s*/, ""),
            done: /^\[[xX]\]/.test(t),
          }));
      if (typeof payload[f.key] === "string" && f.type !== "textarea")
        payload[f.key] = (payload[f.key] as string).trim();
    }
    try {
      await onSubmit(payload);
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError)
        for (const [name, message] of Object.entries(
          e.detail.fieldErrors || {},
        ))
          form.setError(name, { message });
    }
  }
  return (
    <form className="form-grid" noValidate onSubmit={form.handleSubmit(submit)}>
      {fields.map((f) => {
        const key = `${id}-${f.key}`,
          error = form.formState.errors[f.key];
        return (
          <div className="field" key={f.key}>
            {f.type === "checkbox" ? (
              <label className="flex items-center gap-2">
                <input type="checkbox" {...form.register(f.key)} />
                {f.label}
              </label>
            ) : (
              <>
                <label htmlFor={key}>
                  {f.label}
                  {f.required && (
                    <span className="ml-1 text-primary" aria-hidden="true">
                      *
                    </span>
                  )}
                </label>
                {f.type === "select" || f.type === "multiselect" ? (
                  <select
                    id={key}
                    aria-label={f.label}
                    aria-required={f.required}
                    aria-describedby={
                      error
                        ? `${key}-error`
                        : f.ref === "employees" && employeeScopeUnavailable
                          ? `${key}-scope`
                          : undefined
                    }
                    multiple={f.type === "multiselect"}
                    {...form.register(f.key)}
                    value={
                      f.ref === "employees"
                        ? (employeeValues[
                            employeeFields.findIndex(
                              (field) => field.key === f.key,
                            )
                          ] as string | string[])
                        : undefined
                    }
                    aria-invalid={!!error}
                    disabled={
                      (!!row && f.key === "branchId") ||
                      (f.ref === "employees" && employeeScopeUnavailable)
                    }
                  >
                    {f.type !== "multiselect" && (
                      <option value="">선택해 주세요</option>
                    )}
                    {f.key === "branchId" && f.options?.includes("all") && (
                      <option value="all">전체 지점</option>
                    )}
                    {options(f).map((o) => (
                      <option value={o.id} key={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : f.type === "textarea" || f.type === "checks" ? (
                  <textarea
                    id={key}
                    aria-label={f.label}
                    aria-required={f.required}
                    aria-describedby={error ? `${key}-error` : undefined}
                    {...form.register(f.key)}
                    placeholder={
                      f.type === "checks"
                        ? "한 줄에 한 항목씩 입력해 주세요. [x]로 완료를 표시할 수 있어요."
                        : undefined
                    }
                    aria-invalid={!!error}
                  />
                ) : (
                  <input
                    id={key}
                    aria-label={f.label}
                    aria-required={f.required}
                    aria-describedby={error ? `${key}-error` : undefined}
                    type={f.type || "text"}
                    step={f.step || (f.type === "datetime-local" ? 1800 : 1)}
                    min={f.min}
                    {...form.register(f.key, {
                      valueAsNumber: f.type === "number",
                    })}
                    aria-invalid={!!error}
                  />
                )}
              </>
            )}
            {f.ref === "employees" && employeeScopeUnavailable && (
              <p className="help" id={`${key}-scope`}>
                {employeeScopeMessage}
              </p>
            )}
            {error && (
              <FieldError id={`${key}-error`}>
                {String(error.message)}
              </FieldError>
            )}
          </div>
        );
      })}
      {error && <FieldError>{error}</FieldError>}
      <div className="sticky bottom-0 flex justify-end border-t border-line bg-surface pt-4">
        <Button
          type="submit"
          variant="primary"
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? "처리 중…" : label}
        </Button>
      </div>
    </form>
  );
}
