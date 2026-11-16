import { Button } from "./primitives";

const PAGE_GROUP_SIZE = 10;

export function Pagination({
  page,
  totalPages,
  onPageChange,
  label = "페이지 이동",
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  label?: string;
}) {
  if (totalPages <= 1 && page <= 1) return null;

  const lastAvailablePage = Math.max(1, totalPages);
  const visiblePage = Math.min(page, lastAvailablePage);
  const group = Math.floor((visiblePage - 1) / PAGE_GROUP_SIZE);
  const firstPage = group * PAGE_GROUP_SIZE + 1;
  const lastPage = Math.min(firstPage + PAGE_GROUP_SIZE - 1, totalPages);
  const pages = Array.from(
    { length: lastPage - firstPage + 1 },
    (_, index) => firstPage + index,
  );

  return (
    <nav
      aria-label={label}
      className="flex flex-wrap items-center justify-center gap-1"
    >
      <Button
        type="button"
        disabled={page <= 1}
        onClick={() => onPageChange(Math.min(page - 1, lastAvailablePage))}
      >
        이전
      </Button>
      {pages.map((number) => (
        <Button
          key={number}
          type="button"
          className="min-w-9 px-2"
          variant={number === page ? "primary" : ""}
          aria-label={`${number}페이지`}
          aria-current={number === page ? "page" : undefined}
          onClick={() => {
            if (number !== page) onPageChange(number);
          }}
        >
          {number}
        </Button>
      ))}
      <Button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        다음
      </Button>
    </nav>
  );
}
