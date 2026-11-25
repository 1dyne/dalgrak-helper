import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { autostartFile, removeFile, shortcutFile, writeFile } from "../src/launchers.mjs";

const mac = { platform: "darwin", home: "/Users/da", node: "/usr/local/bin/node", bin: "/Users/da/app/bin/dalgrak-helper.mjs", env: {} };
const win = { platform: "win32", home: "C:\\Users\\da", node: "C:\\Program Files\\nodejs\\node.exe", bin: "C:\\app\\bin\\dalgrak-helper.mjs", env: { USERPROFILE: "C:\\Users\\da", APPDATA: "C:\\Users\\da\\AppData\\Roaming" } };
const linux = { platform: "linux", home: "/home/da", node: "/usr/bin/node", bin: "/opt/app/bin/dalgrak-helper.mjs", env: {} };

test("바탕화면 바로가기: 맥은 .command, 윈도우는 .bat, 리눅스는 .desktop", () => {
  const m = shortcutFile(mac);
  assert.equal(m.path, "/Users/da/Desktop/달그락 연결 앱.command");
  assert.equal(m.mode, 0o755);
  assert.match(m.content, /^#!\/bin\/bash\n/);
  assert.match(m.content, /"\/usr\/local\/bin\/node" "\/Users\/da\/app\/bin\/dalgrak-helper\.mjs"/);
  assert.match(m.content, /아무 키나 누르면/);
  const w = shortcutFile(win);
  assert.equal(w.path, "C:\\Users\\da\\Desktop\\달그락 연결 앱.bat");
  assert.match(w.content, /^@echo off\r\nchcp 65001 >nul\r\n/);
  assert.match(w.content, /"C:\\Program Files\\nodejs\\node\.exe" "C:\\app\\bin\\dalgrak-helper\.mjs"\r\n/);
  assert.match(w.content, /pause >nul/);
  const l = shortcutFile(linux);
  assert.equal(l.path, "/home/da/Desktop/dalgrak-helper.desktop");
  assert.match(l.content, /Terminal=true/);
  assert.match(l.content, /Exec="\/usr\/bin\/node" "\/opt\/app\/bin\/dalgrak-helper\.mjs"/);
});

test("로그인할 때 함께 켜기: 맥 LaunchAgent, 윈도우 시작프로그램, 리눅스 autostart", () => {
  const m = autostartFile({ ...mac, logDir: "/Users/da/.config/dalgrak-helper" });
  assert.equal(m.path, "/Users/da/Library/LaunchAgents/app.dalgrak.helper.plist");
  assert.match(m.content, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(m.content, /<string>\/usr\/local\/bin\/node<\/string><string>\/Users\/da\/app\/bin\/dalgrak-helper\.mjs<\/string><string>start<\/string>/);
  const w = autostartFile(win);
  assert.equal(w.path, "C:\\Users\\da\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\달그락 연결 앱.bat");
  assert.match(w.content, /start "달그락 연결 앱" \/min "C:\\Program Files\\nodejs\\node\.exe" "C:\\app\\bin\\dalgrak-helper\.mjs" start/);
  const l = autostartFile(linux);
  assert.equal(l.path, "/home/da/.config/autostart/dalgrak-helper.desktop");
  assert.match(l.content, /Exec="\/usr\/bin\/node" "\/opt\/app\/bin\/dalgrak-helper\.mjs" start/);
});

test("경로에 특수 문자가 있어도 plist가 깨지지 않는다", () => {
  assert.match(autostartFile({ ...mac, bin: "/Users/da/A&B <x>/bin.mjs" }).content, /<string>\/Users\/da\/A&amp;B &lt;x&gt;\/bin\.mjs<\/string>/);
});

test("쓰고 지운다", { skip: process.platform === "win32" }, () => {
  const home = mkdtempSync(join(tmpdir(), "dalgrak-launch-"));
  const file = shortcutFile({ ...mac, home });
  const path = writeFile(file);
  assert.equal(readFileSync(path, "utf8"), file.content);
  assert.equal(statSync(path).mode & 0o777, 0o755);
  assert.equal(removeFile(file), true);
  assert.equal(removeFile(file), false);
});

test("저장소의 맥 실행 파일은 문법이 맞고 실행 권한이 있다", { skip: process.platform === "win32" }, () => {
  const file = fileURLToPath(new URL("../launch/달그락 연결 앱.command", import.meta.url));
  execFileSync("bash", ["-n", file]);
  assert.ok(statSync(file).mode & 0o100);
  const bat = readFileSync(fileURLToPath(new URL("../launch/달그락 연결 앱.bat", import.meta.url)), "utf8");
  assert.match(bat, /chcp 65001/); assert.match(bat, /\.\.\\bin\\dalgrak-helper\.mjs/); assert.ok(bat.includes("\r\n"));
});
