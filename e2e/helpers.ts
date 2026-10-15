import { expect, type Page } from "@playwright/test";

export const banner = (page: Page) => page.getByTestId("step-banner");

const CHART_ORDER = [
  "Displacement–time",
  "Velocity–time",
  "Speed–time",
  "Acceleration–time",
];

/** Text of the x-axis tick labels of the nth chart in the graphs section. */
export async function xTicks(page: Page, n: number): Promise<string[]> {
  return page
    .locator('[data-testid="graphs"] [data-chart]')
    .nth(n)
    .locator("[data-x-tick]")
    .allTextContents();
}

/**
 * The stacked analysis graphs: four kinematic charts in order (plus force and
 * energy when a mass was given), full width, with plot areas that line up
 * vertically and identical time-axis ticks.
 */
export async function expectStackedGraphs(page: Page, withDynamics = false) {
  const charts = page.locator('[data-testid="graphs"] [data-chart]');
  const expected = withDynamics
    ? [...CHART_ORDER, "Net force–time", "Energy stores–time"]
    : CHART_ORDER;
  await expect(charts).toHaveCount(expected.length);
  const titles = await page
    .locator('[data-testid="graphs"] [data-chart-title]')
    .allTextContents();
  expect(titles).toEqual(expected);

  // Left plot edges (the y axis line) share one x position across charts.
  const axes = page.locator('[data-testid="graphs"] [data-y-axis]');
  const first = await axes.nth(0).boundingBox();
  expect(first).not.toBeNull();
  for (let i = 1; i < expected.length; i++) {
    const b = await axes.nth(i).boundingBox();
    expect(b).not.toBeNull();
    expect(Math.abs(b!.x - first!.x)).toBeLessThan(1);
    expect(Math.abs(b!.width - first!.width)).toBeLessThan(1);
  }
  // Charts are stacked: each one starts below the previous.
  const boxes = [];
  for (let i = 0; i < expected.length; i++) boxes.push(await charts.nth(i).boundingBox());
  for (let i = 1; i < boxes.length; i++) {
    expect(boxes[i]!.y).toBeGreaterThan(boxes[i - 1]!.y + boxes[i - 1]!.height - 1);
    expect(Math.abs(boxes[i]!.x - boxes[0]!.x)).toBeLessThan(1);
  }
  // Same time axis on the first and last kinematic chart.
  expect(await xTicks(page, 3)).toEqual(await xTicks(page, 0));
}

/** Dispatch a trackpad-pinch wheel event (ctrlKey) at the centre of an element. */
export async function pinchWheel(page: Page, selector: string, deltaY: number) {
  await page.locator(selector).first().evaluate((el, dy) => {
    const r = el.getBoundingClientRect();
    el.dispatchEvent(
      new WheelEvent("wheel", {
        ctrlKey: true,
        deltaY: dy,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, deltaY);
}

/** Simulate a two-finger horizontal pinch with touch pointer events. */
export async function touchPinch(page: Page, selector: string, from: number, to: number) {
  await page.locator(selector).first().evaluate(
    (el, { from, to }) => {
      const r = el.getBoundingClientRect();
      const cy = r.top + r.height / 2;
      const cx = r.left + r.width / 2;
      const ev = (type: string, id: number, x: number) =>
        el.dispatchEvent(
          new PointerEvent(type, {
            pointerId: id,
            pointerType: "touch",
            isPrimary: id === 1,
            clientX: x,
            clientY: cy,
            bubbles: true,
          }),
        );
      ev("pointerdown", 1, cx - from / 2);
      ev("pointerdown", 2, cx + from / 2);
      ev("pointermove", 1, cx - to / 2);
      ev("pointermove", 2, cx + to / 2);
      ev("pointerup", 1, cx - to / 2);
      ev("pointerup", 2, cx + to / 2);
    },
    { from, to },
  );
}
