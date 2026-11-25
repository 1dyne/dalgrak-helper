import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";
import { TurnError } from "./agent.mjs";
import { read, write } from "./store.mjs";

// Codex 엔진: 내 컴퓨터에서 코드를 실제로 돌려 파일을 만드는 일(곡면 하우징, 구멍, STL,
// 펌웨어)에 쓴다. `codex app-server`를 자식 프로세스로 띄우고, OpenAI 문서
// "Using Codex app-server"(siwc/token-sharing-open-source/codex-app-server)가 적은 대로
// 줄 단위 JSON으로 말한다.
//
// 문서가 적어 준 것(그대로 따른다):
//   - 실행 플래그(-c model_provider… 일곱 줄)와 ACCESS_TOKEN 환경 변수
//   - initialize(clientInfo name/title/version) → initialized → thread/start(모델) →
//     turn/start(threadId, 사용자 말) → item/agentMessage/delta 표시 →
//     turn/completed의 turn.status가 "completed"일 때만 성공
//   - 토큰을 새로 받으면 app-server를 다시 띄우고 thread/resume(저장한 thread id)
//
// 문서가 적어 주지 않은 것(여기서는 가장 단순한 모양으로 보내고, 서버가 거절하면
// 한국어로 알린 뒤 일반 엔진으로 물러난다. 지어낸 설정 플래그는 쓰지 않는다):
//   - thread/start · turn/start · thread/resume 파라미터의 정확한 필드 이름
//   - item/agentMessage/delta 알림에서 글 조각이 든 필드 이름
//   - 작업 폴더·개발자 지침·MCP 서버를 app-server에 넘기는 방법
//   - Codex가 명령 실행 허락을 물어 올 때의 응답 형식
// 그래서: 작업 폴더는 자식 프로세스의 cwd로 준다. 달그락 규칙과 프로젝트 ID는 새 스레드의
// 첫 말 앞에 붙인다. 달그락 MCP 도구는 Codex에 연결하지 않는다(코드·파일 작업용).

export const CODEX_PROVIDER_ARGS = [
  "app-server", "--listen", "stdio://",
  "-c", 'model_provider="openai_chatgpt_plan"',
  "-c", 'model_providers.openai_chatgpt_plan.name="ChatGPT plan"',
  "-c", 'model_providers.openai_chatgpt_plan.base_url="https://api.openai.com/v1"',
  "-c", 'model_providers.openai_chatgpt_plan.env_key="ACCESS_TOKEN"',
  "-c", 'model_providers.openai_chatgpt_plan.wire_api="responses"',
  "-c", "model_providers.openai_chatgpt_plan.requires_openai_auth=false",
  "-c", "model_providers.openai_chatgpt_plan.supports_websockets=false"
];
export const CLIENT_NAME = "dalgrak_forge";
export const CLIENT_TITLE = "Dalgrak Forge";
export const INSTALL_HINT = "Codex가 설치돼 있지 않아요. 터미널에서 `npm i -g @openai/codex`로 설치하면 코드·파일 작업을 맡길 수 있어요.";
const THREADS_FILE = "codex-threads.json";
const TURN_TIMEOUT_MS = 20 * 60_000;

