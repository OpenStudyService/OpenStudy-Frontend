import { AS_OF, permissions, resources } from "../shared/domain/schema";
import type { Database, ResourceMap, Resource } from "../shared/domain/schema";
import { expiresAfter, passValues } from "./terms";

export function seed(): Database {
  const db = Object.fromEntries(
    resources.map((r) => [r, []]),
  ) as unknown as Database;
  function add<K extends Resource>(
    r: K,
    id: string,
    branchId: string,
    data: Omit<
      ResourceMap[K],
      "id" | "branchId" | "version" | "createdAt" | "updatedAt"
    >,
    at = AS_OF,
  ) {
    const row = {
      id,
      branchId,
      version: 1,
      createdAt: at,
      updatedAt: at,
      ...data,
    } as ResourceMap[K];
    (db[r] as ResourceMap[K][]).push(row);
    return row;
  }
  add("branches", "gangnam", "gangnam", {
    name: "강남점",
    address: "서울 강남구 테헤란로 123",
    phone: "02-555-0101",
    hours: "00:00–24:00",
    status: "운영 중",
  });
  add("branches", "seongsu", "seongsu", {
    name: "성수점",
    address: "서울 성동구 성수이로 88",
    phone: "02-555-0202",
    hours: "00:00–24:00",
    status: "운영 중",
  });
  const people = [
    ["owner", "김서연", "all", "admin"],
    ["minji", "이민지", "gangnam", "admin"],
    ["junho", "박준호", "gangnam", "staff"],
    ["yujin", "최유진", "seongsu", "admin"],
    ["doyun", "정도윤", "seongsu", "staff"],
  ] as const;
  for (const [id, name, branch, role] of people)
    add("employees", id, branch, {
      name,
      nickname: name,
      email: `${id}@openstudy.test`,
      avatar: "",
      status: "활성",
      owner: id === "owner",
      memberships: (branch === "all" ? ["gangnam", "seongsu"] : [branch]).map(
        (branchId) => ({
          branchId,
          role,
          permissions: role === "admin" ? [...permissions] : [],
        }),
      ),
    });
  const names = ["김지우", "이서준", "박하린", "최도현", "정수빈", "한유나"];
  names.forEach((name, i) =>
    add(
      "members",
      `member-${i + 1}`,
      i === 2 || i === 4 ? "seongsu" : "gangnam",
      {
        name,
        email: `member${i + 1}@example.test`,
        phone: `010-0000-${2100 + i}`,
        status: "정상",
        note: "시연용 가상 회원",
        branchIds:
          i === 0
            ? ["gangnam", "seongsu"]
            : [i === 2 || i === 4 ? "seongsu" : "gangnam"],
      },
    ),
  );
  const categories = [
    ["cat-time", "TIME", "시간권", "시간권"],
    ["cat-period", "PERIOD", "기간권", "기간권"],
    ["cat-credit", "CREDIT", "정액권", "정액권"],
  ] as const;
  for (const [id, code, name, kind] of categories)
    add("productCategories", id, "all", { code, name, kind, status: "활성" });
  const sellingBranches = ["gangnam", "seongsu"];
  const catalog = [
    [
      "time100",
      "T100",
      "집중 시간권 100시간",
      120000,
      { kind: "시간권", includedMinutes: 6000, validDays: 90 },
      "cat-time",
    ],
    [
      "period28",
      "P28",
      "루틴 기간권 4주",
      180000,
      { kind: "기간권", periodDays: 28 },
      "cat-period",
    ],
    [
      "credit",
      "C100K",
      "자유 정액권 10만원",
      100000,
      {
        kind: "정액권",
        creditKrw: 100000,
        hourlyRateKrw: 1500,
        validDays: 180,
      },
      "cat-credit",
    ],
  ] as const;
  for (const [id, code, name, priceKrw, terms, categoryId] of catalog) {
    const category = db.productCategories.find((c) => c.id === categoryId)!;
    add("products", id, "all", {
      code,
      name,
      priceKrw,
      terms: structuredClone(terms) as ResourceMap["products"]["terms"],
      status: "판매 중",
      categoryId,
      branchIds: [...sellingBranches],
      history: [
        {
          id: `${id}-1`,
          version: 1,
          changedAt: AS_OF,
          actorId: "owner",
          changeType: "CREATED",
          before: null,
          after: {
            schemaVersion: 1,
            code,
            name,
            priceKrw,
            terms: structuredClone(terms) as ResourceMap["products"]["terms"],
            status: "판매 중",
            categoryCode: category.code,
            categoryName: category.name,
            branchIds: [...sellingBranches],
          },
        },
      ],
    });
  }
  for (let i = 0; i < 6; i++) {
    const p = db.products[i % 3],
      member = db.members[i],
      at = i < 3 ? "2026-09-20T02:00:00.000Z" : "2026-10-16T02:00:00.000Z",
      values = passValues(p.terms);
    const payment = add(
      "payments",
      `pay-${i + 1}`,
      member.branchId,
      {
        memberId: member.id,
        productId: p.id,
        reservationId: "",
        amount: p.priceKrw,
        method: "Mock 카드",
        status: "승인",
        refundAt: "",
        refundBranchId: "",
        reason: "",
        approvedAt: at,
      },
      at,
    );
    add(
      "passes",
      `pass-${i + 1}`,
      member.branchId,
      {
        memberId: member.id,
        productId: p.id,
        name: p.name,
        kind: p.terms.kind,
        remaining: values.remaining,
        hourlyRate: values.hourlyRate,
        expiresAt: expiresAfter(at, values.days),
        used: false,
        paymentId: payment.id,
        status: "활성",
      },
      at,
    );
  }
  // Include a cross-month refund to exercise both accounting bases.
  db.payments[2].status = "환불";
  db.payments[2].refundAt = "2026-10-03T03:00:00.000Z";
  db.payments[2].refundBranchId = "gangnam";
  db.payments[2].reason = "미사용 환불";
  db.passes[2].status = "환불";
  for (const b of ["gangnam", "seongsu"]) {
    for (let n = 1; n <= 32; n++)
      add("seats", `${b}-seat-${n}`, b, {
        name: `${n <= 16 ? "A" : "B"}-${String(n <= 16 ? n : n - 16).padStart(2, "0")}`,
        zone: n <= 16 ? "집중존" : "라운지",
        status: n === 16 ? "사용 불가" : "이용 가능",
        memberId: "",
      });
    for (let n = 1; n <= 8; n++)
      add("lockers", `${b}-locker-${n}`, b, {
        name: `L-${String(n).padStart(2, "0")}`,
        memberId: "",
        startsOn: "",
        endsOn: "",
        status: "이용 가능",
        history: [],
      });
    add("rooms", `${b}-room-a`, b, {
      name: "스터디룸 A",
      capacity: 6,
      hourlyRate: 8000,
      status: "이용 가능",
    });
    add("rooms", `${b}-room-b`, b, {
      name: "스터디룸 B",
      capacity: 4,
      hourlyRate: 6000,
      status: "이용 가능",
    });
  }
  add("usage", "usage-seed", "gangnam", {
    memberId: "member-1",
    passId: "pass-1",
    seatId: "gangnam-seat-12",
    startedAt: "2026-10-17T00:00:00.000Z",
    endedAt: "",
    minutes: 0,
    charged: 0,
    excess: 0,
    status: "이용 중",
  });
  db.seats.find((s) => s.id === "gangnam-seat-12")!.status = "이용 중";
  db.seats.find((s) => s.id === "gangnam-seat-12")!.memberId = "member-1";
  db.passes[0].used = true;
  const taskData = [
    [
      "스터디룸 A 냉방 상태 확인",
      "gangnam",
      "minji",
      "진행 중",
      "높음",
      "시설 점검",
    ],
    [
      "오후 근무 인수인계 전달",
      "gangnam",
      "junho",
      "할 일",
      "보통",
      "인수인계",
    ],
    ["집중존 저녁 청소", "seongsu", "doyun", "할 일", "보통", "청소"],
    ["라운지 소모품 보충", "gangnam", "junho", "완료", "낮음", "소모품"],
  ] as const;
  taskData.forEach(([title, b, assigneeId, status, priority, category], i) =>
    add("tasks", `task-${i + 1}`, b, {
      createdById: "owner",
      title,
      assigneeId,
      status,
      priority,
      category,
      due: "2026-10-17",
      body: "쾌적한 공간을 위해 상태를 확인하고 운영 채널에 결과를 남겨 주세요.",
      checks: [
        { text: "현장 상태 확인", done: i === 3 },
        { text: "운영 채널에 결과 공유", done: i === 3 },
      ],
      history: [{ at: AS_OF, actorId: "owner", text: "업무 등록" }],
    }),
  );
  const channels = [
    ["general", "전체-공지", "all"],
    ["gangnam", "강남점-운영", "gangnam"],
    ["seongsu", "성수점-운영", "seongsu"],
    ["facilities", "시설-점검", "all"],
  ] as const;
  for (const [id, name, b] of channels)
    add("channels", id, b, {
      name,
      description: "하루의 업무와 인수인계를 함께 나누는 공간",
      kind: "channel",
      participantIds: db.employees
        .filter(
          (p) =>
            b === "all" ||
            p.owner ||
            p.memberships.some((m) => m.branchId === b),
        )
        .map((p) => p.id),
      reads: { owner: 0, minji: 0, junho: 0, yujin: 0, doyun: 0 },
      status: "활성",
    });
  add("channels", "dm-minji", "all", {
    name: "이민지",
    description: "김서연 · 이민지",
    kind: "dm",
    participantIds: ["owner", "minji"],
    reads: {},
    status: "활성",
  });
  const messages = [
    [
      "msg-1",
      "gangnam",
      "owner",
      "좋은 아침이에요! 오늘도 편안하게 집중할 수 있는 공간을 함께 만들어 봐요. 🌿",
      "",
      "",
    ],
    [
      "msg-2",
      "gangnam",
      "minji",
      "오픈 점검 완료했습니다. 집중존 조명과 콘센트 모두 정상이에요.",
      "",
      "",
    ],
    [
      "msg-3",
      "gangnam",
      "owner",
      "스터디룸 냉방 점검 부탁드려요. 처리 후 이곳에 결과를 남겨 주세요.",
      "",
      "task-1",
    ],
    [
      "msg-4",
      "gangnam",
      "junho",
      "오후 출근 후 인수인계 확인하겠습니다. 종이컵은 창고 두 번째 선반에 보충했어요.",
      "",
      "",
    ],
    [
      "msg-5",
      "general",
      "owner",
      "이번 주 토요일은 정기 소독일입니다. 지점별 운영 공지를 확인해 주세요.",
      "",
      "",
    ],
    [
      "msg-6",
      "seongsu",
      "yujin",
      "성수점 정상 오픈했습니다. 오후 소모품 재고를 확인할 예정입니다.",
      "",
      "",
    ],
    ["msg-7", "gangnam", "owner", "꼼꼼한 점검 감사합니다!", "msg-2", ""],
  ] as const;
  messages.forEach(([id, channelId, authorId, text, parentId, taskId], i) =>
    add(
      "messages",
      id,
      db.channels.find((c) => c.id === channelId)!.branchId,
      {
        channelId,
        authorId,
        text,
        parentId,
        taskId,
        clientMessageId: id,
        sequence: i + 1,
      },
      `2026-10-17T00:${String(i * 5).padStart(2, "0")}:00.000Z`,
    ),
  );
  add("facilities", "facility-1", "gangnam", {
    title: "스터디룸 A 냉방 점검",
    category: "시설 이상",
    assigneeId: "minji",
    body: "설정 온도 대비 실내 온도가 높다는 문의가 접수되었습니다.",
    cycleDays: 14,
    lastChecked: "2026-10-01",
    nextCheck: "2026-10-15",
    condition: "점검 필요",
    status: "진행 중",
    result: "",
  });
  add("facilities", "facility-2", "seongsu", {
    title: "정수기 필터 정기 교체",
    category: "정기 점검",
    assigneeId: "yujin",
    body: "필터 교체 후 스티커 날짜를 기록해 주세요.",
    cycleDays: 30,
    lastChecked: "2026-09-18",
    nextCheck: "2026-10-18",
    condition: "정상",
    status: "할 일",
    result: "",
  });
  add("inquiries", "inquiry-1", "gangnam", {
    title: "스터디룸 온도가 조금 높아요",
    memberId: "member-1",
    assigneeId: "minji",
    body: "오후 스터디룸 이용 예정인데 냉방 상태 확인 부탁드립니다.",
    reply: "현재 냉방 상태를 점검하고 있습니다.",
    status: "처리 중",
  });
  add("notices", "notice-1", "all", {
    title: "10월 정기 소독 및 시설 점검 안내",
    body: "10월 24일 오전 7시부터 9시까지 전 지점 정기 소독을 진행합니다.\n각 지점 매니저는 전날 안내문을 게시하고 오픈 전 환기와 시설 상태를 확인해 주세요.",
    pinned: true,
    authorId: "owner",
    status: "게시 중",
  });
  add("notices", "notice-2", "all", {
    title: "교대 인수인계, 이렇게 남겨 주세요",
    body: "미완료 업무, 고객 요청, 시설 특이 사항을 운영 채널에 남겨 주세요. 관련 업무 카드를 함께 공유하면 더 빠르게 확인할 수 있어요.",
    pinned: true,
    authorId: "owner",
    status: "게시 중",
  });
  for (const p of db.employees.filter((p) => !p.owner)) {
    add("shifts", `shift-${p.id}`, p.branchId, {
      employeeId: p.id,
      startsAt: "2026-10-17T00:00:00.000Z",
      endsAt: "2026-10-17T09:00:00.000Z",
      breakMinutes: 60,
      status: "예정",
    });
    add("leaveGrants", `grant-${p.id}`, p.branchId, {
      employeeId: p.id,
      amount: 15,
      startsOn: "2026-01-01",
      endsOn: "2026-12-31",
      reason: "2026년 관리자 부여",
    });
  }
  add("attendance", "att-minji", "gangnam", {
    employeeId: "minji",
    startedAt: "2026-10-17T00:00:00.000Z",
    endedAt: "",
    breaks: [],
    workedMinutes: 0,
    status: "근무 중",
  });
  return db;
}
