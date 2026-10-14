import assert from "node:assert/strict";
import test from "node:test";
import { createRoomQueue } from "./room-queue.js";

test("same-room work is ordered, other rooms proceed, and failures release the queue", async () => {
  const queue = createRoomQueue();
  const seen: number[] = [];
  let release!: () => void;
  const first = queue.run("A", "test", async () => { seen.push(1); await new Promise<void>(resolve => { release = resolve; }); seen.push(2); });
  const failed = queue.run("A", "test", async () => { seen.push(3); throw new Error("expected"); });
  const rejection = assert.rejects(failed, /expected/);
  const last = queue.run("A", "test", async () => { seen.push(4); });
  await queue.run("B", "test", async () => { assert.deepEqual(seen, [1]); });
  release();
  await Promise.all([first, rejection, last]);
  await queue.drain();
  assert.deepEqual(seen, [1, 2, 3, 4]);
  assert.equal(queue.size, 0);
});
