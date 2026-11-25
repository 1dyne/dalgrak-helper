#!/usr/bin/env node
// 시험용 가짜 `codex app-server`. 문서가 적은 줄 단위 JSON만 말한다.
// FAKE_MODE: ok(기본) | failed | expire(ACCESS_TOKEN이 old면 실패) | approval | crash | noresume
// FAKE_LOG: 받은 것(인자, 토큰, 메시지)을 한 줄씩 적는 파일
import { appendFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const mode = process.env.FAKE_MODE ?? "ok";
const log = (entry) => { if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, `${JSON.stringify(entry)}\n`); };
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
log({ boot: true, args: process.argv.slice(2), token: process.env.ACCESS_TOKEN ?? null, cwd: process.cwd() });

createInterface({ input: process.stdin }).on("line", (line) => {
  let message; try { message = JSON.parse(line); } catch { return; }
  log({ got: message });
  const { id, method, params } = message;
  if (method === "initialize") return send({ id, result: { userAgent: "fake-codex" } });
  if (method === "initialized") return;
  if (method === "thread/start") return send({ id, result: { thread: { id: "thread-new" } } });
  if (method === "thread/resume") return mode === "noresume" ? send({ id, error: { code: -32000, message: "no such thread" } }) : send({ id, result: { thread: { id: params.threadId } } });
  if (method === "turn/start") {
    if (mode === "crash") process.exit(3);
    send({ id, result: { turn: { id: "turn-1" } } });
    if (mode === "failed" || (mode === "expire" && process.env.ACCESS_TOKEN === "old")) return send({ method: "turn/completed", params: { turn: { id: "turn-1", status: "failed", error: { message: "unauthorized" } } } });
    if (mode === "approval") send({ id: 900, method: "item/commandExecution/requestApproval", params: { command: "rm -rf /" } });
    send({ method: "item/agentMessage/delta", params: { delta: "몸통을 " } });
    send({ method: "item/agentMessage/delta", params: { delta: "만들었어요." } });
    writeFileSync("body.scad", "cube([88,72,21]);\n");
    writeFileSync("사진.png", "not really a png");
    return send({ method: "turn/completed", params: { turn: { id: "turn-1", status: "completed" } } });
  }
  if (id != null && method) send({ id, error: { code: -32601, message: "unknown method" } });
});
