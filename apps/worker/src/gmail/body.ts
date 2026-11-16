// Turns a Gmail message into plain text IN MEMORY so facts can be extracted. The text is never stored, logged or returned.
import { b64urlDecode } from "../crypto/b64.ts";
import type { GmailMessage, GmailPart } from "./types.ts";

// Caps keep CPU well inside the Workers Free 10 ms limit: job lists and interview details are at the top of an email.
const MAX_TEXT = 20_000;
const MAX_HTML = 50_000;
const MAX_ENCODED = 90_000; // base64 chars per part
const decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: false });

function decodePart(data: string | undefined): string {
  if (!data) return "";
  try {
    // Never decode more than needed (multiple of 4 keeps the base64 valid).
    return decoder.decode(b64urlDecode((data.length > MAX_ENCODED ? data.slice(0, MAX_ENCODED & ~3) : data)));
  } catch {
    return "";
  }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", ndash: "-", mdash: "-", hellip: "..." };

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
}

export function htmlToText(html: string, opts: { cells?: boolean } = {}): string {
  return decodeEntities(
    html
      .replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(opts.cells ? /<\s*\/t[dh]\b[^>]*>/gi : /(?!)/g, "\n")
      .replace(/<\s*(br|\/p|\/div|\/tr|\/li|\/h[1-6]|\/table)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\r\f\v\u00a0]+/g, " ")
    .replace(/\n\s*/g, "\n")
    .trim();
}

function walk(part: GmailPart | undefined, out: { text: string; html: string }): void {
  if (!part) return;
  const type = (part.mimeType ?? "").toLowerCase();
  if (type === "text/plain") out.text += `${decodePart(part.body?.data)}\n`;
  else if (type === "text/html") out.html += `${decodePart(part.body?.data)}\n`;
  for (const p of part.parts ?? []) walk(p, out);
}

/** Plain text (preferring text/plain, else converted HTML) plus the raw HTML (only used to find link targets). */
export function messageBody(msg: GmailMessage): { text: string; html: string } {
  const out = { text: "", html: "" };
  walk(msg.payload, out);
  const html = out.html.slice(0, MAX_HTML); // cap BEFORE converting: cost is linear in size
  const text = (out.text.trim() ? out.text : htmlToText(html)).slice(0, MAX_TEXT);
  return { text, html };
}

/** The MIME structure of a message with sizes, e.g. "multipart/mixed[multipart/alternative[text/plain:1204,text/html:9800],application/pdf*]". No content. */
export function mimeShape(part: GmailPart | undefined): string {
  if (!part) return "";
  const size = part.body?.size ? `:${part.body.size}` : "";
  const att = part.body?.attachmentId ? "*" : "";
  const kids = (part.parts ?? []).map((p) => mimeShape(p)).join(",");
  const head = `${part.mimeType ?? "?"}${size}${att}`;
  return (kids ? `${head}[${kids}]` : head).slice(0, 300);
}
