import { z } from "zod";
import { api } from "../../shared/api/client";
export const executionSchema = z.object({
  id: z.string(),
  status: z.literal("READY"),
  asOf: z.string(),
  start: z.string(),
  end: z.string(),
  currency: z.literal("KRW"),
  timeZone: z.literal("Asia/Seoul"),
  refundBasis: z.enum(["processed", "original"]),
  viewSpec: z.object({ component: z.string(), title: z.string() }),
  rows: z.array(
    z.object({
      branchId: z.string(),
      branch: z.string(),
      approved: z.number(),
      refunds: z.number(),
      net: z.number(),
    }),
  ),
});
export type Execution = z.infer<typeof executionSchema>;
// Engine wire DTO -> OpenStudy display contract. Keep engine-specific changes here.
export async function getExecution(id: string) {
  const result = await api<unknown>(`/executions/${id}`);
  const parsed = executionSchema.safeParse(result);
  if (!parsed.success)
    throw new Error("AI 결과의 형식이 지원되는 화면 계약과 일치하지 않습니다.");
  return parsed.data;
}
