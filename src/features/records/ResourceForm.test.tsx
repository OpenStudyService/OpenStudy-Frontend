import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResourceForm } from "./ResourceForm";
import { emptyLookups } from "../../app/context";
import { ApiError } from "../../shared/api/client";
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
