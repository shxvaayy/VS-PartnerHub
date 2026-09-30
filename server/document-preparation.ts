import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import {
  documentLimits,
  emptyIdentity,
  type ExtractedIdentity,
} from "../shared/ai.js";
import { assertAiRequestActive } from "./ai-request.js";
import { HttpError } from "./errors.js";

const require = createRequire(import.meta.url);
const pdfModule = require.resolve("pdfjs-dist/legacy/build/pdf.mjs");
const pdfLib = require.resolve("pdf-lib");
export const extractionVersion = 3;
export const maxAiDocumentPages = documentLimits.pages;
interface PdfPageText {
  pageNumber: number;
  text: string;
}
interface PdfReadResult {
  pages: PdfPageText[];
  pageCount: number;
  textPages: number;
  scannedPages: number;
  blankPages: number;
  complete: boolean;
  ocrPageNumbers: number[];
  ocrPdf?: Uint8Array;
}

// Every text page gets representation before relevant sections are selected.
// This avoids losing late-page identifiers when a document exceeds AI context.
export function documentAnalysisText(
  pages: PdfPageText[],
  budget = documentLimits.analysisText,
) {
  const full = pages
    .map((page) => `[Page ${page.pageNumber}]\n${page.text}`)
    .join("\n\n");
  if (full.length <= budget) return { text: full, complete: true };
  const prefix = Math.max(30, Math.floor((budget * 0.45) / pages.length) - 30);
  const selected = new Map<number, { start: number; text: string }[]>();
  let used = 0;
  for (const page of pages) {
    const text = page.text.slice(0, prefix);
    selected.set(page.pageNumber, [{ start: 0, text }]);
    used += text.length + 35;
  }
  const relevance =
    /\b(company|legal name|gst(?:in)?|pan|cin|registration|expir\w*|valid until|certificate|address|invoice|total|tax|payment|warranty|delivery|requirements?|skills?|quantity|deadline)\b/gi;
  const sections = pages
    .flatMap((page) => {
      const parts = [];
      for (let start = prefix; start < page.text.length; start += 800) {
        const text = page.text.slice(start, start + 800);
        const matches = text.match(relevance) || [];
        parts.push({
          page: page.pageNumber,
          start,
          text,
          score: new Set(matches.map((word) => word.toLowerCase())).size,
        });
      }
      return parts;
    })
    .sort((a, b) => b.score - a.score || a.start - b.start || a.page - b.page);
  for (const section of sections) {
    if (used + section.text.length + 30 > budget) continue;
    selected.get(section.page)!.push(section);
    used += section.text.length + 30;
  }
  return {
    text: pages
      .map(
        (page) =>
          `[Page ${page.pageNumber} — excerpts]\n${selected
            .get(page.pageNumber)!
            .sort((a, b) => a.start - b.start)
            .map((section) => section.text)
            .join("\n[… excerpt boundary …]\n")}`,
      )
      .join("\n\n")
      .slice(0, budget),
    complete: false,
  };
}
let active = 0;
const queue: { grant: () => void }[] = [];
const release = () => {
  active--;
  queue.shift()?.grant();
};
function acquire(signal?: AbortSignal): Promise<() => void> {
  assertAiRequestActive(signal);
  if (active < 2) {
    active++;
    return Promise.resolve(release);
  }
  if (queue.length >= 8)
    throw new HttpError(
      503,
      "Document processing is busy. Please try again shortly.",
    );
  return new Promise((resolve, reject) => {
    const entry = {
      grant: () => {
        signal?.removeEventListener("abort", cancel);
        active++;
        resolve(release);
      },
    };
    const cancel = () => {
      const index = queue.indexOf(entry);
      if (index >= 0) queue.splice(index, 1);
      try {
        assertAiRequestActive(signal);
      } catch (error) {
        reject(error);
      }
    };
    signal?.addEventListener("abort", cancel, { once: true });
    queue.push(entry);
  });
}

