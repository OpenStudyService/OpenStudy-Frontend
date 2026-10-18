import fs from "node:fs/promises";
import { z } from "zod";
import { schemas, resources } from "../src/shared/domain/schema";
import type { Entity } from "../src/shared/domain/schema";
import { catalog } from "../src/shared/domain/catalog";
import { commandFields } from "../src/shared/domain/commands";
const components: Record<string, unknown> = {
  ApiError: {
    type: "object",
    required: ["code", "message"],
    properties: {
      code: { type: "string" },
      message: { type: "string" },
      fieldErrors: { type: "object", additionalProperties: { type: "string" } },
      requestId: { type: "string" },
    },
  },
  PageMeta: {
    type: "object",
    required: ["page", "pageSize", "total"],
    properties: {
      page: { type: "integer" },
      pageSize: { type: "integer" },
      total: { type: "integer" },
      nextCursor: { type: "string" },
    },
  },
};
const paths: Record<string, unknown> = {};
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const response = (schema: unknown) => ({
  "200": { description: "성공", content: { "application/json": { schema } } },
  "401": {
    description: "인증 필요",
    content: { "application/json": { schema: ref("ApiError") } },
  },
  "403": {
    description: "지점·행동 권한 없음",
    content: { "application/json": { schema: ref("ApiError") } },
  },
  "409": {
    description: "버전/자원/멱등 충돌",
    content: { "application/json": { schema: ref("ApiError") } },
  },
  "422": {
    description: "입력 오류",
    content: { "application/json": { schema: ref("ApiError") } },
  },
});
for (const resource of resources) {
  const schema = z.toJSONSchema(schemas[resource], { target: "draft-7" });
  delete schema.$schema;
  components[resource] = schema;
  const fields = new Set(catalog[resource]?.fields.map((f) => f.key));
  const input = schemas[resource].partial().pick(
    Object.fromEntries(
      Object.keys(schemas[resource].shape)
        .filter((k) => fields.has(k))
        .map((k) => [k, true]),
    ) as never,
  );
  const createSchema = z.toJSONSchema(input, { target: "draft-7" });
  delete createSchema.$schema;
  const definition = catalog[resource];
  if (definition?.fields.some((f) => f.key === "simulateFailure"))
    createSchema.properties = {
      ...createSchema.properties,
      simulateFailure: { type: "boolean", description: "Mock mode only" },
    };
  createSchema.required =
    definition?.fields
      .filter((f) => f.required && f.key !== "simulateFailure")
      .map((f) => f.key) || [];
  components[`${resource}Input`] = createSchema;
  components[`${resource}Update`] = {
    ...createSchema,
    properties: {
      ...createSchema.properties,
      version: { type: "integer", minimum: 1 },
    },
    required: ["version"],
  };
  paths[`/${resource}`] = {
    get: {
      summary: `${catalog[resource]?.title || resource} 목록`,
      parameters: [
        { name: "scope", in: "query", schema: { type: "string" } },
        { name: "page", in: "query", schema: { type: "integer", minimum: 1 } },
        {
          name: "pageSize",
          in: "query",
          schema: { type: "integer", maximum: 100 },
        },
        { name: "q", in: "query", schema: { type: "string" } },
        { name: "status", in: "query", schema: { type: "string" } },
        { name: "sort", in: "query", schema: { type: "string" } },
        ...["direction", "assigneeId", "mine", "date", "from", "to"].map(
          (name) => ({ name, in: "query", schema: { type: "string" } }),
        ),
      ],
      responses: response({
        allOf: [
          ref("PageMeta"),
          {
            type: "object",
            required: ["items"],
            properties: { items: { type: "array", items: ref(resource) } },
          },
        ],
      }),
    },
    ...(catalog[resource]?.create
      ? {
          post: {
            summary: `${catalog[resource]?.singular} 등록`,
            requestBody: {
              required: true,
              content: {
                "application/json": { schema: ref(`${resource}Input`) },
              },
            },
            responses: response(ref(resource)),
          },
        }
      : {}),
  };
  paths[`/${resource}/{id}`] = {
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
    ],
    get: { responses: response(ref(resource)) },
    ...(catalog[resource]?.edit
      ? {
          patch: {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: ref(`${resource}Update`),
                },
              },
            },
            responses: response(ref(resource)),
          },
        }
      : {}),
  };
  for (const action of [
    ...(catalog[resource]?.actions || []),
    ...(resource === "employees"
      ? [{ key: "permissions", label: "지점별 소속·권한 변경" }]
      : []),
  ]) {
    if (action.key === "history") continue;
    const fields = commandFields(resource, action.key, {
      status: "신청",
    } as Entity);
    const properties = Object.fromEntries(
      fields.map((f) => [
        f.key,
        {
          type: f.type === "number" ? "number" : "string",
          ...(f.min !== undefined ? { minimum: f.min } : {}),
          ...(f.options ? { enum: f.options } : {}),
        },
      ]),
    );
    if (action.key === "permissions")
      properties.memberships = z.toJSONSchema(
        schemas.employees.shape.memberships,
      ) as never;
    paths[`/${resource}/{id}/${action.key}`] = {
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
      ],
      post: {
        summary: action.label,
        description:
          "명령별 입력과 승인 정책은 API 계약 설명서 참조. Idempotency-Key 사용.",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { version: { type: "integer" }, ...properties },
                required: [
                  "version",
                  ...fields.filter((f) => f.required).map((f) => f.key),
                  ...(action.key === "permissions" ? ["memberships"] : []),
                ],
                additionalProperties: false,
              },
            },
          },
        },
        responses: response(
          ref(action.key === "share" ? "messages" : resource),
        ),
      },
    };
  }
}
for (const [path, method, summary] of [
  ["/auth/csrf", "get", "CSRF 토큰 조회"],
  ["/auth/login", "post", "직원 로그인"],
  ["/auth/logout", "post", "로그아웃"],
  ["/me", "get", "현재 사용자와 허용 지점"],
  ["/me/profile", "patch", "본인 프로필 변경"],
  ["/lookups", "get", "허용 범위의 선택 항목"],
  ["/home", "get", "원장 기반 홈 집계"],
  ["/sales", "get", "일반 매출"],
  ["/leave-balances", "get", "휴가 잔여량"],
  ["/invitations/preview", "get", "초대 유효성 확인"],
  ["/invitations/accept", "post", "초대 수락"],
  ["/attendance/clockin", "post", "본인 출근"],
  ["/chat/channels", "get", "참여 대화와 미확인 수"],
  ["/chat/dm", "post", "DM 생성·재사용"],
  ["/chat/{channelId}/messages", "get", "커서 이력"],
  ["/chat/{channelId}/messages", "post", "메시지 전송"],
  ["/chat/{channelId}/read", "post", "읽음 위치"],
  ["/workspace/events", "get", "업무 공간 SSE"],
] as const) {
  const params = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => ({
    name: m[1],
    in: "path",
    required: true,
    schema: { type: "string" },
  }));
  paths[path] = {
    ...((paths[path] as object) || {}),
    [method]: {
      summary,
      parameters: params,
      responses: response({ type: "object", additionalProperties: true }),
    },
  };
}
const object = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", properties, required, additionalProperties: false });
const string = { type: "string" };
const array = (name: string) => ({ type: "array", items: ref(name) });
components.CurrentUser = object({
  user: ref("employees"),
  branches: array("branches"),
  asOf: string,
  snapshotVersion: string,
});
components.Lookups = object(
  Object.fromEntries(
    [
      "branches",
      "employees",
      "members",
      "products",
      "passes",
      "rooms",
      "seats",
      "shifts",
      "attendance",
      "channels",
    ].map((name) => [name, array(name)]),
  ),
);
components.Home = object(
  Object.fromEntries(
    [
      "tasks",
      "seats",
      "facilities",
      "inquiries",
      "notices",
      "shifts",
      "attendance",
      "messages",
    ].map((name) => [name, array(name)]),
  ),
);
components.SalesRow = object({
  branchId: string,
  branch: string,
  approved: { type: "number" },
  refunds: { type: "number" },
  net: { type: "number" },
});
components.Sales = object({ rows: array("SalesRow"), asOf: string });
components.ChatMessages = object(
  { items: array("messages"), nextCursor: string, total: { type: "integer" } },
  ["items", "total"],
);
type Operation = {
  responses?: unknown;
  requestBody?: unknown;
  parameters?: unknown[];
  security?: unknown[];
};
const operation = (path: string, method: string) =>
  (paths[path] as Record<string, Operation>)[method];
