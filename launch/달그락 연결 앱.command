#!/bin/bash
# 달그락 연결 앱 (macOS): 이 파일을 두 번 누르면 켜져요. 창을 닫으면 꺼져요.
cd "$(dirname "$0")" || exit 1

wait_key() { echo; read -n 1 -s -r -p "$1"; echo; }

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js가 없어요. 열리는 페이지에서 LTS 버전을 설치한 뒤 이 파일을 다시 눌러주세요."
  open "https://nodejs.org" 2>/dev/null
  wait_key "아무 키나 누르면 창이 닫혀요."
  exit 1
fi

major=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null)
if [ -z "$major" ] || [ "$major" -lt 20 ]; then
  echo "Node.js가 오래됐어요(지금 $(node -v)). 열리는 페이지에서 LTS 버전을 설치한 뒤 다시 눌러주세요."
  open "https://nodejs.org" 2>/dev/null
  wait_key "아무 키나 누르면 창이 닫혀요."
  exit 1
fi

node ../bin/dalgrak-helper.mjs
code=$?
if [ $code -ne 0 ]; then
  wait_key "문제가 생겨 멈췄어요. 위 글을 확인한 뒤 아무 키나 누르면 창이 닫혀요."
fi
exit $code
