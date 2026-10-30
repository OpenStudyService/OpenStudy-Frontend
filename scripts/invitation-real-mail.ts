import { pathToFileURL } from "node:url";
import { chromium, type BrowserContext, type Response } from "@playwright/test";

type Values = Record<string, string | undefined>;
type Json = Record<string, unknown>;
export type Settings = {
  baseURL: string;
  recipient: string;
  timeoutMs: number;
};

export const help = `실제 수신함 초대 smoke (신규 계정, 운영자 보조)
필수: INVITATION_REAL_MAIL_BASE_URL, INVITATION_REAL_MAIL_RECIPIENT
선택: INVITATION_REAL_MAIL_TIMEOUT_MINUTES (기본 15, 1~60)
프론트는 같은 origin의 /api로 실제 Backend에 연결되어 있어야 합니다.
관리자/직원 두 Chrome 창에서 로그인·초대·실제 받은 링크 열기·승인·재로그인을 직접 합니다.
한 실행에서 지정 수신함으로 신규 초대 1회만 허용하며 자동 발송/재시도하지 않습니다.
메일 링크·비밀번호는 브라우저에만 입력하세요. SMTP 설정은 Backend 담당입니다.
실행 기록·스크린샷·trace·브라우저 프로필을 저장하지 않습니다.
실패/중단 후 재실행 전에 서버의 초대·계정 상태를 확인하세요.`;

class SmokeFailure extends Error {}
function fail(code: string): never {
  // Never include Playwright errors, response bodies, URLs or environment values.
  throw new SmokeFailure(code);
}
function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
}
export function readSettings(env: Values): Settings {
  let url: URL;
  try {
    url = new URL(env.INVITATION_REAL_MAIL_BASE_URL || "");
  } catch {
    return fail("BASE_URL_REQUIRED");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    !(url.protocol === "https:" || (local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    fail("BASE_URL_MUST_BE_A_TRUSTED_ROOT_ORIGIN");
  const recipient = env.INVITATION_REAL_MAIL_RECIPIENT?.trim();
  if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient))
    fail("TEST_RECIPIENT_REQUIRED");
  const minutes = Number(env.INVITATION_REAL_MAIL_TIMEOUT_MINUTES || "15");
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60)
    fail("TIMEOUT_MUST_BE_1_TO_60_MINUTES");
  return { baseURL: url.origin, recipient, timeoutMs: minutes * 60_000 };
}

/** One creation attempt only: an ambiguous network failure must never resend mail. */
export class SendGuard {
  attempted = false;
  constructor(private recipient: string) {}
  allow(body: unknown) {
    if (this.attempted || object(body).email !== this.recipient) return false;
    this.attempted = true;
    return true;
  }
}

/** Keeps only the metadata needed to verify order, never passwords or mail tokens. */
export class Progress {
  invitationId = "";
  branchId = "";
  previewed = false;
  accepted = false;
  pending = false;
  approved = false;
  approvalSeen = false;
  loggedOut = false;
  workspace = false;
  constructor(private recipient: string) {}
  observe(
    actor: "manager" | "employee",
    path: string,
    method: string,
    value: unknown,
  ) {
    const data = object(value);
    if (
      actor === "manager" &&
      path === "/api/invitations" &&
      method === "POST"
    ) {
      if (
        data.email !== this.recipient ||
        typeof data.id !== "string" ||
        typeof data.branchId !== "string" ||
        data.status !== "초대 대기"
      )
        fail("INVITATION_RESPONSE_MISMATCH");
      this.invitationId = data.id;
      this.branchId = data.branchId;
    }
    if (actor === "employee" && path === "/api/invitations/preview") {
      if (
        !this.invitationId ||
        data.email !== this.recipient ||
        object(data.branch).id !== this.branchId
      )
        fail("MAIL_LINK_MISMATCH");
      if (data.acceptanceMode !== "NEW_ACCOUNT") fail("NEW_ACCOUNT_REQUIRED");
      this.previewed = true;
    }
    if (actor === "employee" && path === "/api/invitations/accept") {
      if (
        !this.previewed ||
        data.invitationId !== this.invitationId ||
        data.nextAction !== "LOGIN_FOR_APPROVAL_STATUS"
      )
        fail("ACCEPTANCE_RESPONSE_MISMATCH");
      this.accepted = true;
    }
    if (actor === "employee" && path === "/api/auth/login" && this.accepted) {
      const user = object(data.user);
      if (user.email !== this.recipient) fail("EMPLOYEE_ACCOUNT_MISMATCH");
      if (data.sessionMode === "APPROVAL_ONLY" && user.status === "승인 대기")
        this.pending = true;
      if (
        data.sessionMode === "WORKSPACE" &&
        this.approvalSeen &&
        this.loggedOut &&
        user.status === "활성" &&
        Array.isArray(user.memberships) &&
        user.memberships.some((m) => object(m).branchId === this.branchId)
      )
        this.workspace = true;
    }
    if (
      actor === "manager" &&
      this.invitationId &&
      path === `/api/invitations/${this.invitationId}/approve` &&
      method === "POST"
    ) {
      if (
        !this.pending ||
        data.id !== this.invitationId ||
        data.status !== "활성"
      )
        fail("APPROVAL_MUST_FOLLOW_RESTRICTED_LOGIN");
      this.approved = true;
    }
    if (
      actor === "employee" &&
      path === "/api/invitations/approval-status" &&
      this.approved &&
      data.requiresLogin === true &&
      Array.isArray(data.invitations) &&
      data.invitations.some(
        (i) =>
          object(i).invitationId === this.invitationId &&
          object(i).status === "활성",
      )
    )
      this.approvalSeen = true;
    if (
      actor === "employee" &&
      path === "/api/auth/logout" &&
      method === "POST" &&
      this.approvalSeen
    )
      this.loggedOut = true;
  }
}

