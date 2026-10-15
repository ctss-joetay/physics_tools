import { existsSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { banner, expectStackedGraphs } from "./helpers";

const clip = path.resolve(__dirname, "fixtures/out/ball.webm");

test("a student tracks the fake ball in a recorded clip, following the banner", async ({ page }) => {
  test.skip(!existsSync(clip), "run `npm run e2e:fixtures` first to build ball.webm");
  await page.goto("/kinematics");
  await expect(banner(page)).toContainText("Start");
  await expect(banner(page)).toContainText("Record a clip");

  // "Choose a video" is the second, un-captured file input.
  await page.locator('input[type="file"]').nth(1).setInputFiles(clip);

  await expect(banner(page)).toContainText("Setting up");
  await expect(banner(page)).toContainText("Tap one end", { timeout: 20_000 });

  const surface = page.locator("[data-tap-surface]");
  await expect(surface).toBeVisible();
  // Wait until the first frame is decoded and marks can be placed.
  await expect(page.getByText(/Loading video/)).toHaveCount(0, { timeout: 20_000 });
  const box = (await surface.boundingBox())!;
  // Video is 640x360; the ball sits at (80, 300) with radius 18 for the first 0.5 s.
  const px = (x: number) => box.x + (x / 640) * box.width;
  const py = (y: number) => box.y + (y / 360) * box.height;

  await page.mouse.click(px(62), py(300)); // left edge of the ball
  await expect(banner(page)).toContainText("other end");
  await page.mouse.click(px(98), py(300)); // right edge
  await expect(banner(page)).toContainText("origin");
  await page.mouse.click(px(80), py(300));
  await expect(banner(page)).toContainText("Tracking");

  await page.getByLabel(/Known length/).fill("0.36");

  // Ten tracked taps; the video advances a frame after each.
  for (let i = 0; i < 10; i++) {
    await page.mouse.click(px(80), py(300));
    await page.waitForTimeout(150);
  }

  await expectStackedGraphs(page);
  await expect(page.locator('[data-testid="data-table"] tbody tr')).toHaveCount(10);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  expect((await download).suggestedFilename()).toBe("kinematics-data.csv");
});
