#!/bin/zsh
set -euo pipefail

LABEL="com.kmcb.service-control"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"
CLI_PATH="${HOME}/.local/bin/kmcb-svc"
APP_ROOT="${HOME}/Library/Application Support/KMCBServiceControl"

launchctl bootout "gui/${UID}/${LABEL}" >/dev/null 2>&1 || true
if [[ -L "${CLI_PATH}" ]]; then
  rm "${CLI_PATH}"
fi
if [[ -f "${PLIST_PATH}" ]]; then
  rm "${PLIST_PATH}"
fi
if [[ -d "${APP_ROOT}" ]]; then
  rm -rf "${APP_ROOT}"
fi

echo "Uninstalled ${LABEL}"
