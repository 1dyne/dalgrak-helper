import { buildInstructions, friendly, listModels, runTurn, TurnError } from "./agent.mjs";
import * as dalgrak from "./dalgrak.mjs";
import * as openai from "./openai-auth.mjs";
import { read, write } from "./store.mjs";
import { runCodexTurn } from "./codex.mjs";
import { CLAUDE_MODELS, claudeAvailable, isClaudeModel, runClaudeTurn } from "./claude-code.mjs";

// 달그락 서버에 "할 일 있나요?"를 계속 묻고, 일이 오면 이 컴퓨터에서 답을 만들어
// 조금씩 올려보낸다. 나가는 연결만 쓰므로 공유기 설정이나 포트 개방이 필요 없다.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 이 계정이 쓸 수 있는 모델 목록과, 따로 고르지 않았을 때 쓸 기본 모델 */
export async function loadModels({ hasClaude = claudeAvailable(), hasChatgpt = openai.planEnabled() } = {}) {
  const preferred = process.env.DALGRAK_MODEL || read("settings.json")?.model;
  // ChatGPT 요금제와 Claude Code 가운데 이 컴퓨터에서 쓸 수 있는 것을 모두 보여준다.
  // Claude Code가 있으면 그쪽을 먼저 보여주고 기본으로 쓴다(로그인 증표를 이 앱이 맡지 않는 쪽이 먼저다).
  const models = [...(hasClaude ? CLAUDE_MODELS : []), ...(hasChatgpt ? await listModels(await openai.accessToken()) : [])];
  if (!models.length) throw new TurnError("no_models", "쓸 수 있는 AI가 없어요. ChatGPT에 로그인하거나 Claude Code를 설치해주세요.");
  return { models, model: (models.find((m) => m.slug === preferred) ?? models[0]).slug };
}
export const pickModel = async () => (await loadModels()).model;

/** 답을 만드는 방식. responses = 대화와 설계(기본), codex = 내 컴퓨터에서 코드·파일 작업 */
export const ENGINES = ["responses", "codex"];
export const engine = () => (ENGINES.includes(process.env.DALGRAK_ENGINE) ? process.env.DALGRAK_ENGINE : ENGINES.includes(read("settings.json")?.engine) ? read("settings.json").engine : "responses");
export const setEngine = (name) => write("settings.json", { ...(read("settings.json") ?? {}), engine: name });

/**
 * 한 턴을 고른 엔진으로 한다. Codex가 없거나 아무 말도 하기 전에 실패하면, 그 턴만 일반 엔진으로 한다.
 * (이미 글이 흘러나온 뒤의 실패는 그대로 알린다 — 같은 말을 두 번 하게 하지 않는다.)
 */
export async function answer({ job, context, version, onDelta, onStatus, log = () => {}, which = engine(), codexTurn = runCodexTurn, responsesTurn = runTurn, claudeTurn = runClaudeTurn }) {
  const model = context.models.some((m) => m.slug === job.model) ? job.model : context.model;
  const instructions = buildInstructions({ serverInstructions: context.serverInstructions, guide: context.guide, job });
  // 화면에서 Claude를 골랐으면 이 컴퓨터의 Claude Code에게 맡긴다(사용자의 Claude 구독).
  if (isClaudeModel(model)) return claudeTurn({ job, model, instructions, server: dalgrak.server(), getDalgrakToken: dalgrak.accessToken, toolTitles: new Map(context.tools.map((t) => [t.name, t.title ?? t.name])), onDelta, onStatus });
  const shared = { job, model, instructions, getToken: openai.accessToken, callTool: dalgrak.mcp.callTool, onDelta, onStatus };
  if (which === "codex") {
    try { return await codexTurn({ ...shared, version }); }
    catch (error) {
      if (error?.streamed) throw error;
      log(`Codex로 하지 못해 일반 방식으로 답해요: ${error?.code ?? "codex_error"}`);
      onStatus(error?.code === "codex_missing" ? "Codex가 없어 일반 방식으로 답해요" : "Codex가 답하지 못해 일반 방식으로 답해요");
    }
  }
  return responsesTurn({ ...shared, tools: context.tools });
}

export const setModel = (slug) => write("settings.json", { ...(read("settings.json") ?? {}), model: slug });

async function report(jobId, events) {
  if (!events.length) return;
  // 답의 끝(done)이 전달되지 않으면 화면이 계속 기다린다. 몇 번 더 보낸다.
  for (let attempt = 0; attempt < 4; attempt++) {
    try { const response = await dalgrak.call(`/api/helper/jobs/${jobId}`, { events }); if (response.ok || response.status === 404 || response.status === 400) return; } catch { /* 다시 */ }
    await sleep(500 * 2 ** attempt);
  }
}

