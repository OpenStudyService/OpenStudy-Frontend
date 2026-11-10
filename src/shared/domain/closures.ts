import type { components } from "../api/foundation.generated";

type Schemas = components["schemas"];

export type BranchClosure = Schemas["BranchClosure"];
export type StoredClosure = Omit<BranchClosure, "canEdit" | "canDelete">;
export type ClosureList = Schemas["BranchClosureList"];
export type ClosureCreated = Schemas["BranchClosureCreated"];
export type HomeClosure = Schemas["HomeClosureItem"];

export function shiftClosureDate(date: string, days: number) {
  return new Date(Date.parse(date) + days * 86400000)
    .toISOString()
    .slice(0, 10);
}
