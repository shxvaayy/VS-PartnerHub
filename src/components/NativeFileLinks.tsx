import { useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { downloadFile, isFileDownload } from "../lib/downloads";
import { useToast } from "./ui";

/** Keep ordinary document/export links usable inside the native WebView. */
export default function NativeFileLinks() {
  const toast = useToast();
  const notify = useRef(toast);
  notify.current = toast;
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const open = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.(
        "a[href]",
      ) as HTMLAnchorElement | null;
      if (
        !anchor ||
        event.defaultPrevented ||
        !isFileDownload(new URL(anchor.href))
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      anchor.setAttribute("aria-busy", "true");
      notify.current("Preparing your file…");
      void downloadFile(anchor.href)
        .catch((error: unknown) => {
          if ((error as { name?: string })?.name !== "AbortError")
            notify.current(
              error instanceof Error
                ? error.message
                : "The file could not be opened. Please try again.",
              "error",
            );
        })
        .finally(() => anchor.removeAttribute("aria-busy"));
    };
    document.addEventListener("click", open, true);
    return () => document.removeEventListener("click", open, true);
  }, []);
  return null;
}
