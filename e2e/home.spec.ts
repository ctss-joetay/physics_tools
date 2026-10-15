import { expect, test } from "@playwright/test";

test("home page lists both ready tools and links to them", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Physics Tools" })).toBeVisible();

  const kin = page.getByRole("link", { name: /Kinematics video tracker/ });
  const live = page.getByRole("link", { name: /Live motion tracker/ });
  await expect(kin).toBeVisible();
  await expect(live).toBeVisible();

  await live.click();
  await expect(page).toHaveURL(/\/live$/);
  await expect(page.getByRole("heading", { name: "Live motion tracker" })).toBeVisible();

  await page.goto("/");
  await kin.click();
  await expect(page).toHaveURL(/\/kinematics$/);
});