export async function runSmoke(settings: Settings) {
  const browser = await chromium.launch({ channel: "chrome", headless: false });
  try {
    const manager = await browser.newContext({ serviceWorkers: "block" });
    const employee = await browser.newContext({ serviceWorkers: "block" });
    const progress = new Progress(settings.recipient);
    const guard = new SendGuard(settings.recipient);
    let failure = "";
    const deadline = Date.now() + settings.timeoutMs;
    const watch = (context: BrowserContext, actor: "manager" | "employee") => {
      context.on("response", (response: Response) => {
        const url = new URL(response.url());
        if (
          url.origin !== settings.baseURL ||
          !response.ok() ||
          ![
            "/api/invitations",
            "/api/invitations/preview",
            "/api/invitations/accept",
            "/api/auth/login",
            "/api/auth/logout",
            "/api/invitations/approval-status",
            `/api/invitations/${progress.invitationId}/approve`,
          ].includes(url.pathname)
        )
          return;
        void (async () => {
          const data: unknown =
            response.status() === 204 ? {} : await response.json();
          progress.observe(
            actor,
            url.pathname,
            response.request().method(),
            data,
          );
        })().catch(() => {
          failure = "UNEXPECTED_RESPONSE_OR_STEP_ORDER";
        });
      });
    };
    // Install observers and creation limits before navigation or user actions.
    watch(manager, "manager");
    watch(employee, "employee");
    for (const context of [manager, employee]) {
      await context.route("**/*", async (route) => {
        try {
          const request = route.request();
          const url = new URL(request.url());
          if (
            request.isNavigationRequest() &&
            url.origin !== settings.baseURL
          ) {
            failure = "NAVIGATION_OUTSIDE_CONFIGURED_ORIGIN_BLOCKED";
            return await route.abort();
          }
          if (
            request.method() !== "POST" ||
            !url.pathname.startsWith("/api/invitations")
          )
            return await route.continue();
          if (url.pathname !== "/api/invitations") {
            if (
              context === employee &&
              ["/api/invitations/preview", "/api/invitations/accept"].includes(
                url.pathname,
              )
            )
              return await route.continue();
            if (
              context === manager &&
              progress.pending &&
              url.pathname ===
                `/api/invitations/${progress.invitationId}/approve`
            )
              return await route.continue();
            failure = "UNEXPECTED_INVITATION_COMMAND_BLOCKED";
            return await route.abort();
          }
          let data: unknown;
          try {
            data = request.postDataJSON();
          } catch {
            data = {};
          }
          if (
            url.origin !== settings.baseURL ||
            context !== manager ||
            !guard.allow(data)
          ) {
            failure = "INVITATION_SEND_BLOCKED_CHECK_RECIPIENT_OR_DUPLICATE";
            return await route.abort();
          }
          await route.continue();
        } catch {
          failure = "BROWSER_REQUEST_INTERRUPTED";
        }
      });
    }
    const wait = async (condition: () => boolean) => {
      while (!condition()) {
        if (failure) fail(failure);
        if (
          !browser.isConnected() ||
          !manager.pages().length ||
          !employee.pages().length ||
          Date.now() >= deadline
        )
          fail("CANCELLED_OR_TIMED_OUT");
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (failure) fail(failure);
    };
    const admin = await manager.newPage();
    const person = await employee.newPage();
    admin.setDefaultTimeout(10_000);
    person.setDefaultTimeout(10_000);
    await admin.goto(`${settings.baseURL}/login`);
    await person.goto(`${settings.baseURL}/invitations/accept`);
    console.log(
      "1/6 첫 번째 창: 관리자로 로그인한 뒤 직원 관리 → 초대·승인에서 지정 테스트 수신함으로 새 계정을 한 번 초대하세요.",
    );
    await admin.bringToFront();
    await wait(() => !!progress.invitationId);
    console.log(
      "2/6 실제 수신함에서 메일 도착을 확인하세요. 링크를 복사해 두 번째(직원) Chrome 창 주소창에서 여세요. 이 터미널에는 링크를 붙이지 마세요.",
    );
    await person.bringToFront();
    await wait(() => progress.previewed);
    await wait(() => {
      const url = new URL(person.url());
      return !url.hash && !url.searchParams.has("token");
    });
    console.log(
      "3/6 직원 창: 비밀번호를 설정하고 초대를 수락한 뒤 로그인하여 승인 대기 화면으로 이동하세요.",
    );
    await wait(() => progress.pending);
    const denied = await employee.request.get(
      `${settings.baseURL}/api/lookups`,
    );
    if (denied.status() !== 403)
      fail("RESTRICTED_SESSION_DID_NOT_DENY_WORKSPACE");
    console.log("4/6 관리자 창: 방금 수락한 초대를 최종 승인하세요.");
    await admin.bringToFront();
    await wait(() => progress.approved);
    console.log(
      "5/6 직원 창: 승인 완료 안내를 기다리거나 승인 상태 새로고침을 누르세요. 아직 다시 로그인하지 마세요.",
    );
    await person.bringToFront();
    await wait(() => progress.approvalSeen);
    const stillDenied = await employee.request.get(
      `${settings.baseURL}/api/lookups`,
    );
    if (stillDenied.status() !== 403)
      fail("APPROVAL_SILENTLY_PROMOTED_RESTRICTED_SESSION");
    console.log(
      "제한 세션 유지를 확인했습니다. 직원 창의 다시 로그인 버튼으로 로그아웃한 뒤 재로그인하세요.",
    );
    await wait(() => progress.workspace);
    await wait(() => {
      const url = new URL(person.url());
      return (
        url.origin === settings.baseURL &&
        url.pathname.startsWith(
          `/app/${encodeURIComponent(progress.branchId)}/`,
        )
      );
    });
    const allowed = await employee.request.get(
      `${settings.baseURL}/api/lookups`,
    );
    if (allowed.status() !== 200)
      fail("WORKSPACE_REQUEST_FAILED_AFTER_RELOGIN");
    console.log(
      "6/6 통과: 수신 링크 미리보기·신규 수락·제한 세션·관리자 승인·재로그인 후 지점 진입을 확인했습니다. SMTP 제공자의 전달/스팸 판정과 전체 운영 인수는 별도 기록하세요.",
    );
  } finally {
    await browser.close();
  }
}

export async function main(
  args = process.argv.slice(2),
  env: Values = process.env,
) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    console.log(help);
    return;
  }
  if (args.length) fail("ONLY_HELP_OPTION_IS_SUPPORTED");
  await runSmoke(readSettings(env));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main().catch((error: unknown) => {
    if (error instanceof SmokeFailure)
      console.error(`검증 중단 코드: ${error.message}`);
    console.error(
      "실메일 smoke를 완료하지 못했습니다. 설정·서버 상태·단계 순서를 확인하세요. 비밀값 보호를 위해 상세 오류는 출력하지 않습니다. 자동 재발송하지 말고 기존 초대 상태를 먼저 확인하세요.",
    );
    process.exitCode = 1;
  });
}
