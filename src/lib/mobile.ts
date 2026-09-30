import { Capacitor } from "@capacitor/core";

export async function initializeMobile() {
  if (Capacitor.isNativePlatform()) {
    const { App } = await import("@capacitor/app");
    await App.addListener("backButton", ({ canGoBack }) => {
      if (canGoBack && window.history.length > 1) window.history.back();
      else void App.minimizeApp();
    });
    await App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) window.dispatchEvent(new Event("focus"));
    });
  } else if ("serviceWorker" in navigator && import.meta.env.PROD) {
    await navigator.serviceWorker.register("/sw.js");
  }
}