async function handle(job, context, log) {
  let pending = [];
  let flushing = Promise.resolve();
  const flush = () => { const batch = pending; pending = []; flushing = flushing.then(() => report(job.id, batch)); return flushing; };
  const timer = setInterval(() => { if (pending.length) void flush(); }, 350);
  const push = (event) => {
    const last = pending.at(-1);
    if (event.type === "delta" && last?.type === "delta" && last.text.length < 4000) last.text += event.text;
    else pending.push(event);
    if (pending.length >= 40) void flush();
  };
  try {
    const text = await answer({
      job, context, version: context.version, log,
      onDelta: (delta) => push({ type: "delta", text: delta }),
      onStatus: (status) => push({ type: "status", text: status.slice(0, 200) })
    });
    push({ type: "done", text: (text || "답변이 비어 있어요. 다시 말씀해주세요.").slice(0, 20000) });
    log(`답변 완료 (${text.length}자)`);
  } catch (error) {
    const code = error?.code ?? "helper_error";
    log(`답변 실패: ${code}`);
    push({ type: "error", code: String(code).slice(0, 80), message: friendly(code, error instanceof TurnError ? error.message : undefined).slice(0, 500) });
  } finally {
    clearInterval(timer);
    await flush();
  }
}

export async function prepare(version) {
  const init = await dalgrak.mcp.initialize(version);
  const tools = await dalgrak.mcp.listTools();
  // 긴 사용 규칙은 한 번 읽어 매 턴의 지침에 넣는다. 모델이 "읽으러 가는 것"에 기대지 않는다.
  const guide = tools.some((tool) => tool.name === "dalgeurak_guide") ? (await dalgrak.mcp.callTool("dalgeurak_guide", {})).text : "";
  return { serverInstructions: init.instructions ?? "", tools: tools.filter((tool) => tool.name !== "dalgeurak_guide"), guide, version, ...(await loadModels()) };
}

export async function serve({ version, log = console.log, signal }) {
  let context = await prepare(version);
  let preparedAt = Date.now();
  log(`준비됐어요. 모델: ${context.model} · 달그락 도구 ${context.tools.length}개${engine() === "codex" ? " · Codex로 코드·파일 작업" : ""}`);
  log("이 창을 켜 둔 동안 달그락 대장간(어느 기기에서든)에서 대화할 수 있어요.");
  let failures = 0;
  while (!signal?.aborted) {
    try {
      const hello = { model: context.model, version, account: openai.account()?.email ?? (context.models.some((m) => isClaudeModel(m.slug)) ? "Claude Code" : null), models: context.models.slice(0, 40).map((m) => ({ slug: String(m.slug).slice(0, 80), name: String(m.name).slice(0, 80) })) };
      const response = await dalgrak.call("/api/helper/poll", hello, { timeoutMs: 40_000 });
      if (response.status === 404) throw Object.assign(new Error("이 달그락 대장간 서버는 아직 화면 안 대화를 지원하지 않아요. 서버가 업데이트된 뒤 다시 켜주세요."), { code: "unsupported_server" });
      if (!response.ok) throw new Error(`poll ${response.status}`);
      failures = 0;
      const { job } = await response.json();
      if (!job) continue;
      // 서버의 도구나 규칙이 바뀌었을 수 있으니 가끔 다시 읽는다.
      if (Date.now() - preparedAt > 30 * 60_000) { try { context = await prepare(version); preparedAt = Date.now(); } catch { /* 이전 것을 쓴다 */ } }
      log(`새 메시지 (${job.projectName ?? "새 프로젝트"})`);
      await handle(job, context, log);
    } catch (error) {
      if (signal?.aborted) break;
      if (error?.code === "unsupported_server") { log(error.message); throw error; }
      if (error?.code === "signed_out") {
        // 도구 연결은 되는데 여기서만 거절되면, 로그인이 아니라 서버가 아직 이 기능을 모르는 것이다.
        const toolsStillWork = await dalgrak.mcp.listTools().then(() => true, () => false);
        const message = toolsStillWork ? "이 달그락 대장간 서버는 아직 화면 안 대화를 지원하지 않아요. 서버가 업데이트된 뒤 다시 켜주세요." : error.message;
        log(message); throw Object.assign(new Error(message), { code: toolsStillWork ? "unsupported_server" : "signed_out" });
      }
      failures++;
      await sleep(Math.min(30_000, 1000 * 2 ** Math.min(failures, 5)));
    }
  }
}
