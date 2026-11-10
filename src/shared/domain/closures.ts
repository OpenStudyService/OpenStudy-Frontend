import type { components } from "../api/foundation.generated";

export interface StoredClosure {
  id: string;
  version: number;
  branchId: string;
  date: string;
  note: string | null;
  createdBy: components["schemas"]["ActorSummary"];
  createdAt: string;
  updatedAt: string;
}

export interface BranchClosure extends StoredClosure {
  canEdit: boolean;
  canDelete: boolean;
}

export interface ClosureList {
  branchId: string;
  from: string;
  to: string;
  items: BranchClosure[];
}

export interface ClosureCreated {
  closure: BranchClosure;
  affectedReservations: {
    id: string;
    roomId: string;
    roomName: string;
    startAt: string;
    endAt: string;
  }[];
  affectedReservationCount: number;
}

export interface HomeClosure {
  branchId: string;
  branchName: string;
  date: string;
  note: string | null;
  today: boolean;
}

export function shiftClosureDate(date: string, days: number) {
  return new Date(Date.parse(date) + days * 86400000)
    .toISOString()
    .slice(0, 10);
}
