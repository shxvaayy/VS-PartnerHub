import { Capacitor } from "@capacitor/core";
import { ApiError } from "./api";

const cacheDirectory = "partnerhub-exports";
const transfers = new Set<AbortController>();
let generation = 0;
let sharing = false;
let cleanup: Promise<void> = Promise.resolve();

export function downloadFilename(
  disposition: string | null,
  fallback = "PartnerHub-file",
) {
  const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  let name = disposition?.match(/filename="([^"]+)"/i)?.[1] || fallback;
  if (encoded) {
    try {
      name = decodeURIComponent(encoded);
    } catch {
      /* Use the safe fallback. */
    }
  }
  name = name
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "_")
    .trim()
    .replace(/^\.+/, "")
    .trim();
  if (!name) name = "PartnerHub-file";
  const extension = name.match(/\.[a-z0-9]{1,12}$/i)?.[0] || "";
  const encoder = new TextEncoder();
  if (encoder.encode(name).length <= 180) return name;
  let shortened = "";
  let bytes = extension.length;
  for (const character of name.slice(0, name.length - extension.length)) {
    const length = encoder.encode(character).length;
    if (bytes + length > 180) break;
    shortened += character;
    bytes += length;
  }
  return shortened + extension;
}

export function isFileDownload(url: URL) {
  return (
    url.origin === window.location.origin &&
    /^\/api\//.test(url.pathname) &&
    /\/(?:download|export|template|certificate|evidence)$/.test(url.pathname)
  );
}

export function clearPrivateDownloads() {
  generation++;
  for (const controller of transfers) controller.abort();
  if (
    !Capacitor.isNativePlatform() ||
    !Capacitor.isPluginAvailable("Filesystem")
  )
    return Promise.resolve();
  cleanup = cleanup
    .catch(() => {})
    .then(async () => {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      try {
        await Filesystem.rmdir({
          path: cacheDirectory,
          directory: Directory.Cache,
          recursive: true,
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : String((error as { message?: string })?.message || error);
        if (!/does not exist|not exist|no such file|not found/i.test(message))
          throw error;
      }
    });
  return cleanup;
}

function asBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(new Error("The file could not be prepared. Please try again."));
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
    reader.readAsDataURL(blob);
  });
}

/** Uses the current session; never sends credentials to an external download URL. */
export async function downloadFile(
  address: string,
  filename?: string,
): Promise<"browser" | "native" | "cancelled"> {
  const url = new URL(address, window.location.origin);
  if (
    url.origin !== window.location.origin ||
    !url.pathname.startsWith("/api/") ||
    url.username ||
    url.password
  )
    throw new Error(
      "This file must be downloaded from your PartnerHub workspace.",
    );
  const native = Capacitor.isNativePlatform();
  if (
    native &&
    (!Capacitor.isPluginAvailable("Filesystem") ||
      !Capacitor.isPluginAvailable("Share"))
  )
    throw new Error("Update the PartnerHub app to save files on this device.");
  if (native && sharing)
    throw new Error(
      "Finish the current file action before opening another file.",
    );
  const started = generation;
  const controller = new AbortController();
  const assertCurrent = () => {
    if (started !== generation || controller.signal.aborted)
      throw new DOMException(
        "The session changed before the download finished.",
        "AbortError",
      );
  };
  transfers.add(controller);
  if (native) sharing = true;
  let cachedPath: string | undefined;
  try {
    if (native) await cleanup;
    assertCurrent();
    const response = await fetch(url.href, {
      credentials: "include",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      if (response.status === 401)
        window.dispatchEvent(new Event("partnerhub:session-invalid"));
      throw new ApiError(
        error.error || "The file could not be downloaded. Please try again.",
        response.status,
      );
    }
    if (response.headers.get("content-type")?.includes("text/html"))
      throw new Error(
        "The server did not return a downloadable file. Please try again.",
      );
    const blob = await response.blob();
    const name = downloadFilename(
      response.headers.get("content-disposition"),
      filename,
    );
    assertCurrent();
    if (!native) {
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = name;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      return "browser";
    }
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import("@capacitor/filesystem"),
      import("@capacitor/share"),
    ]);
    const data = await asBase64(blob);
    assertCurrent();
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) =>
      value.toString(16).padStart(2, "0"),
    ).join("");
    cachedPath = `${cacheDirectory}/${id}/${name}`;
    const file = await Filesystem.writeFile({
      path: cachedPath,
      directory: Directory.Cache,
      data,
      recursive: true,
    });
    assertCurrent();
    try {
      await Share.share({
        title: name,
        files: [file.uri],
        dialogTitle: "Save or share file",
      });
    } catch (error) {
      if ((error as { message?: string })?.message === "Share canceled")
        return "cancelled";
      throw error;
    }
    return "native";
  } finally {
    transfers.delete(controller);
    if (native) sharing = false;
    if (cachedPath && started !== generation) {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      await Filesystem.deleteFile({
        path: cachedPath,
        directory: Directory.Cache,
      }).catch(() => {});
    }
  }
}
