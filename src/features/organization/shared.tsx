import { invalidateReads } from "../../shared/api/invalidateReads";
import { useState, type ReactNode } from "react";
import { readListPage } from "../../shared/api/read-sorted-pages";
import type { SortDirection } from "../../shared/ui/table-sort";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { useApp } from "../../app/context";
import { ApiError, MOCK } from "../../shared/api/client";
import type { components } from "../../shared/api/foundation.generated";
import { Button, FieldError } from "../../shared/ui/primitives";
import { organizationRead } from "./api";

export function useOrganizationList<
  K extends "BranchPage" | "EmployeePage" | "PermissionPresetPage",
>(
  path: string,
  enabled = true,
  sorting?: {
    sort: string;
    page: number;
    pageSize: number;
    direction: SortDirection;
    value: (
      row: components["schemas"][K]["items"][number],
    ) => string | number | null | undefined;
  },
) {
  const { session, scope } = useApp();
  return useQuery({
    queryKey: [
      "data",
      session.user.id,
      scope,
      "organization",
      path,
      sorting?.sort,
      sorting?.direction,
    ],
    queryFn: ({ signal }) => {
      if (!sorting)
        return organizationRead<components["schemas"][K]>(path, signal);
      const [resource, search] = path.split("?");
      return readListPage<components["schemas"][K]>(
        (page, pageSize) => {
          const params = new URLSearchParams(search);
          params.set("page", String(page));
          params.set("pageSize", String(pageSize));
          return organizationRead<components["schemas"][K]>(
            `${resource}?${params}`,
            signal,
          );
        },
        sorting.page,
        sorting.pageSize,
        sorting.direction,
        sorting.value,
      );
    },
    enabled,
    retry: false,
  });
}
export function ContractNotice() {
  return MOCK ? (
    <p className="help mb-4">
      데모 화면입니다. 변경 내용은 실제 지점·직원 정보에 반영되지 않습니다.
    </p>
  ) : null;
}
export function SaveError({
  error,
  refresh,
  latest,
  fieldLabels = {},
}: {
  error: Error | null;
  refresh: () => Promise<void>;
  latest?: string;
  fieldLabels?: Record<string, string>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      {error && (
        <FieldError>
          {error.message}
          {error instanceof ApiError &&
            error.detail.fieldErrors &&
            Object.entries(error.detail.fieldErrors).map(([field, message]) => (
              <span className="block" key={field}>
                {fieldLabels[field] || field}: {message}
              </span>
            ))}
        </FieldError>
      )}
      {error instanceof ApiError && error.status === 409 && (
        <div className="my-3">
          <p className="help">
            입력은 유지됩니다. 최신 서버 내용을 확인한 뒤 다시 저장해 주세요.
          </p>
          <Button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await refresh();
              } finally {
                setBusy(false);
              }
            }}
          >
            최신 버전 확인 (입력 유지)
          </Button>
        </div>
      )}
      {latest && (
        <p className="help my-3" role="status">
          최신 서버 내용: {latest}. 현재 입력과 비교한 후 저장하면 이 버전에
          적용됩니다.
        </p>
      )}
    </>
  );
}
export function useRefreshOrganization() {
  const query = useQueryClient();
  const { session } = useApp();
  return async () => {
    await invalidateReads(
      query,
      session.user.id,
      "organization",
      "lookups",
      "invitations",
    );
    await query.invalidateQueries({ queryKey: ["session"] });
  };
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      {label}
      {children}
    </label>
  );
}
export function useListSearch(prefix: string) {
  const [params, setParams] = useSearchParams();
  const rawPage = Number(params.get(`${prefix}Page`) || 1);
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const search = params.get(`${prefix}Search`) || "";
  const setPage = (value: number) =>
    setParams((current) => {
      current.set(`${prefix}Page`, String(value));
      return current;
    });
  const setSearch = (value: string) =>
    setParams(
      (current) => {
        current.set(`${prefix}Search`, value);
        current.set(`${prefix}Page`, "1");
        return current;
      },
      { replace: true },
    );
  return { page, search, setPage, setSearch };
}
export function Pager({
  page,
  pageSize = 20,
  total,
  onChange,
}: {
  page: number;
  pageSize?: number;
  total: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="my-3 flex items-center gap-3">
      <Button
        type="button"
        disabled={page === 1}
        onClick={() => onChange(page - 1)}
      >
        이전
      </Button>
      <span>
        {page}페이지 · 총 {total}개
      </span>
      <Button
        type="button"
        disabled={page * pageSize >= total}
        onClick={() => onChange(page + 1)}
      >
        다음
      </Button>
    </div>
  );
}
