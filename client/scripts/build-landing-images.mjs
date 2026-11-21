/**
 * Generate the landing-page imagery with the Gemini image API and export it
 * as optimised .webp under client/public/landing/.
 *
 *   node client/scripts/build-landing-images.mjs            # generate + export
 *   node client/scripts/build-landing-images.mjs --export   # re-export cached PNGs only
 *
 * GEMINI_API_KEY comes from the environment or server/.env (never committed).
 * Raw PNGs are cached in .tmp/landing-images/ (gitignored); only the exported
 * .webp files are committed. Export uses Playwright's Chromium (a root
 * devDependency) to cover-crop, resize and encode, stepping quality down until
 * each file is ≤ 200 KB.
 */
import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = path.resolve(clientDir, "..");
const cacheDir = path.join(rootDir, ".tmp", "landing-images");
const outDir = path.join(clientDir, "public", "landing");
const MAX_BYTES = 200 * 1024;
const MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";

const STYLE =
  "Soft editorial illustration with a gentle gouache and paper-grain texture, calm and unhurried. " +
  "Restricted palette: deep forest green (#1b4332), mid green (#2d6a4f), warm stone (#f4f1ea), cream (#fffcf7), " +
  "warm grey, with a small touch of terracotta (#bc6c25) only in the light. Golden-hour sunlight, long soft shadows. " +
  "An Indian university campus. Absolutely no text, letters, numbers, signage words, logos or watermarks anywhere.";

export const IMAGES = [
  {
    name: "hero",
    aspect: "16:9",
    width: 1600,
    height: 900,
    // Phones get a half-size copy through srcset.
    variants: [{ suffix: "-800", width: 800, height: 450 }],
    prompt:
      "A wide, calm view inside a campus mess hall at golden hour: a long wooden service counter on the right with " +
      "a warm serving window, tall windows letting in low sun, a few students relaxed at tables looking at phones, " +
      "nobody standing in a line, open sunlit floor in the foreground. The whole frame is one continuous painted interior: " +
      "the left side is a softly lit plain stone wall and floor with little detail, no panels, borders or blocks of flat colour. " +
      STYLE,
  },
  {
    name: "step-scan",
    aspect: "4:3",
    width: 800,
    height: 600,
    prompt:
      "Over-the-shoulder view from just behind a student: they hold a smartphone up toward a simple poster with a " +
      "large square QR-style code pinned on a stone-coloured campus notice board. The phone's SCREEN faces the viewer " +
      "and shows the poster's square code inside a camera viewfinder frame; the back of the phone, with its camera, " +
      "points at the poster. We see the back of the student's head and shoulder, not their face. Soft light, shallow depth. " +
      STYLE,
  },
  {
    name: "step-watch",
    aspect: "4:3",
    width: 800,
    height: 600,
    prompt:
      "A student sitting at ease under a large shady tree on a campus lawn, glancing at their phone, a book and a " +
      "cup of chai beside them, a red-brick and stone campus building far in the background. " +
      STYLE,
  },
  {
    name: "step-walk",
    aspect: "4:3",
    width: 800,
    height: 600,
    prompt:
      "A student walking briskly and happily along a covered stone corridor towards a warmly lit service counter " +
      "at the end, a staff member waiting there with a welcoming gesture, nobody else queuing. " +
      STYLE,
  },
];

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function apiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
  const env = await readFile(path.join(rootDir, "server", ".env"), "utf8").catch(() => "");
  const line = env.split(/\r?\n/).find((l) => l.startsWith("GEMINI_API_KEY="));
  const key = line?.slice("GEMINI_API_KEY=".length).trim().replace(/^["']|["']$/g, "");
  if (!key) throw new Error("GEMINI_API_KEY is not set (env or server/.env)");
  return key;
}

async function generate(image, key) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: image.prompt }] }],
        generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: image.aspect } },
      }),
    }
  );
  if (!res.ok) throw new Error(`${image.name}: Gemini ${res.status} ${await res.text()}`);
  const body = await res.json();
  const part = body.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part) throw new Error(`${image.name}: no image in response`);
  return Buffer.from(part.inlineData.data, "base64");
}

async function exportWebp(page, image, png) {
  const src = `data:image/png;base64,${png.toString("base64")}`;
  for (const quality of [0.82, 0.76, 0.7, 0.64, 0.58, 0.5]) {
    const dataUrl = await page.evaluate(
      async ({ src, width, height, quality }) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingQuality = "high";
        const scale = Math.max(width / img.naturalWidth, height / img.naturalHeight);
        const w = img.naturalWidth * scale;
        const h = img.naturalHeight * scale;
        ctx.drawImage(img, (width - w) / 2, (height - h) / 2, w, h);
        return canvas.toDataURL("image/webp", quality);
      },
      { src, width: image.width, height: image.height, quality }
    );
    const buf = Buffer.from(dataUrl.split(",")[1], "base64");
    if (buf.length <= MAX_BYTES) return { buf, quality };
  }
  throw new Error(`${image.name}: could not get under ${MAX_BYTES} bytes`);
}

async function main() {
  const exportOnly = process.argv.includes("--export");
  await mkdir(cacheDir, { recursive: true });
  await mkdir(outDir, { recursive: true });
  const key = exportOnly ? null : await apiKey();

  for (const image of IMAGES) {
    const cached = path.join(cacheDir, `${image.name}.png`);
    if (!exportOnly && !(await exists(cached))) {
      console.log(`generating ${image.name} with ${MODEL}…`);
      await writeFile(cached, await generate(image, key));
    }
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const image of IMAGES) {
    const png = await readFile(path.join(cacheDir, `${image.name}.png`));
    for (const size of [{ suffix: "", width: image.width, height: image.height }, ...(image.variants || [])]) {
      const file = `${image.name}${size.suffix}.webp`;
      const { buf, quality } = await exportWebp(page, { ...image, ...size }, png);
      await writeFile(path.join(outDir, file), buf);
      console.log(`${file} ${size.width}x${size.height} q${quality} ${(buf.length / 1024).toFixed(0)} KB`);
    }
  }
  await browser.close();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
