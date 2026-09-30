import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  enabled: false,
  available: true,
  writeFile: vi.fn(),
  rmdir: vi.fn(),
  deleteFile: vi.fn(),
  share: vi.fn(),
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => native.enabled,
    isPluginAvailable: () => native.available,
  },
}));
vi.mock("@capacitor/filesystem", () => ({
  Filesystem: native,
  Directory: { Cache: "CACHE" },
}));
vi.mock("@capacitor/share", () => ({ Share: { share: native.share } }));
import {
  clearPrivateDownloads,
  downloadFile,
  downloadFilename,
} from "../src/lib/downloads";

const binary = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0, 0xff, 0x80]);
const response = () =>
  new Response(binary, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="PartnerHub-report.pdf"',
    },
  });
const request = vi.fn();
const dispatched = vi.fn();
const anchor = { href: "", download: "", click: vi.fn() };

beforeEach(() => {
  native.enabled = false;
  native.available = true;
  native.rmdir.mockResolvedValue(undefined);
  native.deleteFile.mockResolvedValue(undefined);
  native.writeFile.mockResolvedValue({
    uri: "file:///private/cache/PartnerHub-report.pdf",
  });
  native.share.mockResolvedValue({ activityType: "test.file-handler" });
  request.mockImplementation(async () => response());
  vi.stubGlobal("fetch", request);
  vi.stubGlobal("window", {
    location: { origin: "https://partnerhub.example" },
    dispatchEvent: dispatched,
  });
  vi.stubGlobal("document", { createElement: () => anchor });
  vi.stubGlobal(
    "FileReader",
    class {
      result = "";
      onload = () => {};
      onerror = () => {};
      readAsDataURL(blob: Blob) {
        void blob
          .arrayBuffer()
          .then((buffer) => {
            this.result =
              "data:application/pdf;base64," +
              Buffer.from(buffer).toString("base64");
            this.onload();
          })
          .catch(() => this.onerror());
      }
    },
  );
});
afterEach(async () => {
  await clearPrivateDownloads();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Authenticated browser and native downloads", () => {
  it("keeps browser download bytes and filename, then releases the object URL", async () => {
    vi.useFakeTimers();
    const create = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:download");
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    expect(await downloadFile("/api/documents/test/download")).toBe("browser");
    expect(anchor.download).toBe("PartnerHub-report.pdf");
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(new Uint8Array(await create.mock.calls[0][0].arrayBuffer())).toEqual(
      binary,
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(revoke).toHaveBeenCalledWith("blob:download");
    expect(native.writeFile).not.toHaveBeenCalled();
  });
  it("keeps credentials on the workspace origin and refuses redirected or non-file responses", async () => {
    await expect(
      downloadFile("https://other.example/api/documents/test/download"),
    ).rejects.toThrow("workspace");
    await expect(downloadFile("/api/../private-file")).rejects.toThrow(
      "workspace",
    );
    expect(request).not.toHaveBeenCalled();
    request.mockResolvedValueOnce(
      new Response("<html>Login</html>", {
        headers: { "Content-Type": "text/html" },
      }),
    );
    await expect(downloadFile("/api/documents/test/download")).rejects.toThrow(
      "downloadable file",
    );
    expect(request.mock.calls[0][1]).toMatchObject({
      credentials: "include",
      redirect: "error",
    });
  });
  it("decodes international filenames while preventing cache path traversal", () => {
    expect(
      downloadFilename(
        "attachment; filename*=UTF-8''Rate%20card%20%E2%82%AC.pdf",
      ),
    ).toBe("Rate card €.pdf");
    expect(
      downloadFilename('attachment; filename="../../private\\file.pdf"'),
    ).not.toMatch(/[\\/]/);
    expect(downloadFilename('attachment; filename=".."')).toBe(
      "PartnerHub-file",
    );
    expect(downloadFilename(null, "a".repeat(300) + ".pdf")).toMatch(
      /^a{176}\.pdf$/,
    );
  });
  it("saves identical bytes to private native cache and invokes the operating system file sheet", async () => {
    native.enabled = true;
    expect(await downloadFile("/api/documents/test/download")).toBe("native");
    expect(native.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({
        directory: "CACHE",
        recursive: true,
        data: Buffer.from(binary).toString("base64"),
        path: expect.stringMatching(
          /^partnerhub-exports\/[a-f0-9]{32}\/PartnerHub-report\.pdf$/,
        ),
      }),
    );
    expect(native.share).toHaveBeenCalledWith(
      expect.objectContaining({
        files: ["file:///private/cache/PartnerHub-report.pdf"],
      }),
    );
    await clearPrivateDownloads();
    expect(native.rmdir).toHaveBeenCalledWith({
      path: "partnerhub-exports",
      directory: "CACHE",
      recursive: true,
    });
  });
  it("handles a dismissed file sheet without claiming the file was shared", async () => {
    native.enabled = true;
    native.share.mockRejectedValueOnce(new Error("Share canceled"));
    expect(await downloadFile("/api/documents/test/download")).toBe(
      "cancelled",
    );
    expect(await downloadFile("/api/documents/test/download")).toBe("native");
  });
  it("does not save or share a file returned after the session changes", async () => {
    native.enabled = true;
    let finish!: (response: Response) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const transfer = downloadFile("/api/documents/test/download");
    const rejected = expect(transfer).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    await clearPrivateDownloads();
    finish(response());
    await rejected;
    expect(native.writeFile).not.toHaveBeenCalled();
    expect(native.share).not.toHaveBeenCalled();
  });
  it("removes a late native file write when logout happens during cache creation", async () => {
    native.enabled = true;
    let finish!: (value: { uri: string }) => void;
    native.writeFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const transfer = downloadFile("/api/documents/test/download");
    const rejected = expect(transfer).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.waitFor(() => expect(native.writeFile).toHaveBeenCalledOnce());
    await clearPrivateDownloads();
    finish({ uri: "file:///private/cache/late.pdf" });
    await rejected;
    expect(native.share).not.toHaveBeenCalled();
    expect(native.deleteFile).toHaveBeenCalledWith(
      expect.objectContaining({ directory: "CACHE" }),
    );
  });
  it("requires an available native file handler and preserves authorization errors", async () => {
    native.enabled = true;
    native.available = false;
    await expect(downloadFile("/api/documents/test/download")).rejects.toThrow(
      "Update the PartnerHub app",
    );
    expect(request).not.toHaveBeenCalled();
    native.available = true;
    request.mockResolvedValueOnce(
      Response.json({ error: "Sign in required" }, { status: 401 }),
    );
    await expect(
      downloadFile("/api/documents/test/download"),
    ).rejects.toMatchObject({ status: 401 });
    expect(dispatched.mock.calls[0][0].type).toBe("partnerhub:session-invalid");
    expect(native.writeFile).not.toHaveBeenCalled();
    expect(native.share).not.toHaveBeenCalled();
  });
});