const setBody = (path: string, method: string, schema: unknown) => {
  operation(path, method).requestBody = {
    required: true,
    content: { "application/json": { schema } },
  };
};
const setResponse = (path: string, method: string, schema: unknown) => {
  operation(path, method).responses = response(schema);
};
for (const [path, name] of [
  ["/me", "CurrentUser"],
  ["/lookups", "Lookups"],
  ["/home", "Home"],
  ["/sales", "Sales"],
])
  setResponse(path, "get", ref(name));
setResponse("/auth/csrf", "get", object({ token: string }));
setBody(
  "/auth/login",
  "post",
  object({
    email: { type: "string", format: "email" },
    password: { type: "string", minLength: 8 },
  }),
);
setResponse("/auth/login", "post", ref("CurrentUser"));
setBody(
  "/me/profile",
  "patch",
  object({
    nickname: string,
    avatar: string,
  }),
);
setResponse("/me/profile", "patch", ref("CurrentUser"));
setBody(
  "/invitations/accept",
  "post",
  object(
    {
      token: string,
      email: { type: "string", format: "email" },
      password: { type: "string", minLength: 8 },
    },
    ["token", "email"],
  ),
);
setResponse("/invitations/accept", "post", ref("CurrentUser"));
setResponse(
  "/invitations/preview",
  "get",
  object({ name: string, email: string, branchId: string, expiresAt: string }),
);
operation("/invitations/preview", "get").parameters = [
  { name: "token", in: "query", required: true, schema: string },
];
setBody("/attendance/clockin", "post", object({ branchId: string }));
setResponse("/attendance/clockin", "post", ref("attendance"));
setBody("/chat/dm", "post", object({ employeeId: string }));
setResponse("/chat/dm", "post", ref("channels"));
components.ChatChannel = {
  allOf: [
    ref("channels"),
    {
      type: "object",
      required: ["unread"],
      properties: { unread: { type: "integer" } },
    },
  ],
};
setResponse("/chat/channels", "get", array("ChatChannel"));
setResponse("/chat/{channelId}/messages", "get", ref("ChatMessages"));
setBody(
  "/chat/{channelId}/messages",
  "post",
  object({
    text: { type: "string", maxLength: 4000 },
    parentId: string,
    taskId: string,
    clientMessageId: string,
  }),
);
setResponse("/chat/{channelId}/messages", "post", ref("messages"));
operation("/chat/{channelId}/messages", "get").parameters = [
  ...(operation("/chat/{channelId}/messages", "get").parameters || []),
  ...["before", "after", "parent"].map((name) => ({
    name,
    in: "query",
    schema: string,
  })),
];
setBody(
  "/chat/{channelId}/read",
  "post",
  object({ sequence: { type: "integer", minimum: 0 } }),
);
operation("/workspace/events", "get").responses = {
  "200": {
    description:
      "connected / workspace / heartbeat. Last-Event-ID or cursor resumes.",
    content: { "text/event-stream": { schema: { type: "string" } } },
  },
};
components.WorkspaceEvent = object({
  id: string,
  type: { type: "string", enum: ["changed", "message", "read", "permissions"] },
  resource: { type: "string", enum: resources },
  entityId: string,
  branchId: string,
});
paths["/members/{id}/history"] = {
  parameters: [{ name: "id", in: "path", required: true, schema: string }],
  get: {
    responses: response(
      object({
        usage: array("usage"),
        reservations: array("reservations"),
        passes: array("passes"),
        payments: array("payments"),
      }),
    ),
  },
};
setResponse("/leave-balances", "get", {
  type: "array",
  items: object({
    employeeId: string,
    name: string,
    balance: { type: "number" },
  }),
});
for (const path of ["/home", "/lookups", "/chat/channels", "/leave-balances"])
  operation(path, "get").parameters = [
    { name: "scope", in: "query", schema: string },
  ];
