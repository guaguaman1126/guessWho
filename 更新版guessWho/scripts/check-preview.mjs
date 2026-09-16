// 使用已安裝的 Playwright 執行人工驗收前的 UI 檢查，不加入應用程式依賴。
// node scripts/check-preview.mjs <playwright 套件絕對路徑>
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || "playwright");
await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const base = "http://localhost:3000";
const modal = () => page.getByRole("dialog");
async function tools() { await page.getByRole("button", { name: "展示工具", exact: true }).click(); }
async function scenario(value) { await tools(); await modal().getByRole("combobox").selectOption(value); }
async function loaded() { await page.locator('[data-testid="board"][aria-busy="false"]').waitFor(); }
async function close() { await modal().getByRole("button", { name: "關閉視窗", exact: true }).click(); }
async function geometry(label) {
  const box = await page.locator('[data-testid="board"]').boundingBox();
  assert(box && Math.abs(box.width - box.height) < 2, label + " square board");
  const layout = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight }));
  assert(layout.scrollWidth <= layout.width, label + " horizontal overflow");
  assert(layout.scrollHeight <= layout.height + 1, label + " vertical overflow");
  assert(box.y >= 0 && box.y + box.height <= layout.height, label + " board visible");
  for (const card of await page.locator("[data-card-id]").all()) {
    const rect = await card.boundingBox();
    assert(rect && rect.x >= box.x && rect.y >= box.y && rect.x + rect.width <= box.x + box.width + 1 && rect.y + rect.height <= box.y + box.height + 1, label + " card inside board");
  }
}
try {
  await page.goto(base);
  await page.getByRole("heading", { name: /你的線索/ }).waitFor();
  await page.screenshot({ path: "artifacts/home-desktop.png", fullPage: true });
  await page.getByRole("button", { name: /開一間遊戲房/ }).click();
  await modal().getByRole("button", { name: /25/ }).click();
  await modal().getByRole("button", { name: "創建展示房間 →" }).click();
  await loaded();
  assert.equal(await page.locator("[data-card-id]").count(), 25);
  assert.equal(await page.getByRole("button", { name: "我準備好了", exact: true }).count(), 0);
  assert(await page.getByRole("button", { name: "開始遊戲 →", exact: true }).isDisabled());
  await page.locator('[data-card-id="25"]').click();
  await modal().getByRole("button", { name: "設為秘密目標" }).click();
  await tools(); await modal().getByRole("button", { name: "模擬另一位玩家選好／準備" }).click();
  await page.getByRole("button", { name: "編輯卡組 ↗" }).click();
  await modal().getByRole("button", { name: "9 張", exact: true }).click();
  assert.equal(await page.locator("[data-card-id]").count(), 25, "selection must not apply immediately");
  await modal().getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await page.locator("[data-card-id]").count(), 25, "cancel keeps deck");
  await page.getByRole("button", { name: "編輯卡組 ↗" }).click();
  assert.equal(await modal().getByRole("button", { name: "25 張", exact: true }).getAttribute("aria-pressed"), "true");
  await modal().getByRole("button", { name: "9 張", exact: true }).click();
  await modal().getByRole("button", { name: "確認變更", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("[data-card-id]").length === 9);
  await page.locator("dialog[open]").waitFor({ state: "detached" });
  assert(await page.getByRole("button", { name: "開始遊戲 →", exact: true }).isDisabled());
  await page.locator('[data-card-id="1"]').click();
  await modal().getByRole("button", { name: "設為秘密目標" }).click();
  await page.getByRole("button", { name: "開始遊戲 →", exact: true }).click();
  await page.getByRole("button", { name: "已完成提問 ✓" }).waitFor();
  await page.locator('[data-card-id="2"]').click();
  await modal().getByRole("button", { name: "蓋牌", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-card-id="2"]')?.getAttribute('aria-label')?.includes('已蓋牌'));
  assert((await page.locator('[data-card-id="2"]').getAttribute("aria-label")).includes("已蓋牌"));
  await page.getByRole("button", { name: "已完成提問 ✓" }).click();
  await page.getByRole("button", { name: "結束回合 →" }).waitFor();
  await page.locator('[data-card-id="3"]').click();
  assert.equal(await modal().getByRole("button", { name: "指認這個人" }).count(), 0);
  await close();
  await page.getByRole("button", { name: "結束回合 →" }).click();
  await page.getByRole("button", { name: "對手的回合" }).waitFor();
  await scenario("paused");
  await page.getByRole("button", { name: "模擬重連，繼續遊戲" }).click();
  assert((await page.locator('[data-card-id="2"]').getAttribute("aria-label")).includes("已蓋牌"));
  await scenario("playing");
  await page.locator('[data-card-id="4"]').click();
  await modal().getByRole("button", { name: "指認這個人" }).click();
  await modal().getByRole("button", { name: "確定指認", exact: true }).click();
  await page.getByRole("button", { name: "對手的回合" }).waitFor();
  await scenario("playing");
  await page.locator('[data-card-id="3"]').click();
  await modal().getByRole("button", { name: "指認這個人" }).click();
  await modal().getByRole("button", { name: "確定指認", exact: true }).click();
  await modal().getByRole("button", { name: "回到大廳 →" }).click();
  assert(await page.getByRole("button", { name: "開始遊戲 →", exact: true }).isDisabled());
  await tools(); await modal().getByRole("button", { name: "來賓（B）" }).click();
  assert.equal(await page.getByRole("button", { name: "開始遊戲 →", exact: true }).count(), 0);
  await page.getByRole("button", { name: "我準備好了" }).waitFor();
  await page.locator('[data-card-id="1"]').click();
  assert.equal(await modal().getByRole("textbox", { name: "角色名稱", exact: true }).count(), 0);
  await modal().getByRole("button", { name: "設為秘密目標" }).click();
  await page.getByRole("button", { name: "我準備好了" }).click();
  await page.getByRole("button", { name: "取消準備" }).waitFor();
  await page.locator('[data-card-id="2"]').click();
  assert(await modal().getByRole("button", { name: "設為秘密目標" }).isDisabled());
  await close();
  console.log("PASS role, ready, resize, fold, question, wrong/right guess, reconnect, result flows");
  await page.goto(base + "/room/DEMO01?count=9"); await loaded();
  await page.locator('[data-card-id="1"]').click();
  await modal().getByRole("textbox", { name: "角色名稱", exact: true }).fill("新名字");
  await modal().getByRole("button", { name: "儲存", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-card-id="1"]')?.getAttribute("aria-label")?.includes("新名字"));
  await modal().getByLabel("替換圖片", { exact: true }).setInputFiles({ name: "bad.txt", mimeType: "text/plain", buffer: Buffer.from("not an image") });
  await modal().getByRole("alert").filter({ hasText: "5 MB" }).waitFor();
  const upload = await page.screenshot();
  await modal().getByLabel("替換圖片", { exact: true }).setInputFiles({ name: "preview.png", mimeType: "image/png", buffer: upload });
  await modal().getByRole("button", { name: "套用圖片", exact: true }).waitFor();
  await modal().getByLabel("縮放", { exact: true }).fill("1.5");
  const cropImage = modal().locator(".reactEasyCrop_Image");
  const cropBox = await modal().getByTestId("crop-area").boundingBox();
  await page.waitForFunction(() => document.querySelector(".reactEasyCrop_Image")?.getAttribute("style")?.includes("scale(1.5)"));
  const transformBefore = await cropImage.getAttribute("style");
  await page.mouse.move(cropBox.x + cropBox.width / 2, cropBox.y + cropBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(cropBox.x + cropBox.width / 2 + 30, cropBox.y + cropBox.height / 2 + 20, { steps: 8 });
  await page.mouse.up();
  assert.notEqual(await cropImage.getAttribute("style"), transformBefore, "drag changes crop");
  await modal().getByRole("button", { name: "套用圖片", exact: true }).click();
  await modal().getByRole("button", { name: "設為秘密目標" }).waitFor();
  assert((await page.locator('[data-card-id="1"] img').getAttribute("src")).startsWith("data:image/jpeg"));
  await close();
  await scenario("playing"); await scenario("error");
  await page.locator('[data-card-id="2"]').click();
  await modal().getByRole("button", { name: "蓋牌", exact: true }).click();
  await modal().getByRole("alert").waitFor();
  assert(!(await page.locator('[data-card-id="2"]').getAttribute("aria-label")).includes("已蓋牌"));
  await modal().getByRole("button", { name: "蓋牌", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-card-id="2"]')?.getAttribute("aria-label")?.includes("已蓋牌"));
  await page.goto(base);
  await page.getByRole("button", { name: /加入朋友的房間/ }).click();
  await modal().getByRole("textbox", { name: "房間號碼" }).fill("KEEP01");
  await modal().getByRole("button", { name: "加入展示房間 →" }).click();
  await modal().getByLabel("房間通關密碼").fill("wrong");
  await modal().getByRole("button", { name: "驗證密碼並加入 →" }).click();
  await modal().getByRole("alert").waitFor();
  await modal().getByLabel("房間通關密碼").fill("1234");
  await modal().getByRole("button", { name: "驗證密碼並加入 →" }).click();
  await loaded();
  assert(!page.url().includes("1234"));
  console.log("PASS rename, upload rejection, JPEG crop, failed-action retry, password room form");
  for (const [width, height] of [[320,568],[390,844],[768,1024],[1024,768],[1440,900]]) {
    await page.setViewportSize({ width, height });
    for (const count of [9,16,25]) {
      await page.goto(base + "/room/DEMO01?count=" + count); await loaded();
      await geometry(`${width}x${height} / ${count} lobby`);
      await scenario("playing");
      await geometry(`${width}x${height} / ${count} playing`);
      if (count === 25) {
        await page.screenshot({ path: `artifacts/board-${width}x${height}.png` });
        await page.locator('[data-card-id="1"]').click();
        const image = await modal().locator(".card-image").boundingBox();
        assert(image && Math.abs(image.width - image.height) < 1, "square enlarged portrait");
        await modal().getByRole("button", { name: "蓋牌", exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: `artifacts/modal-${width}x${height}.png` });
        await page.keyboard.press("Escape");
        assert.equal(await page.locator("dialog[open]").count(), 0);
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-card-id")), "1");
      }
    }
  }
  assert.deepEqual(errors, []);
  console.log("PASS 30 viewport/state combinations; modal sizing, Escape/focus restoration; no page errors");
} finally { await browser.close(); }
