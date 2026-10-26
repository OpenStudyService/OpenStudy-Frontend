import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResourceForm } from "./ResourceForm";
import { emptyLookups } from "../../app/context";
import { ApiError } from "../../shared/api/client";
import type { LookupData } from "../../shared/domain/schema";
afterEach(cleanup);
it("rejects invalid input and preserves a failed write for correction and retry", async () => {
  const submit = vi
    .fn()
    .mockRejectedValueOnce(
      new ApiError(409, {
        code: "VERSION_CONFLICT",
        message: "최신 내용을 확인해 주세요.",
      }),
    )
    .mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(
    <ResourceForm
      fields={[
        { key: "email", label: "이메일", required: true },
        { key: "reason", label: "사유", required: true },
      ]}
      scope="gangnam"
      lookups={emptyLookups}
      onSubmit={submit}
    />,
  );
  await user.click(screen.getByRole("button", { name: "저장하기" }));
  expect(submit).not.toHaveBeenCalled();
  expect(screen.getAllByRole("alert")).toHaveLength(2);
  await user.type(screen.getByLabelText("이메일"), "colleague@openstudy.test");
  await user.type(screen.getByLabelText("사유"), "정정 요청");
  await user.click(screen.getByRole("button", { name: "저장하기" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "최신 내용을 확인",
  );
  expect(screen.getByLabelText("사유")).toHaveValue("정정 요청");
  await user.click(screen.getByRole("button", { name: "저장하기" }));
  expect(submit).toHaveBeenCalledTimes(2);
  expect(submit.mock.calls[1][0]).toEqual(submit.mock.calls[0][0]);
});

it("keeps entered values on 422 and displays field errors with request ID", async () => {
  const submit = vi.fn().mockRejectedValue(
    new ApiError(422, {
      code: "VALIDATION_FAILED",
      message: "입력을 확인해 주세요.",
      requestId: "req-validation",
      fieldErrors: { name: "이미 사용한 이름입니다." },
    }),
  );
  const user = userEvent.setup();
  render(
    <ResourceForm
      fields={[{ key: "name", label: "이름", required: true }]}
      scope="1"
      lookups={emptyLookups}
      onSubmit={submit}
    />,
  );
  await user.type(screen.getByLabelText("이름"), "새 지점");
  await user.click(screen.getByRole("button", { name: "저장하기" }));
  expect(await screen.findByText("이미 사용한 이름입니다.")).toBeVisible();
  expect(screen.getByText(/req-validation/)).toBeVisible();
  expect(screen.getByLabelText("이름")).toHaveValue("새 지점");
});

it("renders already scoped minimum employee choices without requiring private account fields", async () => {
  const employees = [{ id: "20", name: "지점 직원" }];
  const submit = vi.fn().mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(
    <ResourceForm
      fields={[
        {
          key: "employeeId",
          label: "직원",
          type: "select",
          ref: "employees",
          required: true,
        },
      ]}
      scope="1"
      lookups={{ ...emptyLookups, employees }}
      onSubmit={submit}
    />,
  );
  expect(screen.getByRole("option", { name: "지점 직원" })).toHaveValue("20");
  await user.selectOptions(screen.getByLabelText("직원"), "20");
  await user.click(screen.getByRole("button", { name: "저장하기" }));
  expect(submit).toHaveBeenCalledWith({ employeeId: "20" });
  expect(employees).toEqual([{ id: "20", name: "지점 직원" }]);
});

it("blocks a retained employee after choosing a different branch without membership evidence", async () => {
  const stamp = "2026-10-26T00:00:00Z";
  const lookups: LookupData = {
    ...emptyLookups,
    employees: [{ id: "20", name: "허용 범위 직원" }],
    branches: [
      {
        id: "2",
        branchId: "2",
        version: 1,
        createdAt: stamp,
        updatedAt: stamp,
        name: "두 번째 지점",
        address: "서울",
        phone: "02",
        hours: "24시간",
        status: "운영 중",
      },
    ],
  };
  const submit = vi.fn().mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(
    <ResourceForm
      fields={[
        {
          key: "branchId",
          label: "지점",
          type: "select",
          ref: "branches",
          options: ["all"],
          required: true,
        },
        {
          key: "employeeId",
          label: "직원",
          type: "select",
          ref: "employees",
          required: true,
        },
      ]}
      defaults={{ branchId: "all" }}
      scope="all"
      lookups={lookups}
      onSubmit={submit}
    />,
  );
  await user.selectOptions(screen.getByLabelText("직원"), "20");
  await user.selectOptions(screen.getByLabelText("지점"), "2");
  expect(screen.getByLabelText("직원")).toBeDisabled();
  expect(
    within(screen.getByLabelText("직원")).queryByRole("option", {
      name: "허용 범위 직원",
    }),
  ).toBeNull();
  expect(
    screen.getByText(
      "이 지점의 직원을 선택하려면 해당 지점으로 이동해 주세요.",
    ),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "저장하기" }));
  expect(submit).not.toHaveBeenCalled();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "해당 지점으로 이동",
  );
  await user.selectOptions(screen.getByLabelText("지점"), "all");
  expect(screen.getByLabelText("직원")).toBeEnabled();
  expect(screen.getByLabelText("직원")).toHaveValue("20");
  await user.click(screen.getByRole("button", { name: "저장하기" }));
  expect(submit).toHaveBeenCalledWith({ branchId: "all", employeeId: "20" });
});

it("retains legacy owner and branch membership filtering when the demo provides metadata", () => {
  render(
    <ResourceForm
      fields={[
        { key: "employeeId", label: "직원", type: "select", ref: "employees" },
      ]}
      scope="1"
      lookups={{
        ...emptyLookups,
        employees: [
          { id: "owner", name: "소유자", owner: true, memberships: [] },
          {
            id: "one",
            name: "첫 지점 직원",
            memberships: [{ branchId: "1", role: "staff", permissions: [] }],
          },
          {
            id: "two",
            name: "다른 지점 직원",
            memberships: [{ branchId: "2", role: "staff", permissions: [] }],
          },
        ],
      }}
      onSubmit={vi.fn()}
    />,
  );
  expect(screen.getByRole("option", { name: "소유자" })).toBeVisible();
  expect(screen.getByRole("option", { name: "첫 지점 직원" })).toBeVisible();
  expect(screen.queryByRole("option", { name: "다른 지점 직원" })).toBeNull();
});