/** 프로젝트마다 내 컴퓨터에 두는 작업 폴더. Codex가 만든 파일은 여기에 남고, 내 것이다. */
export function projectDir(job, root = process.env.DALGRAK_WORK_DIR || join(homedir(), "Dalgrak")) {
  const raw = String(job.projectName || job.projectId || "새 프로젝트");
  const name = raw.replace(/[\\/:*?"<>|\r\n\t]/g, "-").replace(/^\.+/, "").trim().slice(0, 60) || "project";
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const threadKey = (job) => `${job.projectId ?? "none"}:${job.channel ?? "main"}`;
export const savedThread = (job) => read(THREADS_FILE)?.[threadKey(job)] ?? null;
export function saveThread(job, threadId) {
  const all = read(THREADS_FILE) ?? {};
  if (threadId) all[threadKey(job)] = threadId; else delete all[threadKey(job)];
  write(THREADS_FILE, all);
}

/** app-server 한 개와의 줄 단위 JSON 대화 */
export class AppServer {
  constructor({ command, args, env, cwd, spawnImpl = spawn }) {
    this.pending = new Map();
    this.nextId = 1;
    this.onNotification = () => {};
    this.onRequest = () => {};
    this.closed = false;
    this.exit = new Promise((resolve) => { this.resolveExit = resolve; });
    this.child = spawnImpl(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    this.stderr = "";
    this.child.stderr?.on("data", (chunk) => { this.stderr = (this.stderr + chunk).slice(-2000); });
    let buffer = "";
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        this.receive(message);
      }
    });
    const end = (error) => {
      if (this.closed) return;
      this.closed = true;
      const failure = error?.code === "ENOENT" ? new TurnError("codex_missing", INSTALL_HINT) : new TurnError("codex_exited", "Codex가 답하기 전에 꺼졌어요.");
      for (const { reject } of this.pending.values()) reject(failure);
      this.pending.clear();
      this.resolveExit(failure);
    };
    this.child.on("error", end);
    this.child.on("exit", () => end(null));
    // 자식이 먼저 꺼지면 쓰기에서 EPIPE가 난다. 위의 exit 처리로 충분하다.
    this.child.stdin.on("error", () => {});
  }

  receive(message) {
    if (message.id != null && (message.result !== undefined || message.error !== undefined) && message.method === undefined) {
      const waiting = this.pending.get(message.id);
      if (!waiting) return;
      this.pending.delete(message.id);
      if (message.error) waiting.reject(new TurnError("codex_rpc_error", String(message.error.message ?? "Codex가 요청을 받아들이지 않았어요.")));
      else waiting.resolve(message.result ?? {});
    } else if (message.method && message.id != null) this.onRequest(message);
    else if (message.method) this.onNotification(message);
  }

  send(message) {
    if (this.closed) return;
    try { this.child.stdin.write(`${JSON.stringify(message)}\n`); } catch { /* 꺼지는 중 */ }
  }
  request(method, params) {
    if (this.closed) return Promise.reject(new TurnError("codex_exited", "Codex가 꺼져 있어요."));
    const id = this.nextId++;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.send({ id, method, params }); });
  }
  notify(method, params) { this.send(params === undefined ? { method } : { method, params }); }
  close() {
    if (this.closed) return;
    try { this.child.stdin.end(); } catch { /* 이미 닫힘 */ }
    try { this.child.kill(); } catch { /* 이미 꺼짐 */ }
  }
}

// ── 작업 폴더에서 이번 턴에 만들어지거나 바뀐 파일 ───────────────────────────

const SKIP_DIRS = new Set(["node_modules", ".git", ".codex", "__pycache__", ".venv", "dist", "build"]);
export function snapshot(dir, limit = 5000) {
  const seen = new Map();
  const walk = (current) => {
    let entries;
    try { entries = readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (seen.size >= limit) return;
      const full = join(current, entry.name);
      if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(full); }
      else if (entry.isFile()) { try { const s = statSync(full); seen.set(relative(dir, full).split(sep).join("/"), `${s.mtimeMs}:${s.size}`); } catch { /* 사라진 파일 */ } }
    }
  };
  walk(dir);
  return seen;
}
export function changedFiles(before, after) {
  return [...after.keys()].filter((path) => before.get(path) !== after.get(path)).sort();
}

// 달그락 서버의 log_team_turn이 받는 파일 조건(서버 소스에서 확인): 한 번에 2개,
// 파일명은 영문·숫자·._- 100자 이내, 내용 14000자 이내, 만든 역할은 hw·sw·me·id.
const UPLOAD_EXT = /\.(scad|stl|ino|py|md|json|svg|txt|h|c|cpp|js|ts|csv)$/i;
export const UPLOAD_MAX_CHARS = 14000;
const UPLOAD_MAX_FILES = 6;

/** 올릴 수 있는 파일과, 왜 못 올리는지 */
export function pickUploads(dir, paths) {
  const upload = []; const skipped = [];
  for (const path of paths) {
    const name = path.split("/").pop();
    if (!UPLOAD_EXT.test(name)) { skipped.push({ path, why: "글자로 된 설계 파일이 아니에요" }); continue; }
    if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(name)) { skipped.push({ path, why: "파일 이름에 영문·숫자·._- 외의 글자가 있어요" }); continue; }
    let content;
    try { content = readFileSync(join(dir, path), "utf8"); } catch { skipped.push({ path, why: "읽지 못했어요" }); continue; }
    if (content.includes("\u0000") || (/\.stl$/i.test(name) && !content.trimStart().startsWith("solid"))) { skipped.push({ path, why: "글자 형식(ASCII)이 아니에요" }); continue; }
    if (!content.trim()) { skipped.push({ path, why: "빈 파일이에요" }); continue; }
    if (content.length > UPLOAD_MAX_CHARS) { skipped.push({ path, why: `${UPLOAD_MAX_CHARS.toLocaleString("ko-KR")}자를 넘어요` }); continue; }
    if (upload.some((f) => f.filename === name)) { skipped.push({ path, why: "같은 이름의 파일이 이미 있어요" }); continue; }
    if (upload.length >= UPLOAD_MAX_FILES) { skipped.push({ path, why: `한 번에 ${UPLOAD_MAX_FILES}개까지만 올려요` }); continue; }
    upload.push({ path, filename: name, content });
  }
  return { upload, skipped };
}

