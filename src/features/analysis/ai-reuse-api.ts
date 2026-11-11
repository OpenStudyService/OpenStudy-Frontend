import { api, queryString } from "../../shared/api/client";
import type {
  components,
  operations,
} from "../../shared/api/foundation.generated";

type Schemas = components["schemas"];
export type AiConditions = Schemas["AiConditions"];
export type AiContext = Schemas["AiContext"];
export type AiEditableFilters = Schemas["AiEditableFilters"];
export type AiExecution = Schemas["AiExecution"];
export type AiRecentQuery = Schemas["AiRecentQuery"];
export type AiRefinement = Schemas["AiRefinement"];
export type AiPageQuery = NonNullable<
  operations["getAiExecution"]["parameters"]["query"]
>;

function executionPath(executionId: string) {
  return `/ai/executions/${encodeURIComponent(executionId)}`;
}

export const aiReuse = {
  recent: (signal?: AbortSignal) =>
    api<Schemas["AiRecentQueryList"]>("/ai/recent-queries", { signal }),
  execution: (id: string, query?: AiPageQuery, signal?: AbortSignal) =>
    api<AiExecution>(
      `${executionPath(id)}${query ? `?${queryString(query)}` : ""}`,
      { signal },
    ),
  refine: (id: string, body: AiRefinement, signal?: AbortSignal) =>
    api<Schemas["AiQueryResponse"]>(`${executionPath(id)}/refinements`, {
      method: "POST",
      body,
      signal,
    }),
};
