/**
 * Generate the synthetic camera feeds the Playwright clickthroughs use.
 *
 *   e2e/fixtures/out/ball.y4m   a yellow ball on a parabola, 640x360, 30 fps, 6 s
 *   e2e/fixtures/out/blank.y4m  grey frames only, for the "object never seen" test
 *   e2e/fixtures/out/ball.webm  the same ball clip as VP9/WebM (the only encoder
 *                               Playwright's bundled ffmpeg has), for the
 *                               video-tracker clickthrough; skipped if ffmpeg is absent
 *
 * Geometry (pixels, screen y down):
 *   x = 80 + 80·t,   y = 300 − 240·t + 60·t²   for t in [0.5, 4.5), static before,
 *   held at the end afterwards. Ball diameter 36 px. If the test enters a
 *   diameter of 0.36 m, 1 px = 0.01 m, so vx = 0.8 m/s and ay = −1.2 m/s².
 *
 * Run with: node --experimental-strip-types e2e/fixtures/make-ball.ts
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const W = 640;
const H = 360;
const FPS = 30;
const SECONDS = 6;
const R = 18;
const OUT = path.resolve(import.meta.dirname, "out");

const GREY = [120, 120, 120] as const;
const YELLOW = [250, 200, 20] as const;

type Rgb = readonly [number, number, number];

/** BT.601 limited-range conversion, as y4m players expect. */
function yuv([r, g, b]: Rgb): [number, number, number] {
  const y = 16 + (65.738 * r + 129.057 * g + 25.064 * b) / 256;
  const u = 128 + (-37.945 * r - 74.494 * g + 112.439 * b) / 256;
  const v = 128 + (112.439 * r - 94.154 * g - 18.285 * b) / 256;
  return [Math.round(y), Math.round(u), Math.round(v)];
}

function ballAt(t: number): [number, number] {
  const tt = Math.min(Math.max(t - 0.5, 0), 4);
  return [80 + 80 * tt, 300 - 240 * tt + 60 * tt * tt];
}

function frame(cx: number | null, cy: number | null): Buffer {
  const yPlane = Buffer.alloc(W * H);
  const uPlane = Buffer.alloc((W / 2) * (H / 2));
  const vPlane = Buffer.alloc((W / 2) * (H / 2));
  const [gy, gu, gv] = yuv(GREY);
  const [by, bu, bv] = yuv(YELLOW);
  yPlane.fill(gy);
  uPlane.fill(gu);
  vPlane.fill(gv);
  if (cx !== null && cy !== null) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= R * R) {
          yPlane[y * W + x] = by;
          const ci = (y >> 1) * (W / 2) + (x >> 1);
          uPlane[ci] = bu;
          vPlane[ci] = bv;
        }
      }
    }
  }
  return Buffer.concat([Buffer.from("FRAME\n"), yPlane, uPlane, vPlane]);
}

function writeY4m(file: string, withBall: boolean) {
  const header = Buffer.from(`YUV4MPEG2 W${W} H${H} F${FPS}:1 Ip A1:1 C420jpeg\n`);
  const frames: Buffer[] = [header];
  for (let i = 0; i < FPS * SECONDS; i++) {
    const [cx, cy] = ballAt(i / FPS);
    frames.push(withBall ? frame(cx, cy) : frame(null, null));
  }
  writeFileSync(file, Buffer.concat(frames));
}

function findFfmpeg(): string | null {
  const cache = path.join(homedir(), "Library/Caches/ms-playwright");
  if (!existsSync(cache)) return null;
  const dirs = readdirSync(cache).filter((d) => d.startsWith("ffmpeg-")).sort();
  for (const d of dirs.reverse()) {
    const bins = readdirSync(path.join(cache, d)).filter((f) => f.startsWith("ffmpeg"));
    if (bins.length) return path.join(cache, d, bins[0]);
  }
  return null;
}

mkdirSync(OUT, { recursive: true });
writeY4m(path.join(OUT, "ball.y4m"), true);
writeY4m(path.join(OUT, "blank.y4m"), false);
console.log("wrote ball.y4m and blank.y4m");

const ffmpeg = findFfmpeg();
if (ffmpeg) {
  execFileSync(
    ffmpeg,
    [
      "-y",
      "-loglevel",
      "error",
      "-i",
      path.join(OUT, "ball.y4m"),
      "-c:v",
      "libvpx-vp9",
      "-b:v",
      "2M",
      "-pix_fmt",
      "yuv420p",
      path.join(OUT, "ball.webm"),
    ],
    { stdio: "inherit" },
  );
  console.log("wrote ball.webm");
} else {
  console.warn("Playwright ffmpeg not found; ball.webm skipped");
}
