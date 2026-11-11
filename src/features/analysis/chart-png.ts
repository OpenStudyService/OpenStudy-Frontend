export type ChartMetadata = {
  title: string;
  conditions: string[];
  unit: string;
  asOf: string;
};

const PADDING = 24;
const SCALE = 2;
const TEXT_HEIGHT = 22;
const SVG_STYLES = [
  "color",
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "letter-spacing",
  "text-anchor",
  "dominant-baseline",
  "visibility",
  "display",
];

export function snapshotSvg(svg: SVGSVGElement) {
  const { width, height } = svg.getBoundingClientRect();
  if (!width || !height)
    throw new Error("차트가 표시된 뒤 다시 시도해 주세요.");
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const targets = [clone, ...clone.querySelectorAll<SVGElement>("*")];
  [svg, ...svg.querySelectorAll<SVGElement>("*")].forEach((element, index) => {
    const computed = getComputedStyle(element);
    const style = targets[index].style;
    for (const name of SVG_STYLES) {
      const value = computed.getPropertyValue(name);
      if (value) style.setProperty(name, value);
    }
  });
  clone.setAttribute("width", String(width * SCALE));
  clone.setAttribute("height", String(height * SCALE));
  clone.style.width = `${width * SCALE}px`;
  clone.style.height = `${height * SCALE}px`;
  if (!clone.hasAttribute("viewBox"))
    clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
  return {
    width,
    height,
    source: new XMLSerializer().serializeToString(clone),
  };
}

export function wrapChartText(
  text: string,
  width: number,
  measure: (value: string) => number,
) {
  const lines: string[] = [];
  const segmenter = new Intl.Segmenter("ko", { granularity: "grapheme" });
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const { segment } of segmenter.segment(paragraph)) {
      if (line && measure(line + segment) > width) {
        lines.push(line.trimEnd());
        line = "";
      }
      if (line || segment.trim()) line += segment;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export async function chartPng(
  element: HTMLElement,
  meta: ChartMetadata,
  signal: AbortSignal,
) {
  const svg = element.querySelector<SVGSVGElement>("svg.recharts-surface");
  if (!svg) throw new Error("차트가 표시된 뒤 다시 시도해 주세요.");
  const chart = snapshotSvg(svg);
  const font = getComputedStyle(element).fontFamily || "sans-serif";
  const image = new Image();
  const url = URL.createObjectURL(
    new Blob([chart.source], { type: "image/svg+xml;charset=utf-8" }),
  );
  try {
    image.src = url;
    await image.decode();
    await document.fonts.ready;
    signal.throwIfAborted();

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error("이 브라우저에서 차트 이미지를 만들 수 없어요.");
    const titleFont = `bold 18px ${font}`;
    const detailsFont = `14px ${font}`;
    const wrap = (text: string) =>
      wrapChartText(
        text,
        chart.width,
        (line) => context.measureText(line).width,
      );
    context.font = titleFont;
    const titles = wrap(meta.title);
    context.font = detailsFont;
    const details = [
      ...meta.conditions.map((value, index) =>
        index === 0 ? `조회 조건 · ${value}` : value,
      ),
      `단위 · ${meta.unit}`,
      `기준 시각 · ${meta.asOf}`,
    ].flatMap(wrap);
    const chartTop =
      PADDING + TEXT_HEIGHT * (titles.length + details.length + 1);
    const width = Math.ceil(chart.width + 2 * PADDING);
    const height = Math.ceil(chartTop + chart.height + PADDING);
    canvas.width = width * SCALE;
    canvas.height = height * SCALE;
    context.scale(SCALE, SCALE);
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#111827";
    context.textBaseline = "top";
    context.font = titleFont;
    titles.forEach((line, i) =>
      context.fillText(line, PADDING, PADDING + i * TEXT_HEIGHT),
    );
    context.font = detailsFont;
    details.forEach((line, i) =>
      context.fillText(
        line,
        PADDING,
        PADDING + (titles.length + i) * TEXT_HEIGHT,
      ),
    );
    context.drawImage(image, PADDING, chartTop, chart.width, chart.height);

    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("PNG 이미지를 만들 수 없어요.")),
        "image/png",
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
