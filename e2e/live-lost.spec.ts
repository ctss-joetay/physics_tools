import path from "node:path";
import { expect, test } from "@playwright/test";
import { banner } from "./helpers";

const blank = path.resolve(__dirname, "fixtures/out/blank.y4m");

test.use({
  launchOptions: {
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-video-capture=${blank}`,
    ],
  },
});

test("when nothing yellow is in view, the student is told to find the object and cannot start", async ({
  page,
}) => {
  await page.goto("/live");
  await page.getByTestId("primary-action").click();
  await expect(banner(page)).toContainText("Find the object", { timeout: 15_000 });
  await expect(page.getByTestId("track-ring")).toHaveCount(0);
  await expect(page.getByTestId("lost-badge")).toBeVisible();
  await expect(page.getByTestId("primary-action")).toBeDisabled();
});
