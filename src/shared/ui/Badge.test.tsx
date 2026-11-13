import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Badge } from "./primitives";

afterEach(cleanup);

it.each([
  ["승인 대기", "warn"],
  ["비활성", "warn"],
  ["사용 가능", "good"],
  ["사용 중", "warn"],
  ["운영 중단", "bad"],
  ["기한 지남", "bad"],
  ["기한 초과", "bad"],
  ["긴급", "bad"],
  ["높음", "warn"],
  ["환불", "warn"],
  ["활성", "good"],
  ["발송 실패", "bad"],
  ["할 일", "neutral"],
])("renders %s with the %s tone", (label, tone) => {
  render(<Badge>{label}</Badge>);
  expect(screen.getByText(label)).toHaveAttribute("class", `badge ${tone}`);
});

it("honors an explicit tone for a known status", () => {
  render(<Badge tone="neutral">환불</Badge>);
  expect(screen.getByText("환불")).toHaveAttribute("class", "badge neutral");
});