/** 만든 파일을 달그락 대장간의 그 달그락 작업 파일로 올린다. 달그락 방(hw·sw·me·id)에서 한 일만 올릴 수 있다. */
export async function uploadFiles({ job, dir, paths, callTool }) {
  const role = ["hw", "sw", "me", "id"].includes(job.channel) ? job.channel : null;
  if (!paths.length) return { uploaded: [], note: "" };
  if (!job.projectId || !role) return { uploaded: [], note: "달그락 대장간에는 올리지 않았어요. 파일 올리기는 하드웨어·소프트웨어·기구설계·제품 디자인 달그락의 대장간에서 한 작업만 돼요." };
  const { upload, skipped } = pickUploads(dir, paths);
  const uploaded = []; let failure = "";
  for (let i = 0; i < upload.length && !failure; i += 2) {
    const batch = upload.slice(i, i + 2);
    const result = await callTool("log_team_turn", {
      projectId: job.projectId, channel: role, mode: "work",
      sharedSummary: `변경 제안: Codex가 내 컴퓨터에서 만든 작업 파일 ${batch.map((f) => f.filename).join(", ")}. 미검증: 실행·출력·실측으로 확인하지 않은 초안이에요.`.slice(0, 1000),
      files: batch.map((f) => ({ agent: role, filename: f.filename, content: f.content }))
    });
    if (result.ok) uploaded.push(...batch.map((f) => f.filename)); else failure = result.text.replace(/^\[[^\]]+\]\s*/, "").split("\n")[0].slice(0, 200);
  }
  const notes = [];
  if (failure) notes.push(`달그락 대장간에 올리지 못한 파일이 있어요: ${failure}`);
  if (skipped.length) notes.push(`올리지 않은 파일: ${skipped.slice(0, 6).map((s) => `${s.path} (${s.why})`).join(", ")}`);
  return { uploaded, note: notes.join("\n") };
}

// ── 한 번의 턴 ────────────────────────────────────────────────────────────────

function firstMessage({ job, instructions, dir }) {
  return [
    instructions,
    `# 이 대화의 작업 방식 (Codex)\n- 작업 폴더는 ${dir} 이에요. 만드는 파일은 모두 이 폴더 안에 두세요.\n- 이 대화에서는 달그락 대장간 도구(dalgrak)를 직접 부를 수 없어요. 설계 기록이 필요한 내용은 답에 정리해 주세요.\n- 파일 이름은 영문·숫자·._- 로만 지어 주세요. 답의 끝에 만든 파일과 사람이 확인할 것을 적어 주세요.`,
    `---\n\n${job.text}`
  ].filter(Boolean).join("\n\n");
}

