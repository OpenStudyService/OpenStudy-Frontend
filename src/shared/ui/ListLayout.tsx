import type { ReactNode } from "react";
import { Icon } from "./Icon";
import { Button, ErrorState, State } from "./primitives";

type SortableColumn = {
  label: string;
  direction?: "asc" | "desc";
  onSort: () => void;
};

export function ListColumnHeader({
  column,
}: {
  column: string | SortableColumn;
}) {
  if (typeof column === "string") return <th scope="col">{column}</th>;
  const { label, direction, onSort } = column;
  return (
    <th
      scope="col"
      aria-sort={
        direction === "asc"
          ? "ascending"
          : direction === "desc"
            ? "descending"
            : undefined
      }
      className="sort-column"
    >
      <button type="button" onClick={onSort}>
        {label}
        <Icon
          name={direction ? "arrow" : "sort"}
          size={14}
          className={
            direction === "asc"
              ? "-rotate-90"
              : direction === "desc"
                ? "rotate-90"
                : undefined
          }
        />
      </button>
    </th>
  );
}

// 목록 화면의 기준 형태(회원 목록): 카드 하나 안에 필터 바 → 표 → footer.
// 화면마다 필요한 필터·열·행은 호출하는 쪽이 채우고, 배치와 상태 표시만 공통으로 맞춘다.

export function ListCard({ children }: { children: ReactNode }) {
  return <div className="card overflow-hidden">{children}</div>;
}

export function ListFilters({
  children,
  actions,
}: {
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="filters">
      {children}
      {actions && (
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}

export function ListTable({
  label,
  columns,
  state,
  loading = false,
  error,
  onRetry,
  isEmpty,
  empty,
  children,
}: {
  label: string;
  columns: (string | SortableColumn)[];
  /** 로딩·오류보다 먼저 보여 줄 안내(예: 잘못된 조건). */
  state?: ReactNode;
  loading?: boolean;
  /** 표 대신 보여 줄 조회 오류. 없으면 null/undefined. */
  error?: Error | null;
  onRetry?: () => void;
  isEmpty: boolean;
  empty: { title: string; message?: string };
  children?: ReactNode;
}) {
  const placeholder = state ? (
    state
  ) : loading ? (
    <State loading />
  ) : error ? (
    <ErrorState error={error} retry={onRetry} />
  ) : isEmpty ? (
    <State title={empty.title} message={empty.message} />
  ) : null;
  return (
    <div className="data-scroll">
      <table className="data-table" aria-label={label}>
        <thead>
          <tr>
            {columns.map((column) => (
              <ListColumnHeader
                key={typeof column === "string" ? column : column.label}
                column={column}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {placeholder ? (
            <tr>
              <td colSpan={columns.length}>{placeholder}</td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
}

export function ListFooter({
  page,
  pageSize,
  total,
  loading = false,
  error = false,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  loading?: boolean;
  error?: boolean;
  onChange: (page: number) => void;
}) {
  const unavailable = loading || error;
  return (
    <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-xs text-muted">
      <span>
        {error
          ? "항목 수 확인 불가"
          : loading
            ? "항목 수 확인 중"
            : `총 ${total}건 · ${page}페이지`}
      </span>
      <div className="flex gap-2">
        <Button
          disabled={unavailable || page <= 1}
          onClick={() => onChange(page - 1)}
        >
          이전
        </Button>
        <Button
          disabled={unavailable || page * pageSize >= total}
          onClick={() => onChange(page + 1)}
        >
          다음
        </Button>
      </div>
    </footer>
  );
}
