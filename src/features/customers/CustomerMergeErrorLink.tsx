import { Link } from "react-router";
import { useApp } from "../../app/context";
import { ApiError } from "../../shared/api/client";

export const customerDetailUrl = (scope: string, id: string) =>
  `/app/${encodeURIComponent(scope)}/members?detail=${encodeURIComponent(id)}`;

export function CustomerMergeErrorLink({ error }: { error: unknown }) {
  const { scope } = useApp();
  if (
    !(error instanceof ApiError) ||
    !["CUSTOMER_NOT_ACTIVE", "CUSTOMER_ALREADY_MERGED"].includes(
      error.detail.code,
    ) ||
    !error.detail.mergedIntoCustomerId
  )
    return null;
  return (
    <p className="help">
      이 고객은 병합됐어요.{" "}
      <Link
        className="cell-link"
        to={customerDetailUrl(scope, error.detail.mergedIntoCustomerId)}
      >
        병합 대상 고객으로 이동
      </Link>
    </p>
  );
}
