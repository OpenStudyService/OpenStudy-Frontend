import { api, queryString } from "../../shared/api/client";
import { asPage } from "../../shared/api/read-model";
import { schemas } from "../../shared/domain/schema";
import type { Employee, Task } from "../../shared/domain/schema";
import type { TaskAction } from "./model";

// Existing demo endpoints; do not infer the future collaboration contract here.
export const taskApi = {
  async list(scope: string, search: string, signal: AbortSignal) {
    const params = new URLSearchParams(search);
    const request = new URLSearchParams();
    for (const key of [
      "q",
      "status",
      "assigneeId",
      "mine",
      "date",
      "sort",
      "direction",
      "page",
      "pageSize",
    ]) {
      const value = params.get(key);
      if (value) request.set(key, value);
    }
    request.set("scope", scope);
    const page = asPage<Task>(
      await api<unknown>(`/tasks?${request}`, { signal }),
    );
    return {
      ...page,
      items: page.items.map((row) => schemas.tasks.parse(row)),
    };
  },
  async detail(scope: string, id: string, signal: AbortSignal) {
    return schemas.tasks.parse(
      await api<unknown>(
        `/tasks/${encodeURIComponent(id)}?${queryString({ scope })}`,
        { signal },
      ),
    );
  },
  async assignees(branch: string, signal: AbortSignal) {
    const data = await api<{ employees?: unknown[] }>(
      `/lookups?${queryString({ scope: branch })}`,
      { signal },
    );
    // Minimal live id/name rows prove neither active status nor branch membership.
    return (data?.employees ?? []).flatMap((row) => {
      const parsed = schemas.employees.safeParse(row);
      if (!parsed.success) return [];
      const employee: Employee = parsed.data;
      return employee.status === "활성" &&
        (employee.owner ||
          employee.memberships.some(
            (m) => m.branchId === branch && (!m.status || m.status === "활성"),
          ))
        ? [employee]
        : [];
    });
  },
  create(body: Record<string, unknown>, signal: AbortSignal, key: string) {
    return api<Task>("/tasks", { method: "POST", body, signal, key });
  },
  update(
    id: string,
    body: Record<string, unknown>,
    signal: AbortSignal,
    key: string,
  ) {
    return api<Task>(`/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body,
      signal,
      key,
    });
  },
  action(
    scope: string,
    id: string,
    action: TaskAction,
    version: number,
    signal: AbortSignal,
    key: string,
  ) {
    return api<unknown>(
      `/tasks/${encodeURIComponent(id)}/${action}?${queryString({ scope })}`,
      { method: "POST", body: { version }, signal, key },
    );
  },
};
