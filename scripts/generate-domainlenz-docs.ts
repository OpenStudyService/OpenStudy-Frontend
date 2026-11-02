import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import {
  DEMO_AS_OF,
  domains,
  scenarios,
  querySpecFor,
  viewSpecFor,
} from "../src/mocks/domainlenz/catalog";
import { makeResult, resultTotal } from "../src/mocks/domainlenz/model";
const cached = existsSync("docs/domainlenz/schema-evidence.json")
  ? JSON.parse(readFileSync("docs/domainlenz/schema-evidence.json", "utf8"))
  : undefined;
const backend =
  process.env.DOMAINLENZ_BACKEND_ROOT ??
  [resolve("../openstudy-backend"), resolve("../../openstudy-backend")].find(
    (path) => existsSync(resolve(path, ".git")),
  );
if (
  process.env.DOMAINLENZ_BACKEND_ROOT &&
  !existsSync(process.env.DOMAINLENZ_BACKEND_ROOT)
)
  throw new Error("DOMAINLENZ_BACKEND_ROOT does not exist");
if (!backend && !cached)
  throw new Error(
    "Provide DOMAINLENZ_BACKEND_ROOT or the packaged schema-evidence.json",
  );
const revision =
  process.env.DOMAINLENZ_BACKEND_REVISION ??
  cached?.backendRevision ??
  execFileSync("git", ["-C", backend!, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
const read = (path: string) =>
  execFileSync("git", ["-C", backend!, "show", `${revision}:${path}`], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
const migrationPaths: string[] = backend
  ? execFileSync(
      "git",
      [
        "-C",
        backend,
        "ls-tree",
        "-r",
        "--name-only",
        revision,
        "src/main/resources/db/migration",
      ],
      { encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .filter((p) => p.endsWith(".sql"))
  : cached.migrationPaths;
const ddl = backend ? migrationPaths.map(read).join("\n") : "";
const tableColumns = new Map<string, Set<string>>();
for (const match of ddl.matchAll(
  /CREATE TABLE `([^`]+)` \(([\s\S]*?)\) ENGINE/g,
))
  tableColumns.set(
    match[1],
    new Set([...match[2].matchAll(/^ {2}`([^`]+)`/gm)].map((m) => m[1])),
  );
for (const match of ddl.matchAll(/ALTER TABLE `([^`]+)`([\s\S]*?);/g))
  for (const field of match[2].matchAll(/ADD COLUMN `([^`]+)`/g))
    tableColumns.get(match[1])?.add(field[1]);
if (!backend)
  for (const domain of cached.domains)
    for (const source of domain.sources) {
      const fields = tableColumns.get(source.table) ?? new Set<string>();
      for (const field of source.fields) fields.add(field);
      tableColumns.set(source.table, fields);
    }
const api = backend
  ? JSON.parse(read("docs/design/foundation/openapi.json"))
  : {
      paths: Object.fromEntries(
        cached.domains.flatMap(
          (domain: {
            apiEvidence: { path: string; definedInOpenApi: boolean }[];
          }) =>
            domain.apiEvidence
              .filter((p) => p.definedInOpenApi)
              .map((p) => [p.path, {}]),
        ),
      ),
    };
const evidence = domains.map((d) => ({
  ...d,
  apiEvidence: d.apiPaths.map((path) => ({
    path,
    definedInOpenApi: !!api.paths?.[path],
  })),
  sources: d.sources.map((s) => {
    for (const field of s.fields)
      if (!tableColumns.get(s.table)?.has(field))
        throw new Error(`Unknown physical field ${s.table}.${field}`);
    return { ...s, verified: true };
  }),
}));
await mkdir("docs/domainlenz", { recursive: true });
const json = (name: string, value: unknown) =>
  writeFile(
    `docs/domainlenz/${name}`,
    JSON.stringify(value, null, 2) + "\n",
    "utf8",
  );
await json("schema-evidence.json", {
  backendRepository: "OpenStudyService/OpenStudy-Backend",
  backendRevision: revision,
  migrationPaths,
  apiSource: "docs/design/foundation/openapi.json",
  note: "Committed sources only. OpenAPI presence is not runtime implementation verification. Uncommitted work excluded.",
  domains: evidence,
});
await json("natural-language-tests.json", {
  schemaVersion: "demo-v1-proposal",
  asOf: DEMO_AS_OF,
  scope: "all",
  channelId: "general",
  dataMode: "synthetic-fixed",
  cases: scenarios.map((s) => ({
    id: s.id,
    domainId: s.domainId,
    prompt: s.prompt,
    outcome: s.outcome,
    metric: s.metric,
    grain: s.grain,
    period: s.period,
    querySpec: querySpecFor(s, "all"),
    viewSpec: viewSpecFor(s),
    expected: {
      displayResult: ["ready", "empty", "fallback"].includes(s.outcome),
      rowCount: ["ready", "empty", "fallback"].includes(s.outcome)
        ? s.rows.length
        : 0,
      total: ["ready", "empty", "fallback"].includes(s.outcome)
        ? resultTotal(makeResult(s, "all", "general"))
        : null,
      rows: ["ready", "empty", "fallback"].includes(s.outcome) ? s.rows : [],
    },
    sourceRefs: domains.find((d) => d.id === s.domainId)!.sources,
  })),
});
const link = (path: string) =>
  `https://github.com/OpenStudyService/OpenStudy-Backend/blob/${revision}/${path}`;
await writeFile(
  "docs/domainlenz/domain-catalog.md",
  `# OpenStudy 조회 도메인 사전\n\n근거 Backend: \`${revision}\`. 실제 DB 접속·조회는 수행하지 않았다. 커밋된 DDL과 OpenAPI의 구조를 확인했다. 모든 화면 데이터는 데모 전용 고정 fixture이며 다른 탭의 원장과 동기화되지 않는다.\n\n- [DDL V1](${link("src/main/resources/db/migration/V1__init_schema.sql")})\n- [고객 등록 지점 V2](${link("src/main/resources/db/migration/V2__customer_branch_and_memo.sql")})\n- [OpenAPI](${link("docs/design/foundation/openapi.json")})\n- [매출 정책](${link("docs/db/ADR-M9-001.md")})\n\n## 도메인별 원본과 준비 상태\n\n${evidence
    .map(
      (d) =>
        `### ${d.icon}. ${d.name}\n\n${d.description}. **${d.readiness}**\n\n${d.sources.map((s) => `- \`${s.table}\`: ${s.fields.map((f) => `\`${f}\``).join(", ")}`).join("\n")}\n\n관계:\n\n${d.relations.map((r) => `- ${r}`).join("\n")}\n\nAPI 계약 확인:\n\n${d.apiEvidence.map((p) => `- \`${p.path}\`: ${p.definedInOpenApi ? "OpenAPI 정의 있음" : "이 커밋의 OpenAPI 정의 없음"}`).join("\n")}\n\n권한/노출 정책: ${d.policy}.\n\n${scenarios
          .filter((s) => s.domainId === d.id && s.outcome === "ready")
          .map((s) => `- **${s.id}** — ${s.prompt}: ${s.metric}`)
          .join("\n")}`,
    )
    .join(
      "\n\n",
    )}\n\n## 관계도\n\n\`\`\`mermaid\nerDiagram\n  branches ||--o{ branch_memberships : branch_id\n  employees ||--o{ branch_memberships : employee_id\n  branches ||--o{ customers : registered_branch_id\n  customers ||--o{ payments : customer_id\n  payments ||--o{ refunds : payment_id\n  payments ||--o{ passes : purchase_payment_id\n  products ||--o{ passes : product_id\n  passes ||--o{ seat_sessions : pass_id\n  seats ||--o{ seat_sessions : seat_id\n  rooms ||--o{ room_reservations : room_id\n  lockers ||--o{ locker_assignments : locker_id\n  facilities ||--o{ facility_works : facility_id\n  conversations ||--o{ messages : conversation_id\n  work_tasks ||--o{ messages : related_task_id\n  attendance_records ||--o{ attendance_corrections : attendance_id\n  shifts ||--o{ shift_swaps : original_shift_id\n\`\`\`\n\n관계선은 FK 방향의 개략도다. 다중 조인으로 결제액·회원수 등이 중복 집계되지 않도록 원본 grain을 보존해야 한다.\n\n## 제외 필드\n\n비밀번호·토큰·세션·멱등 레코드·이벤트 outbox·메일 작업은 자연어 조회 대상이 아니다. 회원 연락처·메모, 문의 본문, 감사 before/after JSON과 개인 사유 원문을 fixture와 전달 JSON에서 제외했다.\n`,
  "utf8",
);
await writeFile(
  "docs/domainlenz/test-cases.md",
  `# 자연어 시연·인수 테스트셋\n\n총 ${scenarios.length}개: 정상 26개 + 상태 8개. 기준 2026-10-17 11:00 Asia/Seoul. 전체 지점, OWNER, 전체-공지 채널이 기본이다. JSON의 수치는 실제 DB 정답이 아닌 **프론트 고정 fixture의 기대값**이다.\n\n| ID | 도메인 | 질문 | 기대 상태 | UI | 기대 행 |\n|---|---|---|---|---|---|\n${scenarios.map((s) => `| ${s.id} | ${domains.find((d) => d.id === s.domainId)!.name} | ${s.prompt} | ${s.outcome} | ${s.outcome === "fallback" ? "표 대체" : s.view} | ${["ready", "empty", "fallback"].includes(s.outcome) ? s.rows.length : 0} |`).join("\n")}\n\n## 브라우저 시연 순서\n\n1. 전체-공지 채널에서 AI 질문 → 매출 예문 선택 → 보내기.\n2. KPI·차트·표의 순매출 합계를 비교하고 표를 정렬한다.\n3. 열기 → 상세 확인, 개발자 보기 → 근거 테이블과 협의용 명세 확인.\n4. 채널에 공유 → 강남점만 보기. 공유 카드가 원래 전체 지점 합계를 유지하는지 확인한다.\n5. 회원 제한 목록에서 다음/이전 페이지를 이동한다.\n6. 일정·문의·시설 예문을 선택한다.\n7. 상태·예외의 조건 확인, 실패, 취소, 표 대체를 확인한다.\n8. 직원 사용자로 바꾸고 공유된 전체 지점 결과가 차단되는지 확인한다. 강남점 채널의 매출 조회는 허용하지만 미확정 도메인은 차단한다.\n\n## 범위·형식 규칙\n\n- 준비된 문장에만 매칭하며 @DomainLenz 접두사, 앞뒤 공백, 문장 끝 구두점은 허용한다. 일반 메시지는 AI 실행을 만들지 않는다.\n- 채널이 지점 전용이면 질문으로 지점 범위를 확대할 수 없다. 전사 휴가는 지점 귀속 미확정이므로 전체 지점 OWNER 시연만 허용한다.\n- 날짜는 KST의 시작 포함·끝 제외를 기본으로 하되, 예약/근무/휴가는 구간 겹침 조건을 쓴다. fixture 기준 이후의 예정 근무·휴가·예약은 계획 데이터다.\n- 데모 표는 가독성을 위해 5행, 확정 M10 정책은 50행 페이지·최대 1,000행/차트 상위 20개다. fixture가 작아 이번 데모는 상한 검증·서버 페이징을 구현하지 않는다.\n- 공유는 현재 문서의 메모리 스냅샷이다. 다른 브라우저 사용자에게 전송하거나 서버에 저장하지 않는다. 새로고침하면 초기화된다.\n`,
  "utf8",
);
console.log(
  `Generated ${scenarios.length} cases / ${domains.length} domains; ${backend ? "physical fields verified against" : "reused packaged schema evidence from"} ${revision.slice(0, 7)}.`,
);
