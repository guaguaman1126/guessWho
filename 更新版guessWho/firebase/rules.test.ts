import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after, before } from "node:test";
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { ref, uploadBytes } from "firebase/storage";

let environment: RulesTestEnvironment;

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: "demo-guesswho",
    firestore: { rules: await readFile(new URL("./firestore.rules", import.meta.url), "utf8") },
    storage: { rules: await readFile(new URL("./storage.rules", import.meta.url), "utf8") },
  });
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "rooms/ABC123"), { hostUid: "host", playerUids: ["host", "guest"], status: "lobby" });
  });
});

after(async () => environment.cleanup());

test("Web Client 不能直接讀寫 Firestore", async () => {
  const firestore = environment.authenticatedContext("host").firestore();
  await assertFails(getDoc(doc(firestore, "rooms/ABC123")));
  await assertFails(setDoc(doc(firestore, "rooms/ABC123"), { status: "playing" }));
});

test("Storage 只允許大廳房主上傳合格 JPEG", async () => {
  const bytes = new Uint8Array([255, 216, 255, 217]);
  await assertSucceeds(uploadBytes(ref(environment.authenticatedContext("host").storage(), "rooms/ABC123/cards/1/test.jpg"), bytes, { contentType: "image/jpeg" }));
  await assertFails(uploadBytes(ref(environment.authenticatedContext("guest").storage(), "rooms/ABC123/cards/1/guest.jpg"), bytes, { contentType: "image/jpeg" }));
  await assertFails(uploadBytes(ref(environment.unauthenticatedContext().storage(), "rooms/ABC123/cards/1/anon.jpg"), bytes, { contentType: "image/jpeg" }));
  await assertFails(uploadBytes(ref(environment.authenticatedContext("host").storage(), "rooms/ABC123/cards/1/not-image.jpg"), bytes, { contentType: "text/plain" }));
  assert.ok(true);
});
