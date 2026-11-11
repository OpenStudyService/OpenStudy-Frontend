import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "../../shared/api/client";
import { formatDateTime } from "../../shared/domain/format";
import { Button, State } from "../../shared/ui/primitives";
import { Pager } from "../organization/shared";
import { aiReuse } from "./ai-reuse-api";
import type { AiPageQuery } from "./ai-reuse-api";
import { ReuseError } from "./AiConditions";
import { DomainDataTable } from "./Charts";
import { parseAiResult } from "./domainlens";
import type { ParsedAiResult } from "./domainlens";

const PAGE_SIZE = 20;

export function ResultDetails({
  executionId,
  original,
  initialDatasetId,
  onAccessChecked,
}: {
  executionId: string;
  original: ParsedAiResult;
  initialDatasetId?: string;
  onAccessChecked: (denied: boolean) => void;
}) {
  const [query, setQuery] = useState<AiPageQuery>({
    datasetId:
      original.datasetList.find(({ id }) => id === initialDatasetId)?.id ??
      original.datasetList[0]?.id,
    page: 1,
    size: PAGE_SIZE,
  });
  const details = useQuery({
    queryKey: ["data", "ai", "execution-details", executionId, query],
    queryFn: async ({ signal }) => {
      try {
        const execution = await aiReuse.execution(executionId, query, signal);
        signal.throwIfAborted();
        const result = parseAiResult(execution);
        const dataset = result.datasetList.find(
          (item) => item.id === query.datasetId,
        );
        if (!dataset)
          throw new Error("선택한 데이터 종류의 결과를 찾지 못했어요.");
        onAccessChecked(false);
        return { result, dataset };
      } catch (error) {
        if (
          !signal.aborted &&
          error instanceof ApiError &&
          [401, 403, 404].includes(error.status)
        ) {
          onAccessChecked(true);
        }
        throw error;
      }
    },
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const { result, dataset } = details.data ?? {};
  return (
    <div className="grid gap-2">
      {original.datasetList.length > 1 && (
        <label className="field max-w-xs">
          데이터 종류
          <select
            value={query.datasetId}
            onChange={(event) =>
              setQuery({
                datasetId: event.target.value,
                page: 1,
                size: PAGE_SIZE,
              })
            }
          >
            {original.datasetList.map(({ id }) => {
              const title = original.viewSpec?.components.find(
                (item) => item.datasetId === id,
              )?.options.title;
              return (
                <option key={id} value={id}>
                  {typeof title === "string" ? title : id}
                </option>
              );
            })}
          </select>
        </label>
      )}
      {details.isFetching ? (
        <State loading title="결과를 다시 조회하고 있어요" />
      ) : details.error ? (
        <div>
          <ReuseError error={details.error} />
          <Button type="button" onClick={() => void details.refetch()}>
            다시 조회
          </Button>
        </div>
      ) : dataset && result ? (
        <>
          <DomainDataTable
            dataset={dataset}
            serverSort={{
              value: query.sort
                ? { alias: query.sort, desc: query.direction !== "asc" }
                : undefined,
              onChange: ({ alias, desc }) =>
                setQuery({
                  ...query,
                  page: 1,
                  sort: alias,
                  direction: desc ? "desc" : "asc",
                }),
            }}
          />
          {dataset.rows.length === 0 && (
            <p className="help">이 페이지에 결과가 없어요.</p>
          )}
          <Pager
            page={dataset.page}
            pageSize={dataset.size}
            total={dataset.totalElements}
            onChange={(page) => setQuery({ ...query, page })}
          />
          {result.truncation?.isTruncated && (
            <p className="tip">
              {result.truncation.message ??
                `최대 ${result.truncation.maxRows}행 안에서 정렬해요.`}
            </p>
          )}
          <p className="help">
            표 기준 시각 {formatDateTime(result.asOf ?? dataset.asOf)} ·
            Asia/Seoul
          </p>
          {result.warnings.length > 0 && (
            <p className="tip">{result.warnings.join(" · ")}</p>
          )}
        </>
      ) : null}
    </div>
  );
}
