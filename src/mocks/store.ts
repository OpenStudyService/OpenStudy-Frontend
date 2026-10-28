import { AS_OF, resources } from "../shared/domain/schema";
import type {
  Database,
  Employee,
  Resource,
  ResourceMap,
  WorkspaceEvent,
} from "../shared/domain/schema";
import { seed } from "./seed";
import { reconcileChannels } from "../features/chat/model";

const KEY = "openstudy-mock-v1";
export class DomainError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fieldErrors?: Record<string, string>,
    public latestVersion?: number,
    public reloadUrl?: string,
  ) {
    super(message);
  }
}
export function assert(
  condition: unknown,
  message: string,
  status = 409,
  code = "CONFLICT",
): asserts condition {
  if (!condition) throw new DomainError(status, code, message);
}
type Listener = (event: WorkspaceEvent) => void;
interface Saved {
  db: Database;
  persona: string | null;
  sequence: number;
  idempotency: Record<
    string,
    { fingerprint: string; result: unknown; authorization: string }
  >;
}
export class MockStore {
  db: Database = seed();
  persona: string | null = null;
  sequence = 100;
  scenario = "normal";
  listeners = new Set<Listener>();
  events: WorkspaceEvent[] = [];
  idempotency: Saved["idempotency"] = {};
  constructor(private persistent = true) {
    if (persistent)
      try {
        const raw = sessionStorage.getItem(KEY);
        if (raw) {
          const x = JSON.parse(raw) as Saved;
          if (resources.every((r) => Array.isArray(x.db[r]))) {
            this.db = x.db;
            this.persona = x.persona;
            this.sequence = x.sequence;
            this.idempotency = x.idempotency;
          }
        }
      } catch {
        /* restricted storage */
      }
  }
  persist() {
    if (this.persistent)
      try {
        sessionStorage.setItem(
          KEY,
          JSON.stringify({
            db: this.db,
            persona: this.persona,
            sequence: this.sequence,
            idempotency: this.idempotency,
          }),
        );
      } catch {
        /* current session still works */
      }
  }
  reset() {
    this.db = seed();
    this.sequence = 100;
    this.idempotency = {};
    this.events = [];
    this.persist();
  }
  now() {
    return new Date(
      Date.parse(AS_OF) + (Date.now() - this.startedAt),
    ).toISOString();
  }
  private startedAt = Date.now();
  user(): Employee {
    const u = this.db.employees.find((p) => p.id === this.persona);
    assert(u, "로그인이 필요합니다.", 401, "UNAUTHENTICATED");
    return u;
  }
  activeUser() {
    const u = this.user();
    assert(
      u.status === "활성",
      u.status === "승인 대기"
        ? "관리자의 최종 승인을 기다리고 있습니다."
        : "사용할 수 없는 계정입니다.",
      403,
      "ACCOUNT_INACTIVE",
    );
    return u;
  }
  get<K extends Resource>(resource: K, id: string): ResourceMap[K] {
    const row = (this.db[resource] as ResourceMap[K][]).find(
      (x) => x.id === id,
    );
    assert(row, "대상을 찾을 수 없습니다.", 404, "NOT_FOUND");
    return row;
  }
  add<K extends Resource>(
    resource: K,
    branchId: string,
    data: Omit<
      ResourceMap[K],
      "id" | "branchId" | "version" | "createdAt" | "updatedAt"
    >,
  ): ResourceMap[K] {
    const at = this.now();
    const row = {
      id: crypto.randomUUID(),
      branchId,
      version: 1,
      createdAt: at,
      updatedAt: at,
      ...data,
    } as ResourceMap[K];
    (this.db[resource] as ResourceMap[K][]).push(row);
    return row;
  }
  emit(
    resource: Resource,
    entityId: string,
    branchId: string,
    type: WorkspaceEvent["type"] = "changed",
  ) {
    if (resource === "employees" || type === "permissions")
      reconcileChannels(this.db, this.now());
    const e = {
      id: String(++this.sequence),
      type,
      resource,
      entityId,
      branchId,
    };
    this.events.push(e);
    if (this.events.length > 1000) this.events.shift();
    this.persist();
    for (const listener of this.listeners) listener(e);
  }
  transaction<T>(key: string | undefined, body: unknown, fn: () => T): T {
    const scoped = key ? `${this.persona}:${key}` : undefined,
      fingerprint = JSON.stringify(body),
      user = this.activeUser(),
      authorization = JSON.stringify([
        user.status,
        user.owner,
        user.memberships,
      ]);
    if (scoped && this.idempotency[scoped]) {
      const prior = this.idempotency[scoped];
      assert(
        prior.authorization === authorization,
        "권한이 변경되어 이전 요청을 재사용할 수 없습니다.",
        403,
        "AUTHORIZATION_CHANGED",
      );
      assert(
        prior.fingerprint === fingerprint,
        "동일 요청 키에 다른 내용이 전달되었습니다.",
        409,
        "IDEMPOTENCY_CONFLICT",
      );
      return structuredClone(prior.result) as T;
    }
    const before = structuredClone(this.db);
    try {
      const result = fn();
      if (scoped)
        this.idempotency[scoped] = {
          fingerprint,
          result: structuredClone(result),
          authorization,
        };
      this.persist();
      return result;
    } catch (error) {
      this.db = before;
      throw error;
    }
  }
}
export const store = new MockStore(typeof window !== "undefined");
