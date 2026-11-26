import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CLAUDE_MODELS, claudeArgs, claudeAvailable, isClaudeModel, promptOf, runClaudeTurn } from "../src/claude-code.mjs";

const fake = join(dirname(fileURLToPath(import.meta.url)), "fake-claude.mjs");
const log = join(mkdtempSync(join(tmpdir(), "fake-claude-")), "log.json");
process.env.DALGRAK_CLAUDE_BIN = fake; process.env.FAKE_CLAUDE_LOG = log;
const turn = (extra = {}) => { const deltas = []; const statuses = []; return runClaudeTurn({ job: { text: "저울을 만들고 싶어요", history: [{ role: "user", text: "안녕" }, { role: "assistant", agent: "chief", text: "안녕하세요" }] }, model: "claude:sonnet", instructions: "항상 해요체", server: "https://dalgrak.test", getDalgrakToken: async () => "tok-123", toolTitles: new Map([["set_build_plan", "설계도 저장"]]), onDelta: (d) => deltas.push(d), onStatus: (s) => statuses.push(s), ...extra }).then((text) => ({ text, deltas, statuses })); };

test("finds Claude Code and lists its models under the claude: prefix", () => {
  assert.equal(claudeAvailable(), true);
  assert.ok(CLAUDE_MODELS.every((m) => isClaudeModel(m.slug)));
  assert.equal(isClaudeModel("gpt-6.2-sol"), false);
});

test("runs a turn: rules by file, Dalgrak tools only, nothing of the token on the command line", async () => {
  const { text, deltas, statuses } = await turn();
  assert.equal(text, "설계도를 \n\n저장했어요.");
  assert.deepEqual(statuses, ["설계도 저장"]);
  assert.ok(deltas.length >= 2);
  const seen = JSON.parse(readFileSync(log, "utf8"));
  assert.ok(seen.system.startsWith("항상 해요체"));
  assert.deepEqual(seen.mcp.mcpServers.dalgrak, { type: "http", url: "https://dalgrak.test/api/mcp", headers: { Authorization: "Bearer tok-123" } });
  assert.ok(!seen.args.join(" ").includes("tok-123"));
  // 기본 도구는 웹 검색·읽기만. 파일 쓰기와 명령 실행은 없다.
  // 기본은 웹 검색만. 찾은 페이지를 직접 여는 것은 사용자가 켰을 때만.
  assert.equal(seen.args[seen.args.indexOf("--tools") + 1], "WebSearch");
  assert.equal(seen.args[seen.args.indexOf("--allowedTools") + 1], "mcp__dalgrak,WebSearch");
  process.env.DALGRAK_WEB_READ = "on";
  await turn();
  assert.equal(JSON.parse(readFileSync(log, "utf8")).args.includes("WebSearch,WebFetch"), true);
  delete process.env.DALGRAK_WEB_READ;
  assert.equal(seen.args[seen.args.indexOf("--model") + 1], "sonnet");
  assert.ok(seen.args.includes("--strict-mcp-config") && seen.args.includes("--no-session-persistence"));
  assert.match(seen.stdin, /지금까지의 대화[\s\S]*사용자: 안녕[\s\S]*이번 말\n저울을 만들고 싶어요/);
  // 연결 정보가 든 임시 파일은 남지 않는다
  assert.equal(existsSync(seen.args[seen.args.indexOf("--mcp-config") + 1]), false);
});

test("the default model passes no --model, and a signed-out Claude Code is explained", async () => {
  assert.ok(!claudeArgs({ model: "claude:default", promptFile: "a", mcpFile: "b" }).includes("--model"));
  assert.match(promptOf({ text: "봐줘", images: [{}] }), /사진/);
  process.env.FAKE_CLAUDE_FAIL = "1";
  await assert.rejects(turn(), (error) => error.code === "claude_signed_out" && !error.streamed);
  delete process.env.FAKE_CLAUDE_FAIL;
});

test("a missing Claude Code says how to install it", async () => {
  process.env.DALGRAK_CLAUDE_BIN = "/nonexistent/claude";
  await assert.rejects(turn(), (error) => error.code === "claude_missing");
  process.env.DALGRAK_CLAUDE_BIN = fake;
});
