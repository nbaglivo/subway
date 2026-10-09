#!/usr/bin/env bash
# Installs (or removes) a macOS LaunchAgent that starts the bridge at login
# and restarts it if it dies.
# Usage: bridge/bin/launch-agent.sh install|uninstall
set -euo pipefail

label="com.medialuna.bridge"
plist="$HOME/Library/LaunchAgents/$label.plist"
log="$HOME/Library/Logs/medialuna-bridge.log"
domain="gui/$(id -u)"

case "${1:-}" in
  install)
    bridge_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    node_bin="$(command -v node)" || { echo "node not found on PATH" >&2; exit 1; }
    claude_bin="$(command -v claude)" || { echo "claude not found on PATH" >&2; exit 1; }
    # launchd starts with a bare PATH; run-skill.sh needs to find claude.
    path="$(dirname "$node_bin"):$(dirname "$claude_bin"):/opt/homebrew/bin:/usr/bin:/bin"

    mkdir -p "$(dirname "$plist")" "$(dirname "$log")"
    cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>$node_bin</string>
    <string>$bridge_dir/server.mjs</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$bridge_dir</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$path</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$log</string>
  <key>StandardErrorPath</key>
  <string>$log</string>
</dict>
</plist>
EOF
    launchctl bootout "$domain/$label" 2>/dev/null || true
    launchctl bootstrap "$domain" "$plist"
    echo "installed $label (logs: $log)"
    ;;
  uninstall)
    launchctl bootout "$domain/$label" 2>/dev/null || true
    rm -f "$plist"
    echo "removed $label"
    ;;
  *)
    echo "usage: $0 install|uninstall" >&2
    exit 2
    ;;
esac
