#!/usr/bin/env node
// 시험용 가짜 Claude Code: 받은 옵션과 말을 기록하고, 진짜와 같은 모양의 줄을 내보낸다.
import { readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("9.9.9 (Claude Code)"); process.exit(0); }
const at = (flag) => args[args.indexOf(flag) + 1];
const stdin = readFileSync(0, "utf8");
writeFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ args, stdin, system: readFileSync(at("--append-system-prompt-file"), "utf8"), mcp: JSON.parse(readFileSync(at("--mcp-config"), "utf8")) }));
const out = (o) => console.log(JSON.stringify(o));
if (process.env.FAKE_CLAUDE_FAIL) { out({ type: "result", subtype: "error_during_execution", is_error: true, result: "Invalid API key · Please run /login" }); process.exit(1); }
const delta = (text) => out({ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } });
out({ type: "system", subtype: "init" });
out({ type: "stream_event", parent_tool_use_id: null, event: { type: "message_start" } });
delta("설계도를 ");
out({ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_start", index: 1, content_block: { type: "tool_use", name: "mcp__dalgrak__set_build_plan" } } });
out({ type: "stream_event", parent_tool_use_id: null, event: { type: "message_start" } });
delta("저장했어요.");
out({ type: "result", subtype: "success", is_error: false, result: "저장했어요." });
