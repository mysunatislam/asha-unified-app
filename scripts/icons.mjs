// Rasterize the repository-native SVG for PWA / iOS home-screen icons.
import { createRequire } from "node:module";
import fs from "node:fs/promises";
const require = createRequire(import.meta.url);
const {
  chromium,
} = require("C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const svg = await fs.readFile("app/icon.svg", "utf8");
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const p = await browser.newPage();
for (const size of [192, 512]) {
  await p.setViewportSize({ width: size, height: size });
  await p.setContent(
    `<style>body{margin:0;background:#236357}svg{display:block;width:100vw;height:100vh}</style>${svg}`,
  );
  await p.screenshot({ path: `icons/asha-${size}.png` });
}
await browser.close();
console.log("Asha installation icons generated.");
