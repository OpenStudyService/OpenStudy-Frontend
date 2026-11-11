import { apiCsv, queryString } from "../../shared/api/client";

export const CSV_ROW_LIMIT = 1_000;

export function csvWillTruncate(total?: number, alreadyTruncated = false) {
  return (total ?? 0) > CSV_ROW_LIMIT || alreadyTruncated;
}

export function exportAiDataset(
  executionId: string,
  datasetId?: string,
  signal?: AbortSignal,
) {
  const query = queryString({ datasetId });
  return apiCsv(
    `/ai/executions/${encodeURIComponent(executionId)}/export${query ? `?${query}` : ""}`,
    signal,
  );
}

export function exportFilename(
  title: string,
  extension: "csv" | "png",
  now = new Date(),
) {
  const seoul = new Date(now.getTime() + 9 * 3600000).toISOString();
  const date = seoul.slice(0, 10).replaceAll("-", "");
  const time = seoul.slice(11, 16).replace(":", "");
  return `${title}_${date}-${time}.${extension}`;
}

export function csvFilename(
  disposition: string | null,
  title: string,
  now?: Date,
) {
  const encoded = /(?:^|;)\s*filename\*=UTF-8''([^;]+)/i.exec(
    disposition ?? "",
  )?.[1];
  if (encoded) {
    try {
      const filename = decodeURIComponent(encoded.trim());
      if (/^[^/\\\p{Cc}]+\.csv$/iu.test(filename)) return filename;
    } catch {
      // An invalid RFC 5987 value falls back to the report title and Seoul time.
    }
  }
  return exportFilename(title, "csv", now);
}
