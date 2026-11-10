import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { useApp } from "../../app/context";
import { formatDateTime } from "../../shared/domain/format";
import { Button, ErrorState, State } from "../../shared/ui/primitives";
import { customerApi } from "./api";
import { customerDetailUrl } from "./CustomerMergeErrorLink";

export function CustomerMergeHistory({ customerId }: { customerId: string }) {
  const { session, scope } = useApp();
  const [open, setOpen] = useState(false);
  const history = useQuery({
    queryKey: [
      "data",
      session.user.id,
      scope,
      "customers",
      "merges",
      customerId,
    ],
    queryFn: ({ signal }) => customerApi.merges(scope, customerId, signal),
    enabled: open,
    retry: false,
  });
  return (
    <section className="mt-6" aria-label="고객 병합 이력">
      <Button aria-expanded={open} onClick={() => setOpen(!open)}>
        병합 이력 {open ? "접기" : "보기"}
      </Button>
      {open &&
        (history.isPending ? (
          <State loading />
        ) : history.error ? (
          <ErrorState
            error={history.error}
            retry={() => void history.refetch()}
          />
        ) : history.data.items.length ? (
          <ul className="mt-3 grid gap-2">
            {history.data.items.map((record) => (
              <li key={record.id} className="tip">
                <p>
                  {record.absorbed.name} ({record.absorbed.memberNo}) →{" "}
                  <Link
                    className="cell-link"
                    to={customerDetailUrl(scope, record.target.id)}
                  >
                    {record.target.name} ({record.target.memberNo})
                  </Link>
                </p>
                <p>
                  {formatDateTime(record.mergedAt)} · {record.mergedBy.name}
                </p>
                {record.via && <p>중간 병합 고객 {record.via.name}</p>}
                <p className="whitespace-pre-wrap break-words">
                  {record.reason}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="help">병합 이력이 없어요.</p>
        ))}
    </section>
  );
}