// Parsing stays off the API event loop. Workers have a memory/time budget and
// never render pages, execute embedded JavaScript or fetch PDF resources.
const workerCode = `
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  let task;
  try {
    const { pathToFileURL } = require('node:url');
    const { getDocument, OPS } = await import(pathToFileURL(workerData.pdfModule).href);
    task = getDocument({ data: workerData.bytes, verbosity: 0, isEvalSupported: false, disableFontFace: true, useWorkerFetch: false, stopAtErrors: true });
    const pdf = await task.promise;
    if (pdf.numPages > workerData.maxPages) throw { name: 'PageLimit' };
    let complete = true, textPages = 0, scannedPages = 0, blankPages = 0;
    const pages = [], ocrPageNumbers = [], perPageBudget = Math.floor(workerData.textBudget / pdf.numPages) - 40;
    parentPort.postMessage({ progress: true, pagesRead: 0, totalPages: pdf.numPages });
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      let text = '', y;
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        const nextY = item.transform?.[5];
        if (y !== undefined && nextY !== undefined && Math.abs(nextY - y) > 2) text += '\\n';
        text += item.str + (item.hasEOL ? '\\n' : ' ');
        y = nextY;
      }
      text = text.trim();
      // Detect a scan even when a page also has a selectable header/footer.
      // Small logos on readable pages do not force OCR of the whole PDF.
      let scanned = false, matrix = [1, 0, 0, 1], stack = [];
      const operators = await page.getOperatorList(), viewport = page.getViewport({ scale: 1 });
      for (let index = 0; index < operators.fnArray.length; index++) {
        const op = operators.fnArray[index], args = operators.argsArray[index];
        if (op === OPS.save) stack.push(matrix.slice());
        else if (op === OPS.restore) matrix = stack.pop() || [1, 0, 0, 1];
        else if (op === OPS.transform) {
          const [a, b, c, d] = matrix;
          matrix = [a * args[0] + c * args[1], b * args[0] + d * args[1], a * args[2] + c * args[3], b * args[2] + d * args[3]];
        } else if ([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintImageXObjectRepeat, OPS.paintSolidColorImageMask].includes(op)) {
          const area = Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]);
          if (text.length < 80 || area > viewport.width * viewport.height * 0.35) scanned = true;
        } else if (!text.length && [OPS.constructPath, OPS.shadingFill].includes(op)) scanned = true;
      }
      if (scanned) { scannedPages++; ocrPageNumbers.push(pageNumber); }
      if (text.length) textPages++;
      else if (!scanned) blankPages++;
      if (text.length > perPageBudget) {
        complete = false;
        const head = text.slice(0, Math.floor(perPageBudget * 0.35));
        const tail = text.slice(-Math.floor(perPageBudget * 0.2));
        const important = text.split('\\n').filter((line) => /company|gst|pan|cin|registration|expir|certificate|address|invoice|total|warranty|payment/i.test(line)).join('\\n').slice(0, Math.floor(perPageBudget * 0.4));
        text = [head, important, tail].join('\\n[… excerpt boundary …]\\n').slice(0, perPageBudget);
      }
      if (text.length) pages.push({ pageNumber, text });
      page.cleanup();
      if (pageNumber === 1 || pageNumber % 5 === 0 || pageNumber === pdf.numPages) parentPort.postMessage({ progress: true, pagesRead: pageNumber, totalPages: pdf.numPages });
    }
    let ocrPdf;
    if (ocrPageNumbers.length && ocrPageNumbers.length < pdf.numPages) {
      const { PDFDocument } = require(workerData.pdfLib);
      const source = await PDFDocument.load(await pdf.getData()), subset = await PDFDocument.create();
      for (const page of await subset.copyPages(source, ocrPageNumbers.map((number) => number - 1))) subset.addPage(page);
      ocrPdf = await subset.save();
    }
    parentPort.postMessage({ pages, pageCount: pdf.numPages, textPages, scannedPages, blankPages, complete, ocrPageNumbers, ocrPdf });
  } catch (error) { parentPort.postMessage({ error: error.name || 'InvalidPDF' }); }
  finally { await task?.destroy().catch(() => {}); }
})();`;

