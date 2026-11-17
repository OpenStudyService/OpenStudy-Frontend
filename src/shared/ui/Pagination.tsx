import { Button } from "./primitives";

const MAX_VISIBLE_PAGES = 10;

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
  const pagesBeforeCurrent = Math.floor((MAX_VISIBLE_PAGES - 1) / 2);
  const lastStartPage = Math.max(1, totalPages - MAX_VISIBLE_PAGES + 1);
  const firstPage = Math.min(
    Math.max(1, visiblePage - pagesBeforeCurrent),
    lastStartPage,
  );
  const lastPage = Math.min(firstPage + MAX_VISIBLE_PAGES - 1, totalPages);
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
