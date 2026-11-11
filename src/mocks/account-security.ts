import { HttpResponse } from "msw/http";
import { assert, DomainError, store } from "./store";
import { organizationEmployee } from "./organization";
import { canManageBranch } from "../features/organization/model";

let db: typeof store.db | undefined;
const passwords = new Map<string, string | null>();
const failed = new Map<string, number>();
const links = new Map<string, { id: string; expiresAt: string }>();
const photos = new Map<
  string,
  { url: string; bytes: ArrayBuffer; mime: string }
>();

function expiresAt(requestedAt: string) {
  return new Date(Date.parse(requestedAt) + 30 * 60_000).toISOString();
}

function sync() {
  if (db === store.db) return;
  db = store.db;
  passwords.clear();
  failed.clear();
  links.clear();
  links.set("demo-password-reset", {
    id: "junho",
    expiresAt: expiresAt(store.now()),
  });
  photos.clear();
}

export function mockPasswordMatches(id: string, value: string) {
  sync();
  return passwords.has(id) ? passwords.get(id) === value : value.length >= 8;
}

export function mockLoginAllowed(id: string, value: string) {
  sync();
  assert(
    (failed.get(id) ?? 0) < 5,
    "잠시 후 다시 시도해 주세요.",
    429,
    "RATE_LIMITED",
  );
  if (mockPasswordMatches(id, value)) {
    failed.delete(id);
    return true;
  }
  failed.set(id, (failed.get(id) ?? 0) + 1);
  return false;
}

function validation(
  field: string,
  message: string,
  code = "VALIDATION_FAILED",
) {
  return new DomainError(422, code, message, { [field]: message });
}

function password(value: unknown, field: "currentPassword" | "newPassword") {
  if (
    typeof value !== "string" ||
    Array.from(value).length < (field === "newPassword" ? 8 : 1) ||
    new TextEncoder().encode(value).length > 72
  )
    throw validation(field, "비밀번호 형식을 확인해 주세요.");
  return value;
}

export function changePassword(body: Record<string, unknown>) {
  const { id } = store.activeUser();
  const current = password(body.currentPassword, "currentPassword");
  const next = password(body.newPassword, "newPassword");
  if (!mockLoginAllowed(id, current))
    throw validation(
      "currentPassword",
      "기존 비밀번호가 일치하지 않아요.",
      "CURRENT_PASSWORD_MISMATCH",
    );
  if (next === current)
    throw validation(
      "newPassword",
      "기존 비밀번호와 다른 비밀번호를 입력해 주세요.",
      "PASSWORD_SAME_AS_CURRENT",
    );
  passwords.set(id, next);
  return new HttpResponse(null, { status: 204 });
}

function manageable(id: string, reset: boolean) {
  const actor = store.activeUser();
  const target = organizationEmployee(store.get("employees", id));
  const memberships = target.memberships.filter((m) =>
    canManageBranch(actor, m.branchId, "people:manage"),
  );
  assert(
    actor.owner || memberships.length,
    "직원을 찾을 수 없어요.",
    404,
    "NOT_FOUND",
  );
  assert(
    !reset || actor.id !== id,
    "본인 비밀번호는 설정에서 변경해 주세요.",
    403,
    "SELF_RESET_FORBIDDEN",
  );
  assert(
    actor.owner ||
      (!target.owner && memberships.some((m) => m.status === "활성")),
    "계정을 관리할 권한이 없어요.",
    403,
    "FORBIDDEN",
  );
  return target;
}

/** Mail double for mock fixtures. Tokens are kept in memory and never included in API responses. */
export function mockResetMailToken(id: string) {
  sync();
  return [...links].find(([, entry]) => entry.id === id)?.[0];
}

