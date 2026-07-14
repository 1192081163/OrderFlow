#!/usr/bin/env bash

set -euo pipefail

: "${GITEE_TOKEN:?GITEE_TOKEN is required}"
: "${GITEE_TAG:?GITEE_TAG is required}"
: "${GITEE_TARGET:?GITEE_TARGET is required}"
: "${GITEE_ASSET:?GITEE_ASSET is required}"

GITEE_OWNER="${GITEE_OWNER:-wei-dongyu_1_0}"
GITEE_REPO="${GITEE_REPO:-OrderFlow}"
GITEE_RELEASE_NAME="${GITEE_RELEASE_NAME:-订单整理助手 ${GITEE_TAG}}"
GITEE_RELEASE_BODY="${GITEE_RELEASE_BODY:-Windows 便携版已自动生成。下载 orderflow-desktop-windows.exe 后双击运行。}"
GITEE_API_BASE="${GITEE_API_BASE:-https://gitee.com/api/v5}"

if [[ ! "$GITEE_TAG" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "Unsupported Gitee release tag: $GITEE_TAG" >&2
  exit 2
fi

if [[ ! -f "$GITEE_ASSET" ]]; then
  echo "Gitee release asset does not exist: $GITEE_ASSET" >&2
  exit 2
fi

asset_size=$(wc -c <"$GITEE_ASSET" | tr -d '[:space:]')
if (( asset_size >= 104857600 )); then
  echo "Gitee release asset is ${asset_size} bytes; it must be smaller than 100 MB." >&2
  exit 2
fi

repo_api="${GITEE_API_BASE}/repos/${GITEE_OWNER}/${GITEE_REPO}"
auth_header="Authorization: token ${GITEE_TOKEN}"

existing_release=$(curl -sS --retry 3 --max-time 60 \
  -H "$auth_header" \
  "${repo_api}/releases/tags/${GITEE_TAG}")
existing_release_id=$(jq -r 'if (.id | type) == "number" then .id else empty end' <<<"$existing_release")

if [[ -n "$existing_release_id" ]]; then
  curl -fsS --retry 3 --max-time 60 \
    -X DELETE \
    -H "$auth_header" \
    "${repo_api}/releases/${existing_release_id}" >/dev/null
fi

release_payload=$(jq -n \
  --arg tag_name "$GITEE_TAG" \
  --arg target_commitish "$GITEE_TARGET" \
  --arg name "$GITEE_RELEASE_NAME" \
  --arg body "$GITEE_RELEASE_BODY" \
  '{tag_name: $tag_name, target_commitish: $target_commitish, name: $name, body: $body, prerelease: false}')

release=$(curl -fsS --retry 3 --max-time 60 \
  -X POST \
  -H "$auth_header" \
  -H 'Content-Type: application/json;charset=UTF-8' \
  --data-binary @- \
  "${repo_api}/releases" <<<"$release_payload")
release_id=$(jq -er '.id' <<<"$release")

uploaded=$(curl -fsS --retry 3 --max-time 900 \
  -X POST \
  -H "$auth_header" \
  -F "file=@${GITEE_ASSET}" \
  "${repo_api}/releases/${release_id}/attach_files")

jq -e --arg expected "$(basename "$GITEE_ASSET")" \
  'select(.name == $expected and (.browser_download_url | type) == "string") | {id, name, size, browser_download_url}' \
  <<<"$uploaded"
