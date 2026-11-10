import type { ResourceMap } from "../shared/domain/schema";
import { DomainError, store } from "./store";

type Member = ResourceMap["members"];

export const matchesCustomer = (originalId: string, requestedId: string) =>
  originalId === requestedId ||
  store.db.members.some(
    (row) => row.id === originalId && row.mergedIntoCustomerId === requestedId,
  );

export function rejectMergedCustomer(
  row: Member,
  code: "CUSTOMER_NOT_ACTIVE" | "CUSTOMER_ALREADY_MERGED",
) {
  if (row.mergedIntoCustomerId)
    throw new DomainError(
      409,
      code,
      "이미 병합된 고객입니다.",
      undefined,
      undefined,
      undefined,
      {
        mergedIntoCustomerId: row.mergedIntoCustomerId,
      },
    );
}
