import { ViewSpecRenderer } from "./Charts";
import { useAiConditionEntries } from "./AiConditions";
import { CsvExportButton } from "./ExportButton";
import { exportAiDataset } from "./export-api";
import type { AiConditions } from "./ai-reuse-api";
import type { ParsedAiResult } from "./domainlens";

export function AiCsvExports({
  executionId,
  parsed,
  accessDenied,
}: {
  executionId?: string | null;
  parsed: ParsedAiResult;
  accessDenied: boolean;
}) {
  // The result card receives IDs only for completed executions from the current user's conversation or recent queries.
  if (!executionId || accessDenied || !parsed.datasetList.length) return null;
  return (
    <ul className="grid gap-2 border-b border-line px-4 py-3">
      {parsed.datasetList.map((dataset) => {
        const name = parsed.viewSpec?.components.find(
          (component) =>
            component.datasetId === dataset.id &&
            typeof component.options.title === "string",
        )?.options.title;
        // A generated view names no titles and its dataset IDs are the compiler's (q0): use the result's own title.
        const title =
          typeof name === "string"
            ? name
            : parsed.generated
              ? parsed.datasetList.length > 1
                ? `${parsed.title} (${parsed.datasetList.indexOf(dataset) + 1})`
                : parsed.title
              : dataset.id;
        return (
          <li key={dataset.id} className="flex flex-wrap items-start gap-2">
            <h4 className="text-xs font-semibold">{title}</h4>
            <CsvExportButton
              title={title}
              filenameTitle="AI 분석 결과"
              total={dataset.totalElements}
              truncated={parsed.truncation?.isTruncated}
              load={(signal) =>
                exportAiDataset(executionId, dataset.id, signal)
              }
            />
          </li>
        );
      })}
    </ul>
  );
}

export function AiChartResults({
  parsed,
  activeView,
  scope,
  conditions,
}: {
  parsed: ParsedAiResult;
  activeView: string;
  scope: string;
  conditions?: AiConditions | null;
}) {
  const entries = useAiConditionEntries(conditions, parsed.generated);
  return (
    <ViewSpecRenderer
      parsed={parsed}
      activeView={activeView}
      scope={scope}
      exportConditions={
        entries.length
          ? entries.map(([label, value]) => `${label} ${value}`)
          : undefined
      }
    />
  );
}
