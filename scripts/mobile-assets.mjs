import { chromium } from "@playwright/test";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { brandPaths } from "../shared/brand.ts";

// Use the same VS mark as public/favicon.svg for every native asset.
const browser = await chromium.launch({
  ...(process.env.CI ? {} : { channel: "chrome" }),
});
const page = await browser.newPage();
const mark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="18" fill="#173e32"/><rect x="1" y="1" width="62" height="62" rx="17" fill="none" stroke="#d2efa1" stroke-opacity=".22"/><path d="${brandPaths.v}" fill="#d2efa1"/><path d="${brandPaths.s}" fill="#f7faf3"/></svg>`;
async function render(file, width, height, mode = "icon") {
  const size =
    mode === "splash"
      ? Math.round(Math.min(width, height) * 0.19)
      : mode === "adaptive"
        ? Math.round(width * 0.44)
        : mode === "pwa"
          ? width
          : Math.round(width * 0.76);
  await page.setViewportSize({ width, height });
  await page.setContent(
    `<html><body style="margin:0;width:100vw;height:100vh;display:flex;align-items:center;justify-content:center;background:${mode === "adaptive" ? "transparent" : "#173e32"}"><div style="width:${size}px;height:${size}px">${mark}</div></body></html>`,
  );
  await page.screenshot({ path: file, omitBackground: mode === "adaptive" });
}
try {
  await writeFile("public/favicon.svg", `${mark}\n`);
  for (const size of [192, 512])
    await render(`public/icons/partnerhub-${size}.png`, size, size, "pwa");
  await render(
    "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png",
    1024,
    1024,
  );
  const iosSplash = "ios/App/App/Assets.xcassets/Splash.imageset";
  for (const file of (await readdir(iosSplash)).filter((name) =>
    name.endsWith(".png"),
  ))
    await render(path.join(iosSplash, file), 2732, 2732, "splash");
  const res = "android/app/src/main/res";
  for (const directory of await readdir(res)) {
    if (!directory.startsWith("mipmap-") && !directory.startsWith("drawable"))
      continue;
    for (const file of (await readdir(path.join(res, directory))).filter(
      (name) => name.endsWith(".png"),
    )) {
      const target = path.join(res, directory, file),
        png = await readFile(target);
      await render(
        target,
        png.readUInt32BE(16),
        png.readUInt32BE(20),
        file === "splash.png"
          ? "splash"
          : file.includes("foreground")
            ? "adaptive"
            : "icon",
      );
    }
  }
  await writeFile(
    `${res}/values/ic_launcher_background.xml`,
    '<?xml version="1.0" encoding="utf-8"?><resources><color name="ic_launcher_background">#173e32</color></resources>\n',
  );
  console.log(
    "Branded iOS and Android launcher and launch-screen assets generated.",
  );
} finally {
  await browser.close();
}
