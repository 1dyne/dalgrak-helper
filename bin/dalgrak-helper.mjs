#!/usr/bin/env node
import { readFileSync } from "node:fs";
import * as dalgrak from "../src/dalgrak.mjs";
import * as openai from "../src/openai-auth.mjs";
import { USAGE_URL } from "../src/agent.mjs";
import { ENGINES, engine, loadModels, serve, setEngine, setModel } from "../src/relay.mjs";
import { claudeAvailable } from "../src/claude-code.mjs";
import { APP_NAME, autostartFile, removeFile, shortcutFile, writeFile } from "../src/launchers.mjs";
import { INSTALL_HINT } from "../src/codex.mjs";
import { configDir, read as readSetting, storageKind, write as writeSetting } from "../src/store.mjs";
import { webReadOn } from "../src/claude-code.mjs";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const say = (text = "") => console.log(text);

const HELP = `${APP_NAME} ${version}
내 컴퓨터에서 돌면서, 내 ChatGPT 요금제로 달그락 대장간 대화를 이어줘요.

  dalgrak-helper                   연결이 없으면 로그인하고, 바로 시작해요
  dalgrak-helper status            지금 연결 상태를 보여줘요
  dalgrak-helper models            쓸 수 있는 모델을 보여줘요 (ChatGPT 요금제, Claude Code)
  dalgrak-helper web on|off        Claude가 찾은 웹 페이지를 직접 열어 읽게 할지 (기본: 꺼짐, 검색만)
  dalgrak-helper connect chatgpt   ChatGPT 요금제도 연결해요 (Claude Code만 쓰고 있을 때)
  dalgrak-helper model <이름>      쓸 모델을 정해요
  dalgrak-helper engine <responses|codex>
                                   답을 만드는 방식을 정해요. codex는 내 컴퓨터에서 코드·파일 작업을 해요
  dalgrak-helper install-shortcut  바탕화면에 두 번 눌러 켜는 바로가기를 만들어요
  dalgrak-helper autostart <on|off> 컴퓨터에 로그인할 때 함께 켜지게 하거나 꺼요
  dalgrak-helper logout            ChatGPT와 달그락 연결을 모두 끊어요

로그인 정보는 이 컴퓨터의 ${configDir()} 에만 저장돼요.`;

async function ensureLogins({ wantChatgpt = false } = {}) {
  if (!dalgrak.link()?.access_token) {
    say("1/2 달그락 대장간에 연결해요.");
    await dalgrak.login({ print: say });
    say("달그락 대장간에 연결됐어요.\n");
  }
  // Claude Code가 깔려 있으면 ChatGPT 없이도 쓸 수 있다. ChatGPT 연결은 따로 청했을 때만 한다.
  if (!openai.planEnabled() && !wantChatgpt && claudeAvailable()) {
    say("이 컴퓨터의 Claude Code로 답해요(내 Claude 구독). ChatGPT 요금제도 함께 쓰려면: dalgrak-helper connect chatgpt\n");
    return;
  }
  if (!openai.planEnabled()) {
    say("2/2 ChatGPT에 연결해요. 브라우저에서 'ChatGPT 요금제 사용'을 허용해주세요.");
    const saved = await openai.login({ print: say });
    if (!openai.planEnabled(saved)) throw new Error("ChatGPT 요금제 사용이 허용되지 않았어요. 다시 실행해 허용해주세요.");
    say(`ChatGPT에 연결됐어요${saved.email ? ` (${saved.email})` : ""}.`);
    say(`이제 달그락 대장간의 AI 요청은 내 ChatGPT 요금제를 써요. 사용량은 ${USAGE_URL} 에서 관리할 수 있어요.\n`);
  }
}

