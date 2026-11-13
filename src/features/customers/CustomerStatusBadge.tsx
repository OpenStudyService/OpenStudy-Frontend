import { Badge } from "../../shared/ui/primitives";
import type { Customer } from "./model";

export function CustomerStatusBadge({ status }: { status: Customer["status"] }) {
  return <Badge tone={status === "비활성" ? "warn" : undefined}>{status}</Badge>;
}
