import { afterEach, expect, it, vi } from "vitest";
import { chartPng, snapshotSvg, wrapChartText } from "./chart-png";

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function displayedChart() {
  const container = document.createElement("div");
  container.style.fontFamily = "Malgun Gothic, sans-serif";
  container.innerHTML =
    '<svg class="recharts-surface" viewBox="0 0 200 100"><rect x="5" y="3" width="20" height="81" style="fill: rgb(40, 50, 60)"/><text x="10" y="91">강남점</text></svg>';
  document.body.append(container);
  const svg = container.querySelector("svg")!;
  vi.spyOn(svg, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 200, 100),
  );
  return { container, svg };
}

it("preserves displayed chart geometry, ordering, Korean labels and resolved styling at twice the display size", () => {
  const { svg } = displayedChart();
  const snapshot = snapshotSvg(svg);
  const root = new DOMParser().parseFromString(
    snapshot.source,
    "image/svg+xml",
  ).documentElement;
  expect(root.getAttribute("viewBox")).toBe("0 0 200 100");
  expect(root.getAttribute("width")).toBe("400");
  expect(root.getAttribute("height")).toBe("200");
  expect([...root.children].map(({ localName }) => localName)).toEqual([
    "rect",
    "text",
  ]);
  expect(root.querySelector("rect")?.getAttribute("height")).toBe("81");
  expect(root.querySelector("rect")?.getAttribute("style")).toContain(
    "rgb(40, 50, 60)",
  );
  expect(root.querySelector("text")?.textContent).toBe("강남점");
  expect(svg.getAttribute("width")).toBeNull();
});

it("wraps long Korean conditions at grapheme boundaries", () => {
  expect(
    wrapChartText("강남점성수점\n환불 처리일", 4, (line) => line.length),
  ).toEqual(["강남점성", "수점", "환불 처", "리일"]);
});

it("writes metadata above the unmodified chart and returns a 2x PNG", async () => {
  const { container } = displayedChart();
  const ctx = {
    scale: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    drawImage: vi.fn(),
    measureText: (line: string) => ({ width: line.length * 14 }),
  };
  const png = new Blob(["png"], { type: "image/png" });
  const contextSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
  contextSpy.mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  const encode = vi
    .spyOn(HTMLCanvasElement.prototype, "toBlob")
    .mockImplementation((cb) => cb(png));
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      decode = vi.fn().mockResolvedValue(undefined);
    },
  );
  const revoke = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn().mockReturnValue("blob:chart");
      static revokeObjectURL = revoke;
    },
  );
  const fonts = Object.getOwnPropertyDescriptor(document, "fonts");
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  try {
    await expect(
      chartPng(
        container,
        {
          title: "지점별 순매출",
          conditions: [
            "강남점 · 환불 처리일 기준 · 조회 기간이 긴 경우에도 차트 위에서 줄바꿈",
          ],
          unit: "원",
          asOf: "2026-11-11 10:30",
        },
        new AbortController().signal,
      ),
    ).resolves.toBe(png);
    const canvas = encode.mock.contexts[0] as HTMLCanvasElement;
    expect(canvas.width).toBe((200 + 2 * 24) * 2);
    expect(ctx.scale).toHaveBeenCalledWith(2, 2);
    const chartTop = ctx.drawImage.mock.calls[0][2];
    expect(canvas.height).toBe((chartTop + 100 + 24) * 2);
    expect(ctx.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      24,
      chartTop,
      200,
      100,
    );
    const labels = ctx.fillText.mock.calls.map(([text]) => text).join(" ");
    expect(labels).toContain("지점별 순매출");
    expect(labels).toContain("조회 조건");
    expect(labels).toContain("단위 · 원");
    expect(labels).toContain("기준 시각");
    expect(labels).toContain("10:30");
    expect(ctx.fillText.mock.calls.every(([, , y]) => y < chartTop)).toBe(true);
    expect(encode).toHaveBeenCalledWith(expect.any(Function), "image/png");
    expect(revoke).toHaveBeenCalledWith("blob:chart");
  } finally {
    if (fonts) Object.defineProperty(document, "fonts", fonts);
    else Reflect.deleteProperty(document, "fonts");
  }
});