async function attempt({ job, model, text, token, command, baseArgs, dir, version, onDelta, onStatus, spawnImpl, signal, resumeId }) {
  const server = new AppServer({ command, args: [...baseArgs, ...CODEX_PROVIDER_ARGS], cwd: dir, env: { ...process.env, ACCESS_TOKEN: token }, spawnImpl });
  let streamed = "";
  let finish;
  const completed = new Promise((resolve) => { finish = resolve; });
  server.onNotification = (message) => {
    if (message.method === "item/agentMessage/delta") {
      // 글 조각의 필드 이름은 문서에 없다. delta를 먼저 보고, 없으면 text를 본다.
      const delta = message.params?.delta ?? message.params?.text;
      if (typeof delta === "string" && delta) { streamed += delta; onDelta(delta); }
    } else if (message.method === "turn/completed") finish(message.params ?? {});
  };
  server.onRequest = (message) => {
    // Codex가 허락 등을 물어 올 때의 응답 형식은 문서에 없다. 지어내 답하지 않고 거절한다.
    onStatus("Codex가 허락을 물었지만 이 앱은 아직 대신 답하지 못해 거절했어요");
    server.send({ id: message.id, error: { code: -32601, message: "not supported by this client" } });
  };
  const abort = () => server.close();
  signal?.addEventListener("abort", abort, { once: true });
  let timer;
  // 자식이 먼저 꺼지면 기다리던 것들을 깨운다. 정상 종료 때는 아무도 듣지 않으므로 미리 받아 둔다.
  const exited = server.exit.then((failure) => { throw failure; });
  exited.catch(() => {});
  try {
    await server.request("initialize", { clientInfo: { name: CLIENT_NAME, title: CLIENT_TITLE, version } });
    server.notify("initialized");
    let threadId = null; let resumed = false;
    if (resumeId) {
      try { const result = await server.request("thread/resume", { threadId: resumeId }); threadId = result?.thread?.id ?? resumeId; resumed = true; }
      catch (error) { if (error?.code !== "codex_rpc_error") throw error; }
    }
    if (!threadId) {
      const result = await server.request("thread/start", { model });
      threadId = result?.thread?.id;
      if (!threadId) throw new TurnError("codex_protocol", "Codex가 대화를 시작했다는 답을 예상한 모양으로 주지 않았어요.");
    }
    onStatus(resumed ? "Codex가 이어서 작업하는 중" : "Codex가 작업을 시작했어요");
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new TurnError("codex_timeout", "Codex 작업이 너무 오래 걸려 멈췄어요. 일을 나누어 다시 말해주세요.")), TURN_TIMEOUT_MS); });
    timeout.catch(() => {});
    // 사용자 말을 넘기는 필드 모양은 문서에 없다(“threadId와 사용자 메시지”라고만 한다).
    await Promise.race([server.request("turn/start", { threadId, input: [{ type: "text", text: text(resumed) }] }), timeout, exited]);
    const done = await Promise.race([completed, timeout, exited]);
    const status = done?.turn?.status;
    return { threadId, status, streamed, resumed, error: done?.turn?.error?.message ?? done?.error?.message ?? null };
  } catch (error) {
    throw Object.assign(error instanceof TurnError ? error : new TurnError("codex_error", "Codex와 이야기하다 문제가 생겼어요."), { streamed });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    server.close();
  }
}

/**
 * Codex로 한 턴을 한다. 성공하면 화면에 남길 글(끝에 만든 파일 목록 포함)을 돌려준다.
 * 아직 아무것도 흘려보내지 않은 채 실패하면 error.streamed가 비어 있다 — 부르는 쪽이 일반 엔진으로 물러날 수 있다.
 */
export async function runCodexTurn({ job, model, instructions, getToken, callTool, onDelta, onStatus, version = "0", command = process.env.DALGRAK_CODEX_BIN || "codex", baseArgs = [], root, spawnImpl = spawn, signal }) {
  const dir = projectDir(job, root);
  const before = snapshot(dir);
  const text = (resumed) => (resumed ? job.text : firstMessage({ job, instructions, dir }));
  const common = { job, model, text, command, baseArgs, dir, version, onDelta, onStatus, spawnImpl, signal };
  let result = await attempt({ ...common, token: await getToken(), resumeId: savedThread(job) });
  {
    if (result.threadId) saveThread(job, result.threadId);
    // 문서: 토큰을 새로 받았으면 app-server를 다시 띄우고 thread/resume으로 잇는다.
    // 실패의 이유가 토큰인지는 알 수 없으므로, 아무 글도 나오지 않은 실패에 한해 한 번만 그렇게 한다.
    if (result.status !== "completed" && !result.streamed) {
      onStatus("Codex를 다시 켜서 이어가는 중");
      result = await attempt({ ...common, token: await getToken({ force: true }), resumeId: result.threadId });
      if (result.threadId) saveThread(job, result.threadId);
    }
  }
  if (result.status !== "completed") {
    throw Object.assign(new TurnError(`codex_turn_${result.status ?? "unknown"}`, result.status === "interrupted" ? "Codex 작업이 중간에 멈췄어요. 다시 말해주세요." : `Codex가 작업을 끝내지 못했어요${result.error ? ` (${String(result.error).slice(0, 160)})` : ""}. 다시 말해주세요.`), { streamed: result.streamed });
  }
  const changed = changedFiles(before, snapshot(dir));
  const lines = [result.streamed.trim() || "작업을 마쳤어요."];
  if (changed.length) {
    const { uploaded, note } = await uploadFiles({ job, dir, paths: changed, callTool });
    lines.push(`만든 파일 (내 컴퓨터의 ${dir})\n${changed.slice(0, 30).map((p) => `- ${p}${uploaded.includes(p.split("/").pop()) ? " · 달그락 대장간에도 올렸어요" : ""}`).join("\n")}${changed.length > 30 ? `\n- … 그 밖에 ${changed.length - 30}개` : ""}`);
    if (note) lines.push(note);
  }
  return lines.join("\n\n");
}
