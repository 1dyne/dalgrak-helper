import { spawnSync } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// 로그인 정보를 잠그는 열쇠를 운영체제의 보안 저장소에 둔다.
//  - macOS: 키체인 (security 명령)
//  - Windows: DPAPI (내 윈도우 계정으로만 풀리는 보호. PowerShell로 부른다)
//  - Linux: Secret Service (secret-tool 명령. 없는 환경이 많다)
// 로그인 정보 파일은 이 열쇠로 암호화(AES-256-GCM)해 둔다. 그래서 같은 컴퓨터의 다른 프로그램이
// 파일을 읽어도 내용을 알 수 없다. 보안 저장소를 쓸 수 없는 환경에서는 예전처럼 나만 읽을 수 있는
// 파일(0600)로 두고, 그 사실을 status에서 알린다. 열쇠를 못 구해도 앱이 멈추지는 않는다.

const SERVICE = "dalgrak-helper";
const ACCOUNT = "storage-key";
const run = (command, args, input) => spawnSync(command, args, { input, encoding: "utf8", timeout: 20_000, windowsHide: true });

const PS = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"];
const PS_PROTECT = "Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,'CurrentUser'))";
const PS_UNPROTECT = "Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser'))";

/** 운영체제별로 열쇠를 꺼내고 넣는 방법. blob은 윈도우에서만 쓴다(보호된 열쇠를 파일로 둔다) */
export const providers = {
  darwin: {
    name: "macOS 키체인",
    get: () => { const r = run("security", ["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"]); return r.status === 0 ? r.stdout.trim() : null; },
    set: (hex) => run("security", ["add-generic-password", "-U", "-s", SERVICE, "-a", ACCOUNT, "-w", hex]).status === 0
  },
  linux: {
    name: "Secret Service",
    get: () => { const r = run("secret-tool", ["lookup", "service", SERVICE, "account", ACCOUNT]); return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null; },
    set: (hex) => run("secret-tool", ["store", "--label=Dalgrak Forge", "service", SERVICE, "account", ACCOUNT], hex).status === 0
  },
  win32: {
    name: "Windows 자격 보호(DPAPI)",
    get: (blob) => { if (!blob) return null; const r = run("powershell", [...PS, PS_UNPROTECT], blob); return r.status === 0 && r.stdout.trim() ? Buffer.from(r.stdout.trim(), "base64").toString("hex") : null; },
    set: (hex) => { const r = run("powershell", [...PS, PS_PROTECT], Buffer.from(hex, "hex").toString("base64")); return r.status === 0 && r.stdout.trim() ? { blob: r.stdout.trim() } : false; }
  }
};

let cached; // undefined = 아직 안 알아봄, null = 쓸 수 없음
/**
 * 저장용 열쇠(32바이트)를 돌려준다. 없으면 만들어 넣는다. 쓸 수 없는 환경이면 null.
 * @param {{ readBlob: () => string|null, writeBlob: (b: string) => void, provider?: object|null }} io
 */
export function storageKey(io, provider = process.env.DALGRAK_KEYCHAIN === "off" ? null : providers[process.platform] ?? null) {
  if (cached !== undefined) return cached;
  cached = null;
  if (!provider) return null;
  try {
    const found = provider.get(io.readBlob());
    if (found && /^[0-9a-f]{64}$/.test(found)) { cached = { key: Buffer.from(found, "hex"), name: provider.name }; return cached; }
    const hex = randomBytes(32).toString("hex");
    const saved = provider.set(hex);
    if (!saved) return null;
    if (saved.blob) io.writeBlob(saved.blob);
    // 넣은 것이 다시 꺼내지는지 확인하고 나서야 쓴다(못 꺼내면 로그인 정보를 잃는다).
    const again = provider.get(saved.blob ?? io.readBlob());
    if (again !== hex) return null;
    cached = { key: Buffer.from(hex, "hex"), name: provider.name };
  } catch { cached = null; }
  return cached;
}
export const resetKeychain = () => { cached = undefined; };

export function seal(key, text) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return { enc: "v1", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}
export function open(key, box) {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(box.iv, "base64"));
  decipher.setAuthTag(Buffer.from(box.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(box.data, "base64")), decipher.final()]).toString("utf8");
}
