#!/usr/bin/env bash

set -euo pipefail

: "${DOWNLOAD_SSH_HOST:?DOWNLOAD_SSH_HOST is required}"
: "${DOWNLOAD_SSH_USER:?DOWNLOAD_SSH_USER is required}"
: "${DOWNLOAD_TAG:?DOWNLOAD_TAG is required}"

download_base_url="${DOWNLOAD_BASE_URL:-https://download.ausmet.ai}"
remote_root="${DOWNLOAD_REMOTE_ROOT:-/srv/orderflow-download/public}"
windows_asset="${1:-}"
mac_asset="${2:-}"

if [[ ! "${DOWNLOAD_TAG}" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "Unsupported download release tag: ${DOWNLOAD_TAG}" >&2
  exit 2
fi
if [[ "${download_base_url}" != "https://download.ausmet.ai" ]]; then
  echo "Unsupported download base URL: ${download_base_url}" >&2
  exit 2
fi
if [[ "${remote_root}" != "/srv/orderflow-download/public" ]]; then
  echo "Unsupported remote download root: ${remote_root}" >&2
  exit 2
fi
if [[ ! -f "${windows_asset}" || "$(basename "${windows_asset}")" != "orderflow-desktop-windows.exe" ]]; then
  echo "Expected the Windows release asset orderflow-desktop-windows.exe." >&2
  exit 2
fi
if [[ ! -f "${mac_asset}" || "$(basename "${mac_asset}")" != "orderflow-desktop-mac.dmg" ]]; then
  echo "Expected the macOS release asset orderflow-desktop-mac.dmg." >&2
  exit 2
fi

work_dir=$(mktemp -d)
ssh_target="${DOWNLOAD_SSH_USER}@${DOWNLOAD_SSH_HOST}"
run_token="${GITHUB_RUN_ID:-manual}-$$"
remote_staging="${remote_root}/releases/.upload-${DOWNLOAD_TAG}-${run_token}"
remote_target="${remote_root}/releases/${DOWNLOAD_TAG}"
remote_previous="${remote_root}/releases/.previous-${DOWNLOAD_TAG}-${run_token}"

cleanup() {
  rm -rf "${work_dir}"
  ssh -o BatchMode=yes -o IdentitiesOnly=yes "${ssh_target}" \
    "rm -rf '${remote_staging}' '${remote_previous}'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

windows_sha=$(sha256sum "${windows_asset}" | awk '{print $1}')
mac_sha=$(sha256sum "${mac_asset}" | awk '{print $1}')
windows_size=$(stat -c '%s' "${windows_asset}")
mac_size=$(stat -c '%s' "${mac_asset}")

printf '%s  %s\n' "${windows_sha}" "orderflow-desktop-windows.exe" \
  > "${work_dir}/orderflow-desktop-windows.exe.sha256"
printf '%s  %s\n' "${mac_sha}" "orderflow-desktop-mac.dmg" \
  > "${work_dir}/orderflow-desktop-mac.dmg.sha256"

jq -n \
  --arg tag_name "${DOWNLOAD_TAG}" \
  --arg html_url "${download_base_url}/releases/${DOWNLOAD_TAG}/" \
  --arg published_at "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
  --arg windows_url "${download_base_url}/releases/${DOWNLOAD_TAG}/orderflow-desktop-windows.exe" \
  --arg windows_checksum_url "${download_base_url}/releases/${DOWNLOAD_TAG}/orderflow-desktop-windows.exe.sha256" \
  --arg windows_sha "${windows_sha}" \
  --argjson windows_size "${windows_size}" \
  --arg mac_url "${download_base_url}/releases/${DOWNLOAD_TAG}/orderflow-desktop-mac.dmg" \
  --arg mac_checksum_url "${download_base_url}/releases/${DOWNLOAD_TAG}/orderflow-desktop-mac.dmg.sha256" \
  --arg mac_sha "${mac_sha}" \
  --argjson mac_size "${mac_size}" \
  '{
    tag_name: $tag_name,
    html_url: $html_url,
    published_at: $published_at,
    assets: [
      {name: "orderflow-desktop-windows.exe", browser_download_url: $windows_url, sha256: $windows_sha, size: $windows_size},
      {name: "orderflow-desktop-windows.exe.sha256", browser_download_url: $windows_checksum_url},
      {name: "orderflow-desktop-mac.dmg", browser_download_url: $mac_url, sha256: $mac_sha, size: $mac_size},
      {name: "orderflow-desktop-mac.dmg.sha256", browser_download_url: $mac_checksum_url}
    ]
  }' > "${work_dir}/latest.json"

ssh -o BatchMode=yes -o IdentitiesOnly=yes "${ssh_target}" \
  "set -e; rm -rf '${remote_staging}'; mkdir -p '${remote_staging}'"
scp -q -o BatchMode=yes -o IdentitiesOnly=yes \
  "${windows_asset}" \
  "${mac_asset}" \
  "${work_dir}/orderflow-desktop-windows.exe.sha256" \
  "${work_dir}/orderflow-desktop-mac.dmg.sha256" \
  "${work_dir}/latest.json" \
  "${ssh_target}:${remote_staging}/"

ssh -o BatchMode=yes -o IdentitiesOnly=yes "${ssh_target}" "set -e
test -s '${remote_staging}/orderflow-desktop-windows.exe'
test -s '${remote_staging}/orderflow-desktop-mac.dmg'
chmod 0644 '${remote_staging}'/*
rm -rf '${remote_previous}'
if test -e '${remote_target}'; then mv '${remote_target}' '${remote_previous}'; fi
if ! mv '${remote_staging}' '${remote_target}'; then
  if test -e '${remote_previous}'; then mv '${remote_previous}' '${remote_target}'; fi
  exit 1
fi
install -m 0644 '${remote_target}/latest.json' '${remote_root}/latest.json.tmp'
mv '${remote_root}/latest.json.tmp' '${remote_root}/latest.json'
rm -rf '${remote_previous}'"

trap - EXIT
rm -rf "${work_dir}"
printf 'Published %s to %s\n' "${DOWNLOAD_TAG}" "${download_base_url}"