export function requestPasswordReset(id: string) {
  sync();
  const target = manageable(id, true);
  assert(
    target.status === "활성",
    "활성 계정에서만 초기화할 수 있어요.",
    409,
    "INVALID_STATE",
  );
  const old = mockResetMailToken(id);
  if (old) links.delete(old);
  const requestedAt = store.now();
  links.set(crypto.randomUUID(), {
    id,
    expiresAt: expiresAt(requestedAt),
  });
  passwords.set(id, null);
  return HttpResponse.json(
    { employeeId: id, requestedAt, delivery: "PENDING" },
    { status: 202 },
  );
}

export function unlockLogin(id: string) {
  sync();
  manageable(id, false);
  return { employeeId: id, wasLocked: failed.delete(id) };
}

function resetLink(token: unknown) {
  sync();
  if (typeof token !== "string" || !token)
    throw validation("token", "재설정 토큰이 필요해요.");
  const link = links.get(token);
  const target = store.db.employees.find(
    (employee) => employee.id === link?.id,
  );
  assert(
    link && target?.status === "활성" && link.expiresAt > store.now(),
    "재설정 링크를 다시 요청해 주세요.",
    422,
    "PASSWORD_RESET_LINK_INVALID",
  );
  return { link, target };
}

export function previewPasswordReset(body: Record<string, unknown>) {
  const { link, target } = resetLink(body.token);
  const [local, domain] = target.email.split("@");
  return {
    expiresAt: link.expiresAt,
    emailHint: `${local.slice(0, local.length <= 2 ? 1 : 2)}***@${domain}`,
  };
}

export function completePasswordReset(body: Record<string, unknown>) {
  const next = password(body.newPassword, "newPassword");
  const { link } = resetLink(body.token);
  passwords.set(link.id, next);
  failed.delete(link.id);
  links.delete(String(body.token));
  return new HttpResponse(null, { status: 204 });
}

export async function uploadAvatar(request: Request) {
  sync();
  const user = store.activeUser();
  const data = await request.formData().catch(() => null);
  const file = data?.get("file");
  if (!file || typeof file === "string" || [...data!.keys()].length !== 1)
    throw validation("file", "사진 파일 하나를 선택해 주세요.");
  if (file.size > 5_242_880)
    throw validation("file", "사진은 5MB 이하여야 해요.", "AVATAR_TOO_LARGE");
  const bytes = await file.arrayBuffer();
  const header = new Uint8Array(bytes, 0, Math.min(12, bytes.byteLength));
  const startsWith = (signature: number[], offset = 0) =>
    signature.every((byte, index) => header[index + offset] === byte);
  let mime;
  if (startsWith([0xff, 0xd8, 0xff])) mime = "image/jpeg";
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    mime = "image/png";
  if (startsWith([82, 73, 70, 70]) && startsWith([87, 69, 66, 80], 8))
    mime = "image/webp";
  if (!mime)
    throw validation(
      "file",
      "JPG, PNG, WebP 사진만 사용할 수 있어요.",
      "AVATAR_TYPE_UNSUPPORTED",
    );
  const url = `/api/employees/${user.id}/avatar?v=${crypto.randomUUID()}`;
  photos.set(user.id, { url, bytes, mime });
  user.avatar = url;
  user.version++;
}

export function deleteAvatar() {
  sync();
  const user = store.activeUser();
  photos.delete(user.id);
  user.avatar = "";
  user.version++;
}

export function readAvatar(id: string) {
  sync();
  const actor = organizationEmployee(store.activeUser());
  const target = organizationEmployee(store.get("employees", id));
  const allowed =
    actor.id === id ||
    actor.owner ||
    target.memberships.some(
      (m) =>
        m.status === "활성" &&
        actor.memberships.some(
          (own) => own.status === "활성" && own.branchId === m.branchId,
        ),
    );
  const photo = photos.get(id);
  assert(
    allowed && photo && target.avatar === photo.url,
    "사진을 찾을 수 없어요.",
    404,
    "NOT_FOUND",
  );
  return new HttpResponse(photo.bytes, {
    headers: {
      "Content-Type": photo.mime,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
