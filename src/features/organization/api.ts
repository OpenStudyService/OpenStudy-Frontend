import { z } from "zod";
import { api, ApiError } from "../../shared/api/client";
import { permissions } from "../../shared/domain/schema";

const version = z.number().int().positive();
const membership = z.object({
  branchId: z.string(),
  role: z.enum(["admin", "staff"]),
  status: z.enum(["활성", "승인 대기", "회수"]),
  version,
  permissions: z.array(z.enum(permissions)),
});
const branch = z.object({
  id: z.string(),
  version,
  name: z.string(),
  code: z.string(),
  address: z.string(),
  phone: z.string(),
  hours: z.string(),
  status: z.enum(["운영 중", "운영 중지"]),
  weeklyHours: z
    .array(
      z.object({
        weekday: z.number().int().min(1).max(7),
        isClosed: z.boolean(),
        opensMinute: z.number().nullable(),
        closesMinute: z.number().nullable(),
      }),
    )
    .length(7),
});
const employee = z.object({
  id: z.string(),
  version,
  name: z.string(),
  email: z.string(),
  status: z.enum(["활성", "승인 대기", "이용 제한", "비활성"]),
  owner: z.boolean(),
  memberships: z.array(membership),
});
const preset = z.object({
  id: z.string(),
  version,
  name: z.string(),
  role: z.enum(["admin", "staff"]),
  system: z.boolean(),
  permissions: z.array(z.enum(permissions)),
});
const meta = z.object({
  page: version,
  pageSize: version,
  total: z.number().int().nonnegative(),
});
/** Legacy preview DTOs must never be upgraded into fabricated editable records. */
export function validateOrganization(path: string, value: unknown) {
  const clean = path.split("?")[0];
  const shape =
    clean === "/permissions"
      ? z.array(
          z.object({
            code: z.enum(permissions),
            description: z.string(),
            adminOnly: z.boolean(),
          }),
        )
      : clean === "/branches"
        ? z.object({ items: z.array(branch), meta })
        : clean === "/employees"
          ? z.object({ items: z.array(employee), meta })
          : clean === "/permission-presets"
            ? z.object({ items: z.array(preset), meta })
            : clean.startsWith("/branches/")
              ? branch
              : clean.startsWith("/employees/")
                ? employee
                : undefined;
  if (shape && !shape.safeParse(value).success)
    throw new ApiError(0, {
      code: "UNSUPPORTED_ORGANIZATION_RESPONSE",
      message:
        "이 서버는 지점·직원 관리 계약을 지원하지 않습니다. 운영시간·소속 버전이 있는 API를 배포한 후 다시 시도해 주세요.",
    });
}
export async function organizationRead<T>(
  path: string,
  signal?: AbortSignal,
): Promise<T> {
  const value = await api<T>(path, { signal });
  validateOrganization(path, value);
  return value;
}
