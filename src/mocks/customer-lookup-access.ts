/** Demo-only lookup evidence, scoped to the same actor, branch and in-memory ledger. */
import { store } from "./store";
const evidence = new WeakMap<object, Set<string>>();
const key = (actor: string, branch: string, customer: string) =>
  JSON.stringify([actor, branch, customer]);
export function rememberCustomerLookup(
  actor: string,
  branch: string,
  customer: string,
) {
  let found = evidence.get(store.db);
  if (!found) {
    found = new Set();
    evidence.set(store.db, found);
  }
  found.add(key(actor, branch, customer));
}
export function hasCustomerLookup(
  actor: string,
  branch: string,
  customer: string,
) {
  return evidence.get(store.db)?.has(key(actor, branch, customer)) ?? false;
}
