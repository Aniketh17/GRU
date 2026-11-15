// Resume files are read ON THIS DEVICE. Only the extracted text is sent to GRU; the file itself never leaves the phone.
// PDF/DOCX parsers are loaded on demand so they don't weigh down the rest of the app.
export const MAX_RESUME_BYTES = 8 * 1024 * 1024;
export const MAX_RESUME_CHARS = 40_000;

export class ResumeFileError extends Error {}

export async function extractResumeText(file: File): Promise<string> {
  if (file.size > MAX_RESUME_BYTES) throw new ResumeFileError("That file is over 8 MB. Try a smaller export.");
  const name = file.name.toLowerCase();
  let text: string;
  if (name.endsWith(".pdf") || file.type === "application/pdf") text = await fromPdf(file);
  else if (name.endsWith(".docx")) text = await fromDocx(file);
  else if (name.endsWith(".txt") || name.endsWith(".md") || file.type.startsWith("text/")) text = await file.text();
  else if (name.endsWith(".doc")) throw new ResumeFileError("Old .doc files aren’t supported. Save it as PDF or DOCX and try again.");
  else throw new ResumeFileError("Use a PDF, DOCX or TXT file.");
  text = text.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < 50) throw new ResumeFileError("No readable text found. Scanned images aren’t supported; export a text PDF or DOCX instead.");
  return text.slice(0, MAX_RESUME_CHARS);
}

async function fromPdf(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= Math.min(doc.numPages, 10); n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    let line = "";
    for (const item of content.items) {
      if (!("str" in item)) continue;
      line += item.str;
      line += item.hasEOL ? "\n" : " ";
    }
    pages.push(line);
  }
  return pages.join("\n");
}

async function fromDocx(file: File): Promise<string> {
  const mammoth = await import("mammoth");
  return (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
}
