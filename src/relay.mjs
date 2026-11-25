import { buildInstructions, friendly, listModels, runTurn, TurnError } from "./agent.mjs";
import * as dalgrak from "./dalgrak.mjs";
import * as openai from "./openai-auth.mjs";
import { read, write } from "./store.mjs";

// 달그락 서버에 "할 일 있나요?"를 계속 묻고, 일이 오면 이 컴퓨터에서 답을 만들어
// 조금씩 올려보낸다. 나가는 연결만 쓰므로 공유기 설정이나 포트 개방이 필요 없다.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 이 계정이 쓸 수 있는 모델 목록과, 따로 고르지 않았을 때 쓸 기본 모델 */
export async function loadModels() {
  const preferred = process.env.DALGRAK_MODEL || read("settings.json")?.model;
  const models = await listModels(await openai.accessToken());
  if (!models.length) throw new TurnError("no_models", "이 ChatGPT 계정에서 쓸 수 있는 모델이 없어요.");
  return { models, model: (models.find((m) => m.slug === preferred) ?? models[0]).slug };
}
export const pickModel = async () => (await loadModels()).model;

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
    const text = await runTurn({
      // 화면에서 고른 모델이 이 계정에서 쓸 수 있는 것이면 그걸 쓴다.
      job, model: context.models.some((m) => m.slug === job.model) ? job.model : context.model, tools: context.tools,
      instructions: buildInstructions({ serverInstructions: context.serverInstructions, guide: context.guide, job }),
      getToken: openai.accessToken, callTool: dalgrak.mcp.callTool,
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
  return { serverInstructions: init.instructions ?? "", tools: tools.filter((tool) => tool.name !== "dalgeurak_guide"), guide, ...(await loadModels()) };
}

export async function serve({ version, log = console.log, signal }) {
  let context = await prepare(version);
  let preparedAt = Date.now();
  log(`준비됐어요. 모델: ${context.model} · 달그락 도구 ${context.tools.length}개`);
  log("이 창을 켜 둔 동안 달그락 대장간(어느 기기에서든)에서 대화할 수 있어요.");
  let failures = 0;
  while (!signal?.aborted) {
    try {
      const hello = { model: context.model, version, account: openai.account()?.email ?? null, models: context.models.slice(0, 40).map((m) => ({ slug: String(m.slug).slice(0, 80), name: String(m.name).slice(0, 80) })) };
      const response = await dalgrak.call("/api/helper/poll", hello, { timeoutMs: 40_000 });
      if (response.status === 404) throw Object.assign(new Error("이 달그락 대장간 서버는 아직 화면 안 대화(도우미)를 지원하지 않아요. 서버가 업데이트된 뒤 다시 켜주세요."), { code: "unsupported_server" });
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
        const message = toolsStillWork ? "이 달그락 대장간 서버는 아직 화면 안 대화(도우미)를 지원하지 않아요. 서버가 업데이트된 뒤 다시 켜주세요." : error.message;
        log(message); throw Object.assign(new Error(message), { code: toolsStillWork ? "unsupported_server" : "signed_out" });
      }
      failures++;
      await sleep(Math.min(30_000, 1000 * 2 ** Math.min(failures, 5)));
    }
  }
}
