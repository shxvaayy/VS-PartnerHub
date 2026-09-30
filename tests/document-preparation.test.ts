import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { prepareDocument } from "../server/document-preparation.js";
import { documentLimits } from "../shared/ai.js";

const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
  "base64",
);
async function longPdf(pages: number) {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pages; index++) {
    const page = pdf.addPage();
    for (let line = 0; line < 26; line++)
      page.drawText(
        `Operating handbook section ${index + 1}.${line + 1}. Read the original record before acting on any extracted value.`,
        { x: 25, y: 775 - line * 24, size: 8 },
      );
  }
  return pdf;
}

describe("bounded document reading", () => {
  it("reads more than forty pages, retains the full text and selects late-page identifiers within the AI context budget", async () => {
    const pdf = await longPdf(72);
    pdf
      .getPage(71)
      .drawText(
        "Company name: Late Page Verification Ltd\nPAN: ABCDE1234F\nRegistration number: LATE-72-VERIFY",
        { x: 25, y: 100, size: 10, lineHeight: 15 },
      );
    const progress: { pagesRead: number; totalPages: number }[] = [];
    const result = await prepareDocument(
      Buffer.from(await pdf.save()),
      "application/pdf",
      undefined,
      (value) => progress.push(value),
    );
    expect(result.method).toBe("pdf_text");
    expect(result.pageCount).toBe(72);
    expect(result.text.length).toBeGreaterThan(documentLimits.analysisText);
    expect(result.text).toContain("section 37.26");
    expect(result.analysisText.length).toBeLessThanOrEqual(
      documentLimits.analysisText,
    );
    expect(result.analysisText).toContain("LATE-72-VERIFY");
    expect(result.analysisText).toContain("[Page 72");
    expect(result.identity.pan).toBe("ABCDE1234F");
    expect(result.complete).toBe(true);
    expect(result.analysisComplete).toBe(false);
    expect(progress.at(-1)).toEqual({ pagesRead: 72, totalPages: 72 });
  });

  it("does not send readable PDFs through OCR merely because they contain blank pages", async () => {
    const pdf = await PDFDocument.create();
    pdf
      .addPage()
      .drawText("Company name: Blank Page QA Ltd", { x: 30, y: 700 });
    for (let i = 0; i < 42; i++) pdf.addPage();
    const result = await prepareDocument(
      Buffer.from(await pdf.save()),
      "application/pdf",
    );
    expect(result.method).toBe("pdf_text");
    expect(result.pageCount).toBe(43);
    expect(result.blankPages).toBe(42);
    expect(result.ocrContent).toBeUndefined();
    expect(result.analysisComplete).toBe(true);
  });

  it("isolates scanned pages even with selectable headers while keeping small logos out of OCR", async () => {
    const pdf = await longPdf(3);
    const image = await pdf.embedPng(pixel);
    pdf.getPage(0).drawImage(image, { x: 20, y: 800, width: 15, height: 15 });
    pdf.getPage(1).drawImage(image, { x: 10, y: 10, width: 550, height: 680 });
    const result = await prepareDocument(
      Buffer.from(await pdf.save()),
      "application/pdf",
    );
    expect(result.method).toBe("scanned_pdf_ocr");
    expect(result.ocrPageNumbers).toEqual([2]);
    expect(result.scannedPages).toBe(1);
    expect(result.text).toContain("section 3.26");
    expect(result.ocrContent).toBeDefined();
    expect((await PDFDocument.load(result.ocrContent!)).getPageCount()).toBe(1);
  });

  it("stops local PDF work on cancellation and permits the next read", async () => {
    const pdf = await longPdf(45),
      controller = new AbortController();
    const bytes = Buffer.from(await pdf.save());
    await expect(
      prepareDocument(
        bytes,
        "application/pdf",
        controller.signal,
        ({ pagesRead }) => {
          if (pagesRead >= 5) controller.abort();
        },
      ),
    ).rejects.toMatchObject({ status: 499 });
    const retry = await prepareDocument(bytes, "application/pdf");
    expect(retry.pageCount).toBe(45);
  });
});
