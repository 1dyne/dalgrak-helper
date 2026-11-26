import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { open, resetKeychain, seal, storageKey } from "../src/keychain.mjs";

test("잠근 것은 같은 열쇠로만 풀리고, 손대면 풀리지 않는다", () => {
  const key = Buffer.alloc(32, 7);
  const box = seal(key, JSON.stringify({ access_token: "secret-token" }));
  assert.ok(!JSON.stringify(box).includes("secret-token"));
  assert.equal(JSON.parse(open(key, box)).access_token, "secret-token");
  assert.throws(() => open(Buffer.alloc(32, 8), box));
  assert.throws(() => open(key, { ...box, data: Buffer.from("x").toString("base64") }));
});

test("보안 저장소에 열쇠가 없으면 만들어 넣고, 다시 꺼내지는 것을 확인한 뒤에만 쓴다", () => {
  const io = { readBlob: () => null, writeBlob: () => {} };
  let stored = null;
  resetKeychain();
  const ring = storageKey(io, { name: "가짜 저장소", get: () => stored, set: (hex) => { stored = hex; return true; } });
  assert.equal(ring.name, "가짜 저장소"); assert.equal(ring.key.length, 32);
  // 넣었는데 다시 못 꺼내는 저장소는 쓰지 않는다(로그인 정보를 잃지 않게)
  resetKeychain();
  assert.equal(storageKey(io, { name: "고장", get: () => null, set: () => true }), null);
  resetKeychain();
  assert.equal(storageKey(io, null), null);
  resetKeychain();
});

test("로그인 정보 파일은 잠겨서 저장되고, 예전의 안 잠근 파일은 읽을 때 잠근다", async () => {
  const home = mkdtempSync(join(tmpdir(), "helper-store-"));
  process.env.DALGRAK_HELPER_HOME = home;
  const { storageKey: prime } = await import("../src/keychain.mjs");
  let stored = null;
  resetKeychain();
  prime({ readBlob: () => null, writeBlob: () => {} }, { name: "가짜 저장소", get: () => stored, set: (hex) => { stored = hex; return true; } });
  const store = await import("../src/store.mjs");
  store.write("openai.json", { access_token: "tok-abc", email: "x" });
  const onDisk = readFileSync(join(home, "openai.json"), "utf8");
  assert.ok(!onDisk.includes("tok-abc")); assert.ok(onDisk.includes('"enc": "v1"'));
  assert.equal(store.read("openai.json").access_token, "tok-abc");
  // 설정처럼 비밀이 아닌 파일은 그대로 둔다
  store.write("settings.json", { model: "m" });
  assert.ok(readFileSync(join(home, "settings.json"), "utf8").includes('"model"'));
  assert.equal(store.storageKind(), "가짜 저장소");
  resetKeychain();
});
