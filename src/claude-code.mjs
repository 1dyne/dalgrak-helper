import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TurnError } from "./agent.mjs";

// Claude Code 엔진: 이 컴퓨터에 깔려 있고 사용자가 직접 로그인해 둔 Claude Code를
// 화면 없는 모드(claude -p)로 실행해 한 턴의 답을 받는다.
//
// 이 앱은 Claude Code를 고치지 않고, Claude 로그인에 관여하지 않으며, 로그인 정보를
// 읽지도 않는다. 하는 일은 셋뿐이다: 달그락의 규칙을 덧붙이고(--append-system-prompt-file),
// 달그락 도구를 MCP로 꽂고(--mcp-config), 사용자의 말을 넘긴다. 답은 사용자의 Claude
// 구독으로 Claude Code가 만든다.
//
// 대화·설계 전용이라 Claude Code의 기본 도구(파일 쓰기, 명령 실행)는 끄고(--tools ""),
// 달그락 도구만 허락한다. 그래서 이 방식은 사용자의 컴퓨터에서 아무것도 바꾸지 않는다.

export const CLAUDE_PREFIX = "claude:";
export const CLAUDE_MODELS = [
  { slug: "claude:default", name: "Claude (Claude Code 기본 모델)" },
  { slug: "claude:opus", name: "Claude Opus (Claude Code)" },
  { slug: "claude:sonnet", name: "Claude Sonnet (Claude Code)" },
  { slug: "claude:haiku", name: "Claude Haiku (Claude Code)" }
];
export const INSTALL_HINT = "Claude Code가 설치돼 있지 않아요. https://claude.com/claude-code 에서 설치하고 터미널에서 `claude`를 한 번 실행해 로그인하면, 달그락에서 내 Claude 구독으로 대화할 수 있어요.";
export const isClaudeModel = (slug) => typeof slug === "string" && slug.startsWith(CLAUDE_PREFIX);
const bin = () => process.env.DALGRAK_CLAUDE_BIN || "claude";
const windows = process.platform === "win32";
// 윈도우의 claude는 .cmd라 셸을 거쳐야 실행된다. 셸을 거칠 때는 빈 값과 공백을 따옴표로 지킨다.
const quote = (args) => (windows ? args.map((a) => (a === "" || /[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)) : args);

/** 이 컴퓨터에서 Claude Code를 쓸 수 있는가(설치 여부만 본다. 로그인은 Claude Code의 일이다) */
export function claudeAvailable(spawnSyncImpl = spawnSync) {
  try { const result = spawnSyncImpl(bin(), ["--version"], { encoding: "utf8", timeout: 15_000, shell: windows }); return result.status === 0 && /claude/i.test(String(result.stdout)); }
  catch { return false; }
}

/** 지난 대화를 한 덩어리 글로. Claude Code에는 매번 새 대화로 넘기고 맥락은 달그락 기록에서 준다 */
export function promptOf(job) {
  const history = (job.history ?? []).map((m) => `${m.role === "user" ? "사용자" : m.agent ? `달그락(${m.agent})` : "달그락"}: ${m.text}`).join("\n\n");
  const photos = (job.images ?? []).length ? "\n\n(사용자가 사진을 함께 보냈지만 이 방식에서는 아직 사진을 볼 수 없어요. 사진 내용이 필요하면 글로 설명해 달라고 해주세요.)" : "";
  return `${history ? `# 지금까지의 대화\n${history}\n\n# 사용자의 이번 말\n` : ""}${job.text}${photos}`;
}

export function claudeArgs({ model, promptFile, mcpFile }) {
  const alias = String(model ?? "").slice(CLAUDE_PREFIX.length);
  return ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--append-system-prompt-file", promptFile, "--mcp-config", mcpFile, "--strict-mcp-config", "--tools", "", "--allowedTools", "mcp__dalgrak", "--no-session-persistence", ...(alias && alias !== "default" ? ["--model", alias] : [])];
}

const TURN_TIMEOUT_MS = 20 * 60_000;

/**
 * Claude Code로 한 턴을 한다. 끝난 답의 글을 돌려준다.
 * 글이 나오기 전에 실패하면 error.streamed가 비어 있다.
 */
export async function runClaudeTurn({ job, model, instructions, server, getDalgrakToken, toolTitles = new Map(), onDelta, onStatus, spawnImpl = spawn, signal }) {
  // 지침과 달그락 연결 정보는 명령줄에 싣지 않는다(길이 제한, 그리고 다른 프로그램이 명령줄을 볼 수 있다).
  // 나만 읽을 수 있는 임시 파일로 건네고, 턴이 끝나면 지운다.
  const dir = mkdtempSync(join(tmpdir(), "dalgrak-claude-"));
  const promptFile = join(dir, "instructions.md"); const mcpFile = join(dir, "mcp.json");
  writeFileSync(promptFile, `${instructions}\n\n# 이 대화의 작업 방식\n- 달그락 대장간 도구(mcp__dalgrak__…)만 쓸 수 있어요. 이 컴퓨터의 파일을 읽거나 고치거나 명령을 실행하지 않아요.\n- 설계 결과는 말로만 하지 말고 반드시 달그락 도구로 기록해요.`, { mode: 0o600 });
  writeFileSync(mcpFile, JSON.stringify({ mcpServers: { dalgrak: { type: "http", url: `${server}/api/mcp`, headers: { Authorization: `Bearer ${await getDalgrakToken()}` } } } }), { mode: 0o600 });
  let streamed = ""; let result = null; let stderr = ""; let timer;
  try {
    const child = spawnImpl(bin(), quote(claudeArgs({ model, promptFile, mcpFile })), { cwd: dir, env: process.env, stdio: ["pipe", "pipe", "pipe"], shell: windows });
    const abort = () => { try { child.kill(); } catch { /* 이미 꺼짐 */ } };
    signal?.addEventListener("abort", abort, { once: true });
    const exit = new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", (code) => resolve(code)); });
    child.stderr?.on("data", (chunk) => { stderr = (stderr + chunk).slice(-2000); });
    child.stdin.on("error", () => {});
    child.stdin.end(promptOf(job));
    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1);
        if (!line) continue;
        let message; try { message = JSON.parse(line); } catch { continue; }
        if (message.type === "stream_event" && !message.parent_tool_use_id) {
          const event = message.event;
          if (event?.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) { streamed += event.delta.text; onDelta(event.delta.text); }
          else if (event?.type === "content_block_start" && event.content_block?.type === "tool_use") { const name = String(event.content_block.name ?? "").replace(/^mcp__dalgrak__/, ""); onStatus(toolTitles.get(name) ?? name); }
          else if (event?.type === "message_start" && streamed && !streamed.endsWith("\n\n")) { streamed += "\n\n"; onDelta("\n\n"); }
        } else if (message.type === "result") result = message;
      }
    });
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { abort(); reject(new TurnError("claude_timeout", "Claude Code의 답이 너무 오래 걸려 멈췄어요. 일을 나누어 다시 말해주세요.")); }, TURN_TIMEOUT_MS); });
    const code = await Promise.race([exit, timeout]).catch((error) => { throw error?.code === "ENOENT" ? new TurnError("claude_missing", INSTALL_HINT) : error; }).finally(() => signal?.removeEventListener("abort", abort));
    if (!result || result.is_error || result.subtype !== "success") {
      const detail = String(result?.result ?? stderr).trim();
      if (/log ?in|authenticat|credential|\/login/i.test(detail)) throw new TurnError("claude_signed_out", "Claude Code에 로그인돼 있지 않아요. 내 컴퓨터의 터미널에서 `claude`를 실행해 로그인한 뒤 다시 보내주세요.");
      if (/limit|quota|overloaded|rate/i.test(detail)) throw new TurnError("claude_usage", "Claude 구독의 사용 한도에 닿았거나 잠시 붐벼요. 조금 뒤에 다시 보내주세요.");
      throw new TurnError("claude_failed", `Claude Code가 답을 끝내지 못했어요${detail ? ` (${detail.slice(0, 160)})` : code ? ` (종료 코드 ${code})` : ""}.`);
    }
    return streamed.trim() || String(result.result ?? "").trim();
  } catch (error) {
    throw Object.assign(error instanceof TurnError ? error : new TurnError("claude_error", "Claude Code와 이야기하다 문제가 생겼어요."), { streamed });
  } finally {
    clearTimeout(timer);
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* 다음에 지워진다 */ }
  }
}
