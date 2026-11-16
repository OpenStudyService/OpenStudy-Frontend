import { useEffect, useRef, useState, type Ref } from "react";
import { Dialog } from "radix-ui";
import { hasBlockingReadError } from "../../shared/api/read-model";
import { Icon } from "../../shared/ui/Icon";
import { ListTable } from "../../shared/ui/ListLayout";
import { Pagination } from "../../shared/ui/Pagination";
import { Button } from "../../shared/ui/primitives";
import { useCustomerDetail } from "../customers/hooks";
import type { CustomerListItem } from "../customers/model";
import { CUSTOMER_SEARCH_PAGE_SIZE, useCustomerSearch } from "./shared";

export function PaymentCustomerPicker({
  mode,
  value,
  onChange,
}: {
  mode: "filter" | "sale";
  value: string;
  onChange: (id: string) => void;
}) {
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerListItem>();
  const [keyword, setKeyword] = useState("");
  const [open, setOpen] = useState(false);
  const quickSearchInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const openedFromInput = useRef(false);
  const focusAfterClear = useRef(false);
  const selectedLabel =
    selectedCustomer?.id === value
      ? `${selectedCustomer.name} · ${selectedCustomer.memberNo}`
      : undefined;

  useEffect(() => {
    if (value || !focusAfterClear.current) return;
    focusAfterClear.current = false;
    quickSearchInput.current?.focus();
  }, [value]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="w-52 min-w-0">
            {value ? (
              <div className="flex h-10 min-w-0 items-center gap-1 rounded-lg border border-line bg-surface pr-1 pl-3 text-[13px]">
                <output
                  aria-label="선택한 고객"
                  className="min-w-0 flex-1 truncate"
                  title={selectedLabel}
                >
                  {selectedLabel ?? <SelectedCustomer id={value} />}
                </output>
                <button
                  type="button"
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-soft hover:text-ink"
                  aria-label={
                    mode === "filter" ? "고객 필터 해제" : "고객 선택 해제"
                  }
                  onClick={() => {
                    focusAfterClear.current = true;
                    setSelectedCustomer(undefined);
                    setKeyword("");
                    onChange("");
                  }}
                >
                  <Icon name="close" size={16} />
                </button>
              </div>
            ) : (
              <input
                ref={quickSearchInput}
                type="search"
                aria-label="고객 검색어"
                placeholder="이름·회원번호·연락처"
                className="h-10 w-full"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.nativeEvent.isComposing)
                    return;
                  event.preventDefault();
                  openedFromInput.current = true;
                  setOpen(true);
                }}
              />
            )}
          </div>
          <Dialog.Trigger asChild>
            <Button type="button" className="shrink-0">
              고객 검색
            </Button>
          </Dialog.Trigger>
        </div>
        {!value && (
          <span className="help">
            {mode === "filter" ? "전체 고객" : "고객을 선택해 주세요."}
          </span>
        )}
      </div>
      <Dialog.Portal>
        <Dialog.Overlay className="panel-overlay z-[60]" />
        <Dialog.Content
          onOpenAutoFocus={(event) => {
            if (searchInput.current) {
              event.preventDefault();
              searchInput.current.focus();
            }
          }}
          onCloseAutoFocus={(event) => {
            if (!openedFromInput.current) return;
            openedFromInput.current = false;
            if (quickSearchInput.current) {
              event.preventDefault();
              quickSearchInput.current.focus();
            }
          }}
          className="fixed top-1/2 left-1/2 z-[60] flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-xl"
        >
          <header className="panel-head">
            <div>
              <Dialog.Title>고객 검색</Dialog.Title>
              <Dialog.Description>
                {mode === "filter"
                  ? "결제 내역을 조회할 고객을 선택해 주세요."
                  : "결제할 고객을 선택해 주세요."}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button type="button" aria-label="닫기">
                <Icon name="close" />
              </Button>
            </Dialog.Close>
          </header>
          <CustomerSearchResults
            initialSearch={value ? "" : keyword.trim()}
            searchInput={searchInput}
            selectedId={value}
            onSelect={(customer) => {
              openedFromInput.current = false;
              setSelectedCustomer(customer);
              setKeyword("");
              onChange(customer.id);
            }}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SelectedCustomer({ id }: { id: string }) {
  const { data } = useCustomerDetail(id);
  const label = data ? `${data.name} · ${data.memberNo}` : `고객 ID ${id}`;
  return <span title={label}>{label}</span>;
}

function CustomerSearchResults({
  initialSearch,
  searchInput,
  selectedId,
  onSelect,
}: {
  initialSearch: string;
  searchInput: Ref<HTMLInputElement>;
  selectedId: string;
  onSelect: (customer: CustomerListItem) => void;
}) {
  const { search, setSearch, page, setPage, customers } = useCustomerSearch({
    initialSearch,
    keepPreviousPage: true,
  });
  const data = customers.data;
  const loading = customers.isPending || customers.isPlaceholderData;
  const totalPages = Math.ceil(
    (data?.meta.total ?? 0) / CUSTOMER_SEARCH_PAGE_SIZE,
  );
  return (
    <>
      <div className="min-h-0 overflow-auto">
        <div className="border-b border-line px-4 py-3 sm:px-5">
          <label className="field">
            이름·회원번호·연락처
            <input
              ref={searchInput}
              type="search"
              className="h-10"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
        <ListTable
          label="고객 검색 결과"
          columns={["이름", "회원번호", "연락처", "상태"]}
          loading={loading}
          error={hasBlockingReadError(customers) ? customers.error : null}
          onRetry={() => void customers.refetch()}
          isEmpty={!data?.items.length}
          empty={{ title: "조건에 맞는 고객이 없어요" }}
        >
          {data?.items.map((customer) => (
            <tr key={customer.id}>
              <td>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="cell-link"
                    onClick={() => onSelect(customer)}
                  >
                    {customer.name}
                  </button>
                </Dialog.Close>
                {customer.id === selectedId && (
                  <span className="help block">선택됨</span>
                )}
              </td>
              <td>{customer.memberNo}</td>
              <td>{customer.phone}</td>
              <td>{customer.status}</td>
            </tr>
          ))}
        </ListTable>
      </div>
      {(data || page > 1) && (
        <footer className="grid shrink-0 justify-items-center gap-1 border-t border-line px-4 py-3">
          {data && (
            <span className="help" aria-live="polite">
              총 {data.meta.total}명
            </span>
          )}
          <Pagination
            page={page}
            totalPages={totalPages}
            label="고객 검색 결과 페이지 이동"
            onPageChange={setPage}
          />
        </footer>
      )}
    </>
  );
}
