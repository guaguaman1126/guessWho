import assert from "node:assert/strict";
import test from "node:test";
import { createRoomImageResolver } from "../apps/web/src/lib/room-images.js";

const state = (paths: string[], turn = 0) => ({ turn, cards: paths.map((imagePath, id) => ({ id, name: "card", imagePath })) });

test("warm room actions reuse URLs; replacing one image fetches only that image", async () => {
  const calls: string[] = [];
  const resolver = createRoomImageResolver(async path => { calls.push(path); return `url:${path}`; });
  await resolver.resolve(state(["a", "b"]));
  for (let i = 0; i < 20; i++) await resolver.resolve(state(["a", "b"], i));
  assert.deepEqual(calls, ["a", "b"]);
  await resolver.resolve(state(["a", "c"]));
  assert.deepEqual(calls, ["a", "b", "c"]);
  await resolver.resolve(state(["a", "b"]));
  assert.deepEqual(calls, ["a", "b", "c", "b"]); // removed paths were evicted
});

test("concurrent updates share requests and only the newest state is published", async () => {
  let finish!: (url: string) => void;
  let calls = 0;
  const resolver = createRoomImageResolver(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
  const older = resolver.resolve(state(["a"], 1));
  const newer = resolver.resolve(state(["a"], 2));
  await Promise.resolve();
  assert.equal(calls, 1);
  finish("url:a");
  assert.equal(await older, null);
  assert.equal((await newer)?.turn, 2);
});

test("a slow old image cannot overwrite a newer picture or survive room disposal", async () => {
  let finish!: (url: string) => void;
  const resolver = createRoomImageResolver(path => path === "old" ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(path));
  const old = resolver.resolve(state(["old"]));
  assert.equal((await resolver.resolve(state(["new"])))?.cards[0].imagePath, "new");
  finish("old");
  assert.equal(await old, null);
  const pending = resolver.resolve(state(["old"]));
  await Promise.resolve();
  resolver.dispose();
  finish("old");
  assert.equal(await pending, null);
  assert.equal(await resolver.resolve(state(["new"])), null);
});

test("failed URL requests retry on the next update; an empty slot makes no request", async () => {
  let calls = 0;
  const resolver = createRoomImageResolver(async () => { if (++calls === 1) throw new Error("offline"); return "url"; });
  assert.equal((await resolver.resolve(state(["a", ""])))?.cards[0].imagePath, "");
  assert.equal((await resolver.resolve(state(["a", ""])))?.cards[0].imagePath, "url");
  assert.equal(calls, 2);
});
