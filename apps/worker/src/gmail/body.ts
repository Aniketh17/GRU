// Turns a Gmail message into plain text IN MEMORY so facts can be extracted. The text is never stored, logged or returned.
import { b64urlDecode } from "../crypto/b64.ts";
import type { GmailMessage, GmailPart } from "./types.ts";

const MAX_CHARS = 40_000;
const decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: false });

function decodePart(data: string | undefined): string {
  if (!data) return "";
  try {
    return decoder.decode(b64urlDecode(data));
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

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
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
  const text = (out.text.trim() ? out.text : htmlToText(out.html)).slice(0, MAX_CHARS);
  return { text, html: out.html.slice(0, MAX_CHARS * 2) };
}
