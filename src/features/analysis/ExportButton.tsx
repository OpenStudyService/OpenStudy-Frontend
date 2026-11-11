import { useEffect, useId, useRef, useState } from "react";
import { ApiError } from "../../shared/api/client";
import { Button } from "../../shared/ui/primitives";
import { csvFilename, csvWillTruncate } from "./export-api";
import {
  exportSalesReport,
  salesExportTitles,
  type SalesCondition,
  type SalesExportOptions,
  type SalesReport,
} from "./sales-api";

type Download = { blob: Blob; filename: string };

export function ExportButton({
  label,
  title,
  download,
  warning,
}: {
  label: string;
  title: string;
  download: (signal: AbortSignal) => Promise<Download>;
  warning?: string;
}) {
  const active = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const warningId = useId();
  useEffect(() => () => active.current?.abort(), []);

  async function run() {
    if (active.current) return;
    const request = new AbortController();
    active.current = request;
    setBusy(true);
    setError(null);
    try {
      const { blob, filename } = await download(request.signal);
      request.signal.throwIfAborted();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.append(link);
      try {
        link.click();
      } finally {
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
    } catch (failure) {
      if (!request.signal.aborted) {
        setError(
          failure ?? new Error("파일을 저장하지 못했어요. 다시 시도해 주세요."),
        );
      }
    } finally {
      active.current = null;
      if (!request.signal.aborted) setBusy(false);
    }
  }

  return (
    <div className="grid justify-items-start gap-1">
      {warning && (
        <p className="help" id={warningId}>
          {warning}
        </p>
      )}
      <Button
        type="button"
        aria-label={`${title} ${label}`}
        aria-describedby={warning ? warningId : undefined}
        aria-busy={busy}
        disabled={busy}
        onClick={() => void run()}
      >
        {busy ? "파일 준비 중…" : label}
      </Button>
      {error != null && (
        <div className="help" role="alert">
          <p>
            {error instanceof Error
              ? error.message
              : "파일을 저장하지 못했어요. 다시 시도해 주세요."}
            {error instanceof ApiError && ` [${error.detail.code}]`}
          </p>
          {error instanceof ApiError &&
            Object.entries(error.detail.fieldErrors ?? {}).map(
              ([field, message]) => <p key={field}>{message}</p>,
            )}
        </div>
      )}
    </div>
  );
}

export function CsvExportButton({
  title,
  filenameTitle = title,
  load,
  total,
  truncated,
}: {
  title: string;
  filenameTitle?: string;
  load: (
    signal: AbortSignal,
  ) => Promise<{ blob: Blob; disposition: string | null }>;
  total?: number;
  truncated?: boolean;
}) {
  return (
    <ExportButton
      label="CSV 다운로드"
      title={title}
      warning={
        csvWillTruncate(total, truncated)
          ? "CSV에는 앞의 1,000행만 담겨요."
          : undefined
      }
      download={async (signal) => {
        const { blob, disposition } = await load(signal);
        return { blob, filename: csvFilename(disposition, filenameTitle) };
      }}
    />
  );
}

export function SalesCsvExport({
  report,
  condition,
  options,
  total,
  title = salesExportTitles[report],
}: {
  report: SalesReport;
  condition: SalesCondition;
  options?: SalesExportOptions;
  total?: number;
  title?: string;
}) {
  return (
    <CsvExportButton
      title={title}
      filenameTitle={salesExportTitles[report]}
      total={total}
      load={(signal) => exportSalesReport(report, condition, options, signal)}
    />
  );
}
