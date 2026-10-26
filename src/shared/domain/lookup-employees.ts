import type { LookupEmployee } from "./schema";

export function employeeLookupNeedsScope(
  employees: LookupEmployee[],
  branch: string,
  lookupScope: string,
) {
  return (
    branch !== lookupScope &&
    employees.some((employee) => !employee.owner && !employee.memberships)
  );
}

export function employeeLookupInBranch(
  employee: LookupEmployee,
  branch: string,
  lookupScope: string,
) {
  if (employee.owner) return true;
  if (employee.memberships)
    return (
      branch === "all" ||
      employee.memberships.some((membership) => membership.branchId === branch)
    );
  // Minimum rows have already been filtered for the server request's scope.
  // They carry no evidence about membership in a different branch.
  return branch === lookupScope;
}
