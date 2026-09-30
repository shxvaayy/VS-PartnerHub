import { Capacitor } from "@capacitor/core";
import { clearPrivateDownloads } from "./downloads";

export async function initializeMobile() {
  if (Capacitor.isNativePlatform()) {
    void clearPrivateDownloads().catch(() => {});
    const refresh = () => window.dispatchEvent(new Event("partnerhub:resume"));
    // Capacitor forwards UIScene foreground changes through the document;
    // AppPlugin also covers application-level activation and Android resume.
    if (Capacitor.getPlatform() === "ios")
      document.addEventListener("resume", refresh);
    const { App } = await import("@capacitor/app");
    if (Capacitor.getPlatform() === "android")
      await App.addListener("backButton", ({ canGoBack }) => {
        if (canGoBack && window.history.length > 1) window.history.back();
        else void App.minimizeApp();
      });
    await App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) refresh();
    });
  } else if ("serviceWorker" in navigator && import.meta.env.PROD) {
    await navigator.serviceWorker.register("/sw.js");
  }
}
