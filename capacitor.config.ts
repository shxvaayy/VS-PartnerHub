import type { CapacitorConfig } from "@capacitor/cli";

const configuredUrl = process.env.MOBILE_SERVER_URL;
if (!configuredUrl)
  throw new Error(
    "Set MOBILE_SERVER_URL to your deployed PartnerHub HTTPS origin before syncing the native applications. See docs/MOBILE.md.",
  );
const url = new URL(configuredUrl);
const development = process.env.MOBILE_DEV === "true";
if (
  url.protocol !== "https:" &&
  !(
    development &&
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "10.0.2.2"].includes(url.hostname)
  )
)
  throw new Error(
    "Native applications require an HTTPS workspace. HTTP is limited to explicit local simulator development.",
  );
if (
  url.username ||
  url.password ||
  url.search ||
  url.hash ||
  url.pathname !== "/"
)
  throw new Error(
    "Use the workspace origin without credentials, paths, query parameters or fragments.",
  );
const config: CapacitorConfig = {
  appId: "com.vijaysoftwaresolutions.partnerhub",
  appName: "VS PartnerHub",
  webDir: "dist",
  server: {
    url: `${url.origin}/app`,
    cleartext: development && url.protocol === "http:",
    allowNavigation: [url.hostname],
    errorPath: "offline.html",
  },
  android: { allowMixedContent: false },
  ios: { contentInset: "automatic", allowsLinkPreview: false },
};
export default config;