operation("/sales", "get").parameters = ["scope", "start", "end", "basis"].map(
  (name) => ({ name, in: "query", schema: string }),
);
for (const path of [
  "/auth/csrf",
  "/auth/login",
  "/invitations/preview",
  "/invitations/accept",
])
  operation(
    path,
    path.endsWith("csrf") || path.endsWith("preview") ? "get" : "post",
  ).security = [];
for (const item of Object.values(paths))
  for (const method of ["post", "patch"]) {
    const op = (item as Record<string, Operation>)[method];
    if (op)
      op.parameters = [
        ...(op.parameters || []),
        { name: "X-CSRF-Token", in: "header", required: true, schema: string },
        { name: "Idempotency-Key", in: "header", schema: string },
      ];
  }
const spec = {
  openapi: "3.1.0",
  info: {
    title: "OpenStudy consumer API",
    version: "0.1.0",
    description:
      "프론트엔드/모킹 계약 초안. 실제 서버 구현 및 DomainLens 엔진 계약은 별도 검증한다.",
  },
  servers: [{ url: "/api" }],
  security: [{ sessionCookie: [] }],
  paths,
  components: {
    schemas: components,
    securitySchemes: {
      sessionCookie: {
        type: "apiKey",
        in: "cookie",
        name: "OPENSTUDY_SESSION",
      },
    },
  },
};
await fs.mkdir("docs/api", { recursive: true });
await fs.writeFile(
  "docs/api/openapi.json",
  JSON.stringify(spec, null, 2) + "\n",
);
console.log(`Generated contract: ${resources.length} resources`);