async function main() {
  const [command = "start", argument] = process.argv.slice(2);
  if (["help", "--help", "-h"].includes(command)) return say(HELP);
  if (command === "status") {
    const d = dalgrak.link(); const o = openai.account();
    say(`달그락 대장간: ${d?.access_token ? `연결됨 (${d.server})` : "연결 안 됨"}`);
    say(`답을 만드는 방식: ${engine()}`);
    say(`로그인 정보 보관: ${storageKind()}`);
    say(`찾은 웹 페이지 직접 열기: ${webReadOn() ? "켜짐" : "꺼짐 (검색만 해요. 켜려면 dalgrak-helper web on)"}`);
    say(`Claude Code: ${claudeAvailable() ? "이 컴퓨터에 있어요 (화면에서 Claude 모델을 고르면 내 Claude 구독으로 답해요)" : "없음"}`);
    say(`ChatGPT: ${openai.planEnabled(o) ? `연결됨${o.email ? ` (${o.email})` : ""} · 요금제 사용 허용` : "연결 안 됨"}`);
    return;
  }
  if (command === "engine") {
    if (!argument) return say(`지금 방식: ${engine()}\n바꾸려면: dalgrak-helper engine <${ENGINES.join("|")}>`);
    if (!ENGINES.includes(argument)) throw new Error(`쓸 수 있는 방식은 ${ENGINES.join(", ")} 예요.`);
    setEngine(argument);
    say(argument === "codex" ? `다음부터 Codex로 코드·파일 작업을 해요. 만든 파일은 내 컴퓨터의 Dalgrak 폴더에 남아요.\n${INSTALL_HINT.replace("Codex가 설치돼 있지 않아요. ", "Codex가 아직 없다면 ")}` : "다음부터 일반 방식(대화와 설계)으로 답해요.");
    return;
  }
  if (command === "install-shortcut") {
    const path = writeFile(shortcutFile());
    say(`바탕화면에 바로가기를 만들었어요: ${path}\n두 번 누르면 ${APP_NAME}이 켜져요.`);
    return;
  }
  if (command === "autostart") {
    if (argument !== "on" && argument !== "off") throw new Error("이렇게 써주세요: dalgrak-helper autostart on 또는 dalgrak-helper autostart off");
    const file = autostartFile({ logDir: configDir() });
    if (argument === "on") say(`컴퓨터에 로그인할 때 함께 켜지게 했어요: ${writeFile(file)}\n다음 로그인부터 적용돼요. 처음 한 번은 직접 켜서 로그인을 마쳐 주세요.`);
    else say(removeFile(file) ? "함께 켜지지 않게 했어요." : "함께 켜지게 해 둔 것이 없어요.");
    return;
  }
  if (command === "logout") {
    const { revoked } = await openai.logout();
    dalgrak.logout();
    say(revoked ? "연결을 모두 끊었어요." : `이 컴퓨터의 로그인 정보는 지웠지만, ChatGPT 쪽 해제는 확인하지 못했어요. ChatGPT 설정에서 '${openai.AGENT_NAME}' 연결을 끊어주세요.`);
    return;
  }
  if (command === "web") {
    if (argument !== "on" && argument !== "off") throw new Error("이렇게 써주세요: dalgrak-helper web on 또는 dalgrak-helper web off");
    writeSetting("settings.json", { ...(readSetting("settings.json") ?? {}), webRead: argument === "on" });
    return say(argument === "on" ? "이제 Claude가 검색에서 찾은 페이지를 직접 열어 읽을 수 있어요. 바깥 글에 속아 엉뚱한 일을 할 위험이 조금 늘어요. 끄려면: dalgrak-helper web off" : "이제 검색만 하고 페이지를 직접 열지는 않아요.");
  }
  if (command === "connect") {
    if (argument !== "chatgpt") throw new Error("이렇게 써주세요: dalgrak-helper connect chatgpt");
    await ensureLogins({ wantChatgpt: true });
    return say("ChatGPT가 연결돼 있어요.");
  }
  if (command === "models") {
    await ensureLogins();
    const { models, model: current } = await loadModels();
    for (const model of models) say(`${model.slug === current ? "●" : " "} ${model.slug}  ${model.name}`);
    return;
  }
  if (command === "model") {
    if (!argument) throw new Error("모델 이름을 적어주세요. 예: dalgrak-helper model <이름>");
    setModel(argument); say(`다음부터 ${argument} 모델을 써요.`);
    return;
  }
  if (command !== "start") { say(HELP); process.exitCode = 1; return; }
  await ensureLogins();
  const stop = new AbortController();
  process.on("SIGINT", () => { say("\n연결 앱을 꺼요. 다시 켜면 이어서 대화할 수 있어요."); stop.abort(); process.exit(0); });
  await serve({ version, log: (line) => say(`[${new Date().toLocaleTimeString()}] ${line}`), signal: stop.signal });
}

main().catch((error) => { console.error(error?.message ?? "알 수 없는 오류가 났어요."); process.exitCode = 1; });
