import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { open, seal, storageKey } from "./keychain.mjs";

// 로그인 정보는 운영체제의 보안 저장소에 둔 열쇠로 잠가 파일에 둔다(keychain.mjs).
// 보안 저장소를 쓸 수 없는 환경에서는 이 컴퓨터의 내 계정만 읽을 수 있는 파일(0600)로 둔다.
// 서버로 보내지 않고, 로그에도 찍지 않는다.
const SECRET_FILES = new Set(["dalgrak.json", "openai.json"]);
const KEY_BLOB = "storage-key.dpapi";
export const configDir = () => process.env.DALGRAK_HELPER_HOME || join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "dalgrak-helper");

function file(name) {
  const dir = configDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return join(dir, name);
}

function raw(name) {
  try { return readFileSync(file(name), "utf8"); } catch { return null; }
}
function rawWrite(name, text) {
  const path = file(name);
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, text, { mode: 0o600 });
  renameSync(temp, path);
  try { chmodSync(path, 0o600); } catch { /* Windows */ }
}
const keyring = () => storageKey({ readBlob: () => raw(KEY_BLOB), writeBlob: (blob) => rawWrite(KEY_BLOB, blob) });
/** 로그인 정보가 어디에 어떻게 있는지 (status에서 보여준다) */
export const storageKind = () => keyring()?.name ?? "이 컴퓨터의 내 계정만 읽을 수 있는 파일";

export function read(name) {
  const text = raw(name);
  if (text == null) return null;
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!SECRET_FILES.has(name)) return value;
  if (value?.enc === "v1") {
    const ring = keyring();
    if (!ring) return null; // 열쇠를 꺼낼 수 없으면 다시 로그인한다
    try { return JSON.parse(open(ring.key, value)); } catch { return null; }
  }
  // 예전에 잠그지 않고 둔 파일: 열쇠가 있으면 이번에 잠가 둔다.
  if (value && keyring()) { try { write(name, value); } catch { /* 다음에 다시 */ } }
  return value;
}

export function write(name, value) {
  const ring = SECRET_FILES.has(name) ? keyring() : null;
  rawWrite(name, JSON.stringify(ring ? seal(ring.key, JSON.stringify(value)) : value, null, 2));
}

export function remove(name) {
  try { rmSync(file(name)); } catch { /* 없으면 그만 */ }
}

// 이 컴퓨터(호스트)를 가리키는 이름표. 사람을 알아볼 수 있는 값이 아니고, 인증 수단도 아니다.
export function hostId() {
  const saved = read("host.json");
  if (saved?.ext_agent_host_id) return saved.ext_agent_host_id;
  const id = `urn:uuid:${randomUUID()}`;
  write("host.json", { ext_agent_host_id: id, createdAt: new Date().toISOString() });
  return id;
}
