import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

// Capacitor opens errorPath on its bundled origin. A relative /app link would
// load that origin's static bundle, where there is no authenticated backend.
// Rewrite only the native copy; the web/PWA fallback keeps its same-origin link.
const platform = process.env.CAPACITOR_PLATFORM_NAME;
if (platform !== "web") {
  assert(
    ["android", "ios"].includes(platform),
    "Run this through Capacitor copy or sync.",
  );
  const root = path.resolve(process.env.CAPACITOR_ROOT_DIR || ".");
  const assets = path.join(
    root,
    platform === "android" ? "android/app/src/main/assets" : "ios/App/App",
  );
  const config = JSON.parse(
    await fs.readFile(path.join(assets, "capacitor.config.json"), "utf8"),
  );
  const workspace = new URL(config.server.url);
  const localDevelopment =
    process.env.MOBILE_DEV === "true" &&
    workspace.protocol === "http:" &&
    ["localhost", "127.0.0.1", "10.0.2.2"].includes(workspace.hostname);
  assert(
    workspace.protocol === "https:" || localDevelopment,
    "Native reconnect requires HTTPS, except explicit local simulator development.",
  );
  assert(
    !workspace.username &&
      !workspace.password &&
      !workspace.search &&
      !workspace.hash &&
      workspace.pathname === "/app",
    "The generated native workspace URL must use /app without credentials or parameters.",
  );
  assert.equal(config.server.errorPath, "offline.html");
  const filename = path.join(assets, "public/offline.html");
  const html = await fs.readFile(filename, "utf8");
  const link = /(<a\s+data-workspace-link\s+href=")[^"]*(")/g;
  const logo = /(<img\s+data-workspace-logo\s+src=")[^"]*(")/g;
  assert.equal(
    [...html.matchAll(link)].length,
    1,
    "The bundled offline page must contain one marked reconnect link; rebuild the web app before sync.",
  );
  assert.equal(
    [...html.matchAll(logo)].length,
    1,
    "The offline page must contain one marked brand image; rebuild before sync.",
  );
  const logoBytes = await fs.readFile(
    path.join(assets, "public/icons/partnerhub-192.png"),
  );
  const escapedUrl = workspace.href.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
  await fs.writeFile(
    filename,
    html
      .replace(
        logo,
        (_match, before, after) =>
          `${before}data:image/png;base64,${logoBytes.toString("base64")}${after}`,
      )
      .replace(
        link,
        (_match, before, after) => `${before}${escapedUrl}${after}`,
      ),
  );
  console.log(
    `Prepared ${platform} offline reconnect for the configured workspace.`,
  );
}
