import { domainFor, querySpecFor, scopedRows, viewSpecFor } from "./catalog";
import type { DemoScenario, Row, View } from "./catalog";

export interface DemoViewer {
  id: string;
  name: string;
  owner: boolean;
  active: boolean;
  aiBranches: string[];
  salesBranches: string[];
  paymentBranches: string[];
}
export interface DemoResult {
  scenario: DemoScenario;
  rows: Row[];
  scope: string;
  channelId: string;
  querySpec: ReturnType<typeof querySpecFor>;
  viewSpec: ReturnType<typeof viewSpecFor>;
}
export interface SharedResult {
  id: string;
  author: string;
  result: DemoResult;
}
export interface DemoTrace {
  id: string;
  prompt: string;
  status: string;
  scope: string;
  result?: DemoResult;
}
export function resolveView(spec: DemoResult["viewSpec"]): View {
  const candidate = spec.components[1]?.type;
  const allowed: View[] = [
    "bar",
    "line",
    "donut",
    "table",
    "list",
    "calendar",
    "timeline",
    "heatmap",
    "seats",
  ];
  return allowed.includes(candidate as View) ? (candidate as View) : "table";
}
export function canReadDemo(
  viewer: DemoViewer,
  scenario: DemoScenario,
  scope: string,
) {
  if (!viewer.active) return false;
  if (viewer.owner) return true;
  if (domainFor(scenario).id !== "sales") return false;
  const branches = scope === "all" ? ["gangnam", "seongsu"] : [scope];
  return branches.every(
    (b) =>
      viewer.aiBranches.includes(b) &&
      viewer.salesBranches.includes(b) &&
      (!["sales-refunds", "state-empty"].includes(scenario.id) ||
        viewer.paymentBranches.includes(b)),
  );
}
export function makeResult(
  scenario: DemoScenario,
  scope: string,
  channelId: string,
): DemoResult {
  return {
    scenario: structuredClone(scenario),
    rows: scopedRows(scenario, scope),
    scope,
    channelId,
    querySpec: querySpecFor(scenario, scope, channelId),
    viewSpec: viewSpecFor(scenario),
  };
}
export function resultTotal(result: DemoResult) {
  const key = result.scenario.valueKey;
  return key
    ? result.rows.reduce(
        (sum, r) => sum + (typeof r[key] === "number" ? r[key] : 0),
        0,
      )
    : result.rows.length;
}
export function chartData(result: DemoResult) {
  const key = result.scenario.valueKey;
  if (!key) return [];
  const groups = new Map<string, number>();
  for (const row of result.rows)
    groups.set(
      String(row.label),
      (groups.get(String(row.label)) ?? 0) + Number(row[key] ?? 0),
    );
  return [...groups].map(([label, value]) => ({ label, value }));
}
// Simulated channel publication, deliberately memory-only. No backend message write.
const shared = new Map<string, SharedResult[]>();
const listeners = new Set<() => void>();
const empty: SharedResult[] = [];
export const sharedSnapshot = (key: string) => shared.get(key) ?? empty;
export const subscribeShares = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function shareResult(key: string, entry: SharedResult) {
  if (sharedSnapshot(key).some((e) => e.id === entry.id)) return;
  shared.set(key, [...sharedSnapshot(key), structuredClone(entry)]);
  listeners.forEach((fn) => fn());
}
export function clearDemoShares() {
  shared.clear();
  listeners.forEach((fn) => fn());
}
export const scopeLabel = (scope: string) =>
  scope === "all"
    ? "전체 지점"
    : scope === "gangnam"
      ? "강남점"
      : scope === "seongsu"
        ? "성수점"
        : "선택 지점";
