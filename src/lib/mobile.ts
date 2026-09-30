import { Capacitor } from "@capacitor/core";
import { clearPrivateDownloads } from "./downloads";

export async function initializeMobile() {
  if (Capacitor.isNativePlatform()) {
    void clearPrivateDownloads().catch(() => {});
    const { App } = await import("@capacitor/app");
    await App.addListener("backButton", ({ canGoBack }) => {
      if (canGoBack && window.history.length > 1) window.history.back();
      else void App.minimizeApp();
    });
    await App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) window.dispatchEvent(new Event("partnerhub:resume"));
    });
  } else if ("serviceWorker" in navigator && import.meta.env.PROD) {
    await navigator.serviceWorker.register("/sw.js");
  }
}
