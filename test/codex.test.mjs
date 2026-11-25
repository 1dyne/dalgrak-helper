import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

process.env.DALGRAK_HELPER_HOME = mkdtempSync(join(tmpdir(), "dalgrak-codex-home-"));
const { CODEX_PROVIDER_ARGS, changedFiles, pickUploads, projectDir, runCodexTurn, savedThread, snapshot, uploadFiles, UPLOAD_MAX_CHARS } = await import("../src/codex.mjs");
const { TurnError } = await import("../src/agent.mjs");
const { answer } = await import("../src/relay.mjs");

const FAKE = fileURLToPath(new URL("./fake-codex.mjs", import.meta.url));
let n = 0;
function setup(mode, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "dalgrak-codex-work-"));
  const logFile = join(root, "fake.log");
  process.env.FAKE_MODE = mode; process.env.FAKE_LOG = logFile;
  const job = { text: "몸통을 만들어줘", history: [], projectId: `p${++n}`, projectName: `시험/프로젝트 ${n}`, channel: "me", ...overrides.job };
  const deltas = []; const statuses = []; const tools = []; const tokens = [];
  const options = {
    job, model: "gpt-test", instructions: "규칙", version: "9.9.9", root, command: process.execPath, baseArgs: [FAKE],
    getToken: async (o) => { tokens.push(!!o?.force); return o?.force ? "new" : "old"; },
    callTool: async (name, args) => { tools.push([name, args]); return overrides.tool ?? { ok: true, text: "저장했어요" }; },
    onDelta: (d) => deltas.push(d), onStatus: (s) => statuses.push(s)
  };
  const log = () => (existsSync(logFile) ? readFileSync(logFile, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
  return { options, job, root, deltas, statuses, tools, tokens, log };
}

test("문서대로 띄우고, 인사하고, 스레드를 열고, 답을 흘려받아 끝낸다", async () => {
  const t = setup("ok");
  const text = await runCodexTurn(t.options);
  assert.equal(t.deltas.join(""), "몸통을 만들었어요.");
  const log = t.log(); const boot = log.find((l) => l.boot);
  // 실행 플래그와 토큰 전달
  assert.deepEqual(boot.args, CODEX_PROVIDER_ARGS);
  assert.deepEqual(CODEX_PROVIDER_ARGS.slice(0, 3), ["app-server", "--listen", "stdio://"]);
  assert.ok(CODEX_PROVIDER_ARGS.includes('model_providers.openai_chatgpt_plan.env_key="ACCESS_TOKEN"'));
  assert.ok(CODEX_PROVIDER_ARGS.includes("model_providers.openai_chatgpt_plan.supports_websockets=false"));
  assert.equal(boot.token, "old");
  // 작업 폴더는 프로젝트 이름(폴더에 못 쓰는 글자는 바꿈)
  assert.equal(boot.cwd.endsWith(`시험-프로젝트 ${n}`), true);
  // 대화 순서
  const methods = log.filter((l) => l.got).map((l) => l.got.method);
  assert.deepEqual(methods, ["initialize", "initialized", "thread/start", "turn/start"]);
  const init = log.find((l) => l.got?.method === "initialize").got.params;
  assert.deepEqual(init.clientInfo, { name: "dalgrak_forge", title: "Dalgrak Forge", version: "9.9.9" });
  assert.deepEqual(log.find((l) => l.got?.method === "thread/start").got.params, { model: "gpt-test" });
  const turn = log.find((l) => l.got?.method === "turn/start").got.params;
  assert.equal(turn.threadId, "thread-new");
  assert.match(turn.input[0].text, /^규칙/);
  assert.match(turn.input[0].text, /몸통을 만들어줘$/);
  // 스레드를 기억하고, 만든 파일을 답에 적고, 올릴 수 있는 것만 올린다
  assert.equal(savedThread(t.job), "thread-new");
  assert.match(text, /만든 파일/);
  assert.match(text, /- body\.scad · 달그락 대장간에도 올렸어요/);
  assert.match(text, /- 사진\.png\n|- 사진\.png$/m);
  assert.match(text, /사진\.png \(글자로 된 설계 파일이 아니에요\)/);
  assert.equal(t.tools.length, 1);
  assert.equal(t.tools[0][0], "log_team_turn");
  assert.deepEqual(t.tools[0][1].files, [{ agent: "me", filename: "body.scad", content: "cube([88,72,21]);\n" }]);
  assert.equal(t.tools[0][1].channel, "me"); assert.equal(t.tools[0][1].mode, "work");
});

test("다음 턴은 저장한 스레드를 이어가고, 규칙을 다시 붙이지 않는다", async () => {
  const t = setup("ok");
  await runCodexTurn(t.options);
  writeFileSync(process.env.FAKE_LOG, "");
  await runCodexTurn({ ...t.options, job: { ...t.job, text: "뚜껑도 만들어줘" } });
  const log = t.log();
  assert.deepEqual(log.filter((l) => l.got).map((l) => l.got.method), ["initialize", "initialized", "thread/resume", "turn/start"]);
  assert.deepEqual(log.find((l) => l.got?.method === "thread/resume").got.params, { threadId: "thread-new" });
  assert.equal(log.find((l) => l.got?.method === "turn/start").got.params.input[0].text, "뚜껑도 만들어줘");
  assert.ok(t.statuses.includes("Codex가 이어서 작업하는 중"));
});

test("이어갈 스레드를 서버가 모르면 새로 시작한다", async () => {
  const t = setup("ok");
  await runCodexTurn(t.options);
  process.env.FAKE_MODE = "noresume"; writeFileSync(process.env.FAKE_LOG, "");
  await runCodexTurn(t.options);
  assert.deepEqual(t.log().filter((l) => l.got).map((l) => l.got.method), ["initialize", "initialized", "thread/resume", "thread/start", "turn/start"]);
});

test("아무 말 없이 실패하면 토큰을 새로 받아 다시 띄우고 스레드를 잇는다", async () => {
  const t = setup("expire");
  const text = await runCodexTurn(t.options);
  assert.match(text, /^몸통을 만들었어요\./);
  assert.deepEqual(t.tokens, [false, true]);
  const boots = t.log().filter((l) => l.boot).map((l) => l.token);
  assert.deepEqual(boots, ["old", "new"]);
  assert.ok(t.log().some((l) => l.got?.method === "thread/resume" && l.got.params.threadId === "thread-new"));
});

test("끝내 실패하면 그 상태로 알리고, 성공으로 치지 않는다", async () => {
  const t = setup("failed");
  await assert.rejects(runCodexTurn(t.options), (error) => error instanceof TurnError && error.code === "codex_turn_failed" && !error.streamed && /끝내지 못했어요/.test(error.message));
});

test("Codex가 허락을 물으면 지어내 답하지 않고 거절한 뒤 알린다", async () => {
  const t = setup("approval");
  await runCodexTurn(t.options);
  assert.ok(t.statuses.some((s) => /허락을 물었지만/.test(s)));
});

test("도중에 꺼지면 멈춘 것으로 알린다", async () => {
  const t = setup("crash");
  await assert.rejects(runCodexTurn(t.options), (error) => error instanceof TurnError && error.code === "codex_exited");
});

test("Codex가 설치돼 있지 않으면 설치 방법을 말한다", async () => {
  const t = setup("ok");
  await assert.rejects(runCodexTurn({ ...t.options, command: "codex-does-not-exist-here", baseArgs: [] }), (error) => error.code === "codex_missing" && /npm i -g @openai\/codex/.test(error.message));
});

test("Codex로 못 하면 그 턴만 일반 방식으로 답하고, 이미 말이 나온 뒤의 실패는 그대로 알린다", async () => {
  const context = { models: [{ slug: "m" }], model: "m", tools: [], serverInstructions: "", guide: "" };
  const job = { text: "안녕", history: [], projectId: null, projectName: null, channel: "main" };
  const statuses = [];
  const fell = await answer({ job, context, version: "1", which: "codex", onDelta() {}, onStatus: (s) => statuses.push(s), codexTurn: async () => { throw new TurnError("codex_missing", "없음"); }, responsesTurn: async () => "일반 답" });
  assert.equal(fell, "일반 답");
  assert.deepEqual(statuses, ["Codex가 없어 일반 방식으로 답해요"]);
  await assert.rejects(answer({ job, context, version: "1", which: "codex", onDelta() {}, onStatus() {}, codexTurn: async () => { throw Object.assign(new TurnError("codex_exited", "꺼짐"), { streamed: "반쯤" }); }, responsesTurn: async () => "일반 답" }), { code: "codex_exited" });
  assert.equal(await answer({ job, context, version: "1", which: "responses", onDelta() {}, onStatus() {}, codexTurn: async () => "코덱스", responsesTurn: async () => "일반 답" }), "일반 답");
});

test("바뀐 파일만 고르고, 올릴 수 없는 파일은 이유와 함께 뺀다", () => {
  const dir = mkdtempSync(join(tmpdir(), "dalgrak-files-"));
  writeFileSync(join(dir, "keep.md"), "그대로");
  const before = snapshot(dir);
  writeFileSync(join(dir, "a.scad"), "cube(1);");
  writeFileSync(join(dir, "big.md"), "가".repeat(UPLOAD_MAX_CHARS + 1));
  writeFileSync(join(dir, "bin.stl"), Buffer.from([0, 1, 2, 3]));
  writeFileSync(join(dir, "ascii.stl"), "solid x\nendsolid x\n");
  writeFileSync(join(dir, "뚜껑.scad"), "cube(2);");
  const changed = changedFiles(before, snapshot(dir));
  assert.deepEqual(changed, ["a.scad", "ascii.stl", "big.md", "bin.stl", "뚜껑.scad"]);
  const { upload, skipped } = pickUploads(dir, changed);
  assert.deepEqual(upload.map((f) => f.filename), ["a.scad", "ascii.stl"]);
  assert.deepEqual(skipped.map((s) => s.path), ["big.md", "bin.stl", "뚜껑.scad"]);
});

test("메인 방에서 한 작업은 올리지 않고 그렇게 말하며, 서버가 거절하면 이유를 전한다", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dalgrak-up-"));
  writeFileSync(join(dir, "a.scad"), "cube(1);");
  const main = await uploadFiles({ job: { projectId: "p", channel: "main" }, dir, paths: ["a.scad"], callTool: async () => { throw new Error("부르면 안 됨"); } });
  assert.deepEqual(main.uploaded, []); assert.match(main.note, /올리지 않았어요/);
  const refused = await uploadFiles({ job: { projectId: "p", channel: "hw" }, dir, paths: ["a.scad"], callTool: async () => ({ ok: false, text: "[거절됨] 브레인스토밍 단계에서는 record_brainstorm으로 기록하세요." }) });
  assert.deepEqual(refused.uploaded, []); assert.match(refused.note, /올리지 못한 파일이 있어요: 브레인스토밍 단계에서는/);
});

test("프로젝트 폴더 이름은 폴더에 쓸 수 없는 글자를 바꾼다", () => {
  const root = mkdtempSync(join(tmpdir(), "dalgrak-dir-"));
  assert.equal(projectDir({ projectName: 'a/b:c*?"<>|' }, root), join(root, "a-b-c------"));
  assert.equal(projectDir({ projectId: "id-1" }, root), join(root, "id-1"));
});
