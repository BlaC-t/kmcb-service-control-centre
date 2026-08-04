#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=${0:A:h}
TOOL_ROOT=${SCRIPT_DIR:h}
NODE_BIN=$(command -v node)
APP_ROOT="${HOME}/Library/Application Support/KMCBServiceControl"
PLIST_DIR="${HOME}/Library/LaunchAgents"
PLIST_PATH="${PLIST_DIR}/com.kmcb.service-control.plist"
RUNTIME_DIR="${APP_ROOT}/runtime"
LABEL="com.kmcb.service-control"

mkdir -p "${PLIST_DIR}" "${APP_ROOT}" "${RUNTIME_DIR}" "${HOME}/.local/bin"

launchctl bootout "gui/${UID}/${LABEL}" >/dev/null 2>&1 || true

for PID in $(/usr/sbin/lsof -nP -iTCP:17600 -sTCP:LISTEN -t 2>/dev/null || true); do
  PROCESS_CWD=$(/usr/sbin/lsof -a -p "${PID}" -d cwd -Fn 2>/dev/null | awk '/^n/{print substr($0,2); exit}')
  if [[ "${PROCESS_CWD}" != "${TOOL_ROOT}" && "${PROCESS_CWD}" != "${APP_ROOT}" ]]; then
    echo "Refusing installation: port 17600 belongs to ${PROCESS_CWD:-unknown} (PID ${PID})." >&2
    exit 1
  fi
  kill "${PID}"
done

for ATTEMPT in {1..50}; do
  if ! /usr/sbin/lsof -nP -iTCP:17600 -sTCP:LISTEN -t >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

if /usr/sbin/lsof -nP -iTCP:17600 -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "Control center port 17600 did not become available." >&2
  exit 1
fi

/usr/bin/rsync -a --delete "${TOOL_ROOT}/src/" "${APP_ROOT}/src/"
/usr/bin/rsync -a --delete "${TOOL_ROOT}/public/" "${APP_ROOT}/public/"
/usr/bin/rsync -a --delete "${TOOL_ROOT}/config/" "${APP_ROOT}/config/"
/usr/bin/rsync -a --delete "${TOOL_ROOT}/bin/" "${APP_ROOT}/bin/"
cp "${TOOL_ROOT}/package.json" "${APP_ROOT}/package.json"

cat > "${PLIST_PATH}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${APP_ROOT}/src/server.mjs</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${APP_ROOT}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${RUNTIME_DIR}/control-center.log</string>
  <key>StandardErrorPath</key>
  <string>${RUNTIME_DIR}/control-center.log</string>
</dict>
</plist>
PLIST

chmod 600 "${PLIST_PATH}"
ln -sfn "${APP_ROOT}/bin/svc.mjs" "${HOME}/.local/bin/kmcb-svc"
chmod +x "${APP_ROOT}/bin/svc.mjs"

launchctl bootstrap "gui/${UID}" "${PLIST_PATH}"
launchctl enable "gui/${UID}/${LABEL}"

for ATTEMPT in {1..50}; do
  if curl -fsS --max-time 1 "http://127.0.0.1:17600/api/status" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

if ! curl -fsS --max-time 1 "http://127.0.0.1:17600/api/status" >/dev/null 2>&1; then
  echo "LaunchAgent was installed but the dashboard did not become ready." >&2
  echo "Check ${RUNTIME_DIR}/control-center.log" >&2
  exit 1
fi

echo "Installed ${LABEL}"
echo "Dashboard: http://127.0.0.1:17600"
echo "CLI: ${HOME}/.local/bin/kmcb-svc status"
