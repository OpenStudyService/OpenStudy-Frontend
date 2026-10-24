#!/usr/bin/env bash
set -euo pipefail

: "${AWS_REGION:?Set AWS_REGION}"
: "${S3_BUCKET:?Set S3_BUCKET}"
: "${CLOUDFRONT_DISTRIBUTION_ID:?Set CLOUDFRONT_DISTRIBUTION_ID}"

if [[ ! -s dist/index.html || ! -d dist/assets ]]; then
  echo 'Build the live frontend before deployment.' >&2
  exit 1
fi

# Keep old hashed assets so open browser tabs can finish loading their release.
aws s3 sync dist/assets/ "s3://$S3_BUCKET/assets/" \
  --exclude '*.map' --cache-control 'public,max-age=31536000,immutable' --only-show-errors
aws s3 sync dist/ "s3://$S3_BUCKET/" \
  --exclude 'assets/*' --exclude 'index.html' --exclude '*.map' \
  --exclude 'mockServiceWorker.js' --cache-control 'no-cache' --only-show-errors

# Publish the entry point only after every referenced asset is available.
aws s3 cp dist/index.html "s3://$S3_BUCKET/index.html" \
  --content-type 'text/html' --cache-control 'no-cache' --only-show-errors

invalidation_id=$(aws cloudfront create-invalidation \
  --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" --paths '/*' \
  --query 'Invalidation.Id' --output text)
aws cloudfront wait invalidation-completed \
  --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" --id "$invalidation_id"

frontend_domain=$(aws cloudfront get-distribution \
  --id "$CLOUDFRONT_DISTRIBUTION_ID" --query 'Distribution.DomainName' --output text)
if [[ ! "$frontend_domain" =~ ^[a-z0-9]+\.cloudfront\.net$ ]]; then
  echo 'CloudFront returned an invalid distribution domain.' >&2
  exit 1
fi

deploy_check_dir=$(mktemp -d)
trap 'rm -rf "$deploy_check_dir"' EXIT
for route in / /login; do
  curl --fail --silent --show-error --compressed --retry 3 --max-time 30 \
    "https://$frontend_domain$route" --output "$deploy_check_dir/index.html"
  cmp dist/index.html "$deploy_check_dir/index.html"
done

echo "Frontend deployed: https://$frontend_domain"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  printf 'Frontend: https://%s\nCommit: %s\n' \
    "$frontend_domain" "${GITHUB_SHA:-local}" >> "$GITHUB_STEP_SUMMARY"
fi
