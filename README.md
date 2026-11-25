# 달그락 연결 앱 (dalgrak-helper)

내 컴퓨터에서 돌면서, **내 ChatGPT 요금제**로 [달그락 대장간](https://dalgrak.app)의 달그락들과 대화하게 해 주는 작은 오픈소스 앱이에요.

이 앱을 켜 두면 달그락 대장간 화면에서(휴대폰이든 다른 PC든) 바로 대화할 수 있어요. API 키는 필요 없어요.

## 켜는 법

### 1. Node.js 설치 (처음 한 번)

[nodejs.org](https://nodejs.org)에서 LTS 버전을 받아 설치해요.

### 2. 앱 켜기

**두 번 눌러서 켜기 (추천)**

1. 이 페이지 위쪽의 초록색 **Code → Download ZIP**으로 내려받아 압축을 풀어요.
2. `launch` 폴더에서 내 컴퓨터에 맞는 파일을 두 번 눌러요.
   - 맥: `달그락 연결 앱.command`
   - 윈도우: `달그락 연결 앱.bat`

맥에서 처음 누를 때 경고가 뜨면, 파일을 오른쪽 클릭 → **열기**를 한 번 해 주세요.

**터미널로 켜기**

맥은 "터미널", 윈도우는 "PowerShell"을 열고 아래를 붙여넣어요.

```bash
npx github:1dyne/dalgrak-helper
```

### 3. 로그인하고 켜 두기

1. 브라우저가 열리면 **달그락 대장간**에 로그인하고 연결을 허용해요.
2. 이어서 **ChatGPT**에 로그인하고 "ChatGPT 요금제 사용"을 허용해요.
3. 창에 "준비됐어요"가 뜨면 달그락 대장간 화면에서 대화를 시작해요.

창을 닫으면 대화가 멈춰요. 기록·설계·파일은 달그락 대장간에 그대로 남고, 다시 켜면 이어져요. 로그인은 한 번 하면 다시 묻지 않아요.

## 더 편하게

| 하고 싶은 것 | 명령 |
|---|---|
| 바탕화면에 바로가기 만들기 | `dalgrak-helper install-shortcut` |
| 컴퓨터를 켤 때 함께 켜기 | `dalgrak-helper autostart on` (끄려면 `off`) |
| 연결 상태 보기 | `dalgrak-helper status` |
| 쓸 수 있는 모델 보기 · 정하기 | `dalgrak-helper models` · `dalgrak-helper model <이름>` |
| 연결 모두 끊기 | `dalgrak-helper logout` |

`npx`로 켰다면 `dalgrak-helper` 자리에 `npx github:1dyne/dalgrak-helper`를 써요.

## 코드·파일 작업 맡기기 (Codex)

보통은 대화와 설계만 해요. 곡면 하우징이나 출력 파일처럼 **코드를 실제로 돌려야 하는 일**은 Codex에게 맡길 수 있어요.

```bash
npm i -g @openai/codex          # Codex 설치 (처음 한 번)
dalgrak-helper engine codex     # Codex로 바꾸기
dalgrak-helper engine responses # 원래대로
```

- Codex도 내 ChatGPT 요금제를 써요. 따로 로그인하지 않아요.
- 만든 파일은 내 컴퓨터의 `Dalgrak/<프로젝트 이름>/` 폴더(홈 폴더 아래)에 남아요.
- 답의 끝에 "만든 파일" 목록이 붙어요. 달그락(하드웨어·소프트웨어·기구설계·제품 디자인)의 대장간에서 한 작업이면, 글자로 된 작은 설계 파일(`.scad`, ASCII `.stl`, `.ino`, `.py`, `.md` 등 14,000자 이내, 영문 파일 이름)은 달그락 대장간에도 올라가요.
- Codex가 없거나 답하지 못하면 그 턴만 원래 방식으로 답해요.

**지금의 한계** (꼭 읽어 주세요)

- Codex로 할 때는 달그락 대장간의 설계 도구(회로 제출, 작업 카드 등)를 Codex가 직접 쓰지 못해요. 우리가 가진 OpenAI 문서에 그 연결 방법이 적혀 있지 않아서, 지어내지 않고 빼 두었어요. 설계 기록은 원래 방식(`engine responses`)에서 해 주세요.
- Codex가 명령 실행 허락을 물으면 이 앱은 대신 답하지 못하고 거절해요. 같은 이유예요.
- Codex 연결은 가짜 Codex로만 시험했어요. 실제 Codex와는 아직 맞춰 보지 못했어요. 안 되면 오류 문구를 알려 주세요.

## 무엇이 어디로 가나요

```
달그락 대장간 화면 (어느 기기든)
        │  내가 쓴 말 / 화면에 보일 답
달그락 대장간 서버 ── 대화 기록·설계·파일 보관, 설계 규칙 검사
        │  내가 쓴 말 / 도구 호출 / 답
달그락 연결 앱 (이 컴퓨터) ── ChatGPT 로그인 보관
        │  AI 요청 (내 ChatGPT 요금제)
api.openai.com
```

- **ChatGPT 로그인 정보는 이 컴퓨터 밖으로 나가지 않아요.** `~/.config/dalgrak-helper/`에 본인만 읽을 수 있게(0600) 저장되고, `auth.openai.com`과 `api.openai.com`으로만 보내요. Codex를 쓸 때는 이 컴퓨터에서 도는 Codex 프로세스에 넘겨요. 달그락 대장간 서버는 이 토큰을 받지 않아요.
- **ChatGPT의 대화나 메모리에는 접근하지 않아요.** 요청하는 권한은 이름·이메일·프로필과 "요금제로 AI 요청하기"뿐이에요.
- **달그락 대장간 서버가 받는 것**은 달그락 로그인, 설계를 기록하는 도구 호출, 화면에 보여줄 답, 그리고 Codex가 만든 파일 중 위 조건에 맞아 올린 것이에요.
- 이 컴퓨터로 들어오는 연결은 없어요. 앱이 밖으로 묻는 연결만 써서 공유기 설정이 필요 없어요(로그인할 때만 잠깐 `127.0.0.1`에서 결과를 받아요).

## 사용량

AI 요청은 내 ChatGPT 요금제 사용량에서 나가요. [ChatGPT 설정 → 사용량](https://chatgpt.com/settings/usage)에서 이 앱의 사용량을 보고 한도를 정하거나 연결을 끊을 수 있어요. ChatGPT Plus·Pro 요금제에서 쓸 수 있어요.

## 어떻게 동작하나요

- ChatGPT 연결은 OpenAI의 [Sign in with ChatGPT · ChatGPT plan usage](https://developers.openai.com/siwc/token-sharing-open-source) 공개 흐름을 따라요(PKCE, 클라이언트 시크릿 없음, `127.0.0.1` 콜백, ID 토큰 검증).
- 달그락 연결은 Claude 커넥터와 같은 OAuth와 같은 MCP 도구를 써요. 설계 규칙과 검사는 전부 달그락 서버의 도구 안에 있어요.
- 의존 패키지가 없어요. `src/`의 파일이 전부라 직접 읽어볼 수 있어요.

| 파일 | 하는 일 |
|---|---|
| `src/openai-auth.mjs` | ChatGPT 로그인, 토큰 갱신, 로그아웃 |
| `src/dalgrak.mjs` | 달그락 대장간 로그인과 도구 호출 |
| `src/agent.mjs` | 한 번의 대화 턴(모델 호출 ↔ 도구 호출), 사진 붙이기 |
| `src/codex.mjs` | Codex로 하는 턴, 작업 폴더, 만든 파일 올리기 |
| `src/relay.mjs` | 달그락 서버에서 말을 받아 답을 올려보내기, 방식 고르기 |
| `src/launchers.mjs` | 바탕화면 바로가기, 함께 켜기 |
| `src/loopback.mjs` · `src/store.mjs` | 로그인 결과 받기, 로컬 저장 |

## 개발

```bash
npm test                              # 실제 로그인 없이 도는 테스트 (OpenAI와 Codex 자리는 가짜)
DALGRAK_SERVER=http://localhost:3000 node bin/dalgrak-helper.mjs   # 로컬 서버에 붙이기
```

## 라이선스

MIT. 이 앱은 OpenAI나 ChatGPT의 공식 제품이 아니에요.
