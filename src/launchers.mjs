import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, win32 } from "node:path";
import { fileURLToPath } from "node:url";

// 터미널 명령을 치지 않고 켜는 길: 바탕화면 바로가기와, 컴퓨터를 켤 때 함께 켜기.
// 무엇을 어디에 쓸지는 순수 함수가 정하고(테스트한다), 실제로 쓰는 일은 맨 아래 두 함수만 한다.

export const APP_NAME = "달그락 연결 앱";
const LABEL = "app.dalgrak.helper";
export const binPath = () => fileURLToPath(new URL("../bin/dalgrak-helper.mjs", import.meta.url));

const here = (platform) => (platform === "win32" ? win32.join : join);
const q = (text) => `"${String(text).replace(/"/g, '\\"')}"`;
const xml = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** @returns {{ path: string, content: string, mode: number }} 바탕화면에 둘 바로가기 */
export function shortcutFile({ platform = process.platform, home = homedir(), node = process.execPath, bin = binPath(), env = process.env } = {}) {
  const j = here(platform);
  if (platform === "darwin") {
    return { path: j(home, "Desktop", `${APP_NAME}.command`), mode: 0o755, content: `#!/bin/bash
# ${APP_NAME}: 두 번 누르면 켜져요. 이 창을 닫으면 꺼져요.
${q(node)} ${q(bin)}
code=$?
if [ $code -ne 0 ]; then
  echo
  read -n 1 -s -r -p "문제가 생겨 멈췄어요. 위 글을 확인한 뒤 아무 키나 누르면 창이 닫혀요."
fi
` };
  }
  if (platform === "win32") {
    const desktop = j(env.USERPROFILE || home, "Desktop", `${APP_NAME}.bat`);
    return { path: desktop, mode: 0o644, content: ["@echo off", "chcp 65001 >nul", `title ${APP_NAME}`, `${q(node)} ${q(bin)}`, "if errorlevel 1 (", "  echo.", "  echo 문제가 생겨 멈췄어요. 위 글을 확인한 뒤 아무 키나 누르면 창이 닫혀요.", "  pause >nul", ")", ""].join("\r\n") };
  }
  const desktop = env.XDG_DESKTOP_DIR || j(home, "Desktop");
  return { path: j(desktop, "dalgrak-helper.desktop"), mode: 0o755, content: `[Desktop Entry]
Type=Application
Name=${APP_NAME}
Comment=내 ChatGPT 요금제로 달그락 대장간 대화를 이어줘요
Exec=${q(node)} ${q(bin)}
Terminal=true
` };
}

/** @returns {{ path: string, content: string, mode: number }} 로그인할 때 함께 켜지게 하는 파일 */
export function autostartFile({ platform = process.platform, home = homedir(), node = process.execPath, bin = binPath(), env = process.env, logDir = join(home, ".config", "dalgrak-helper") } = {}) {
  const j = here(platform);
  if (platform === "darwin") {
    return { path: j(home, "Library", "LaunchAgents", `${LABEL}.plist`), mode: 0o644, content: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${xml(node)}</string><string>${xml(bin)}</string><string>start</string></array>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${xml(j(logDir, "autostart.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(j(logDir, "autostart.log"))}</string>
</dict>
</plist>
` };
  }
  if (platform === "win32") {
    const appData = env.APPDATA || j(env.USERPROFILE || home, "AppData", "Roaming");
    return { path: j(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", `${APP_NAME}.bat`), mode: 0o644, content: ["@echo off", "chcp 65001 >nul", `start "${APP_NAME}" /min ${q(node)} ${q(bin)} start`, ""].join("\r\n") };
  }
  const config = env.XDG_CONFIG_HOME || j(home, ".config");
  return { path: j(config, "autostart", "dalgrak-helper.desktop"), mode: 0o644, content: `[Desktop Entry]
Type=Application
Name=${APP_NAME}
Exec=${q(node)} ${q(bin)} start
Terminal=false
X-GNOME-Autostart-enabled=true
` };
}

export function writeFile({ path, content, mode }) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, { mode });
  try { chmodSync(path, mode); } catch { /* Windows */ }
  return path;
}
export function removeFile({ path }) {
  try { rmSync(path); return true; } catch { return false; }
}
