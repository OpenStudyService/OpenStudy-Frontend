import { expect, it } from "vitest";
import { asPage } from "./read-model";
it("reads canonical metadata and preserves empty out-of-range pages", () => {
  expect(
    asPage({ items: [], meta: { page: 4, pageSize: 20, total: 22 } }),
  ).toMatchObject({ items: [], page: 4, pageSize: 20, total: 22 });
});
it("keeps unconverted demo pagination compatible", () => {
  expect(
    asPage({ items: [{ id: "1" }], page: 2, pageSize: 10, total: 11 }),
  ).toMatchObject({ page: 2, pageSize: 10, total: 11 });
});