export async function prepareDocument(
  content: Buffer,
  mime: string,
  signal?: AbortSignal,
  onProgress?: (progress: { pagesRead: number; totalPages: number }) => void,
) {
  if (mime !== "application/pdf")
    return {
      text: "",
      analysisText: "",
      analysisComplete: true,
      pageCount: 1,
      textPages: 0,
      scannedPages: 1,
      blankPages: 0,
      ocrPageNumbers: [1],
      ocrContent: undefined as Buffer | undefined,
      complete: true,
      identity: emptyIdentity(),
      method: "image_ocr" as const,
    };
  const unlock = await acquire(signal);
  try {
    const bytes = Uint8Array.from(content);
    const worker = new Worker(workerCode, {
      eval: true,
      execArgv: [],
      workerData: {
        bytes,
        pdfModule,
        pdfLib,
        maxPages: maxAiDocumentPages,
        textBudget: documentLimits.retainedText,
      },
      transferList: [bytes.buffer],
      resourceLimits: {
        maxOldGenerationSizeMb: 192,
        maxYoungGenerationSizeMb: 16,
      },
    });
    const result = await new Promise<PdfReadResult>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error, value?: any) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
        void worker.terminate();
        if (error) reject(error);
        else resolve(value);
      };
      const cancel = () => {
        try {
          assertAiRequestActive(signal);
        } catch (error) {
          finish(error as Error);
        }
      };
      const timer = setTimeout(
        () =>
          finish(
            new HttpError(
              422,
              "This PDF is taking too long to read. Upload the relevant pages or a clear image.",
            ),
          ),
        25000,
      );
      worker.on("message", (value) => {
        if (settled) return;
        if (value.progress) {
          try {
            assertAiRequestActive(signal);
            onProgress?.({
              pagesRead: value.pagesRead,
              totalPages: value.totalPages,
            });
          } catch (error) {
            finish(error as Error);
          }
          return;
        }
        if (!value.error) return finish(undefined, value);
        finish(
          new HttpError(
            422,
            value.error === "PasswordException"
              ? "This PDF is password protected. Upload an unlocked copy or a clear image."
              : value.error === "PageLimit"
                ? `This PDF exceeds ${maxAiDocumentPages} pages. Split it into smaller documents, then extract each file.`
                : "This PDF could not be read. Upload a valid PDF or a clear image.",
          ),
        );
      });
      worker.once("error", () =>
        finish(
          new HttpError(
            422,
            "This PDF could not be read. Upload a valid PDF or a clear image.",
          ),
        ),
      );
      worker.once("exit", () => {
        if (!settled)
          finish(
            new HttpError(
              422,
              "Document processing was interrupted. Please try again.",
            ),
          );
      });
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) cancel();
    });
    const text = result.pages
      .map((page) => `[Page ${page.pageNumber}]\n${page.text}`)
      .join("\n\n");
    const analysis = documentAnalysisText(result.pages);
    const { pages: _pages, ocrPdf, ...counts } = result;
    return {
      ...counts,
      text,
      analysisText: analysis.text,
      analysisComplete: result.complete && analysis.complete,
      ocrContent: ocrPdf ? Buffer.from(ocrPdf) : undefined,
      identity: labelledIdentity(text),
      method:
        text.length > 0 && result.scannedPages === 0
          ? ("pdf_text" as const)
          : ("scanned_pdf_ocr" as const),
    };
  } finally {
    unlock();
  }
}

// Conservative candidates only: absent labels remain absent. AI may help with
// layout and meaning, while identifier/date/profile checks remain deterministic.
export function labelledIdentity(text: string): ExtractedIdentity {
  const identity = emptyIdentity();
  const label = (names: string) =>
    new RegExp(`(?:^|\\n)\\s*(?:${names})\\s*[:：]\\s*([^\\n]+)`, "i")
      .exec(text)?.[1]
      ?.trim() || null;
  identity.company_name = label(
    "company name|legal name|name of company|name of the company",
  );
  identity.gst =
    /\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/i.exec(text)?.[0] ||
    null;
  identity.pan = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/i.exec(text)?.[0] || null;
  identity.cin =
    /\b[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}\b/i.exec(text)?.[0] || null;
  identity.registration_number = label(
    "registration number|registration no\\.?|registration id",
  );
  identity.expiry_date = label(
    "expiry date|expiration date|valid until|valid through",
  );
  identity.certificate_type = label("certificate type|document type");
  identity.address = label("registered address|company address|address");
  return identity;
}
