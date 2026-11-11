import { useRef, type ReactNode } from "react";
import { ExportButton } from "./ExportButton";
import { chartPng, type ChartMetadata } from "./chart-png";
import { exportFilename } from "./export-api";

export function ChartExport({
  metadata,
  children,
}: {
  metadata?: ChartMetadata;
  children: ReactNode;
}) {
  const chart = useRef<HTMLDivElement>(null);
  if (!metadata) return children;
  return (
    <div className="grid min-w-0 gap-2">
      <ExportButton
        title={metadata.title}
        label="PNG 저장"
        download={async (signal) => {
          if (!chart.current)
            throw new Error("차트가 표시된 뒤 다시 시도해 주세요.");
          const blob = await chartPng(chart.current, metadata, signal);
          return {
            blob,
            filename: exportFilename(
              metadata.title.replace(/[/\\:*?"<>|]/g, "_"),
              "png",
            ),
          };
        }}
      />
      <div className="min-w-0" ref={chart}>
        {children}
      </div>
    </div>
  );
}
