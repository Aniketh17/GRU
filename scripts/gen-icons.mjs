// Generates GRU's PNG app icons (no image libraries): dark tile + teal progress ring,
// matching public/icons/favicon.svg. Run: node scripts/gen-icons.mjs
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const BG = [0x16, 0x18, 0x1b];
const TRACK = [0x3a, 0x40, 0x48];
const ACCENT = [0x5d, 0xbf, 0xb1];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/** Sample the icon at unit coords (0..64 space). Returns [r,g,b,a] or null for transparent. */
function sample(u, v, { rounded, scale }) {
  const c = 32;
  // Background tile
  if (rounded) {
    const r = 15, dx = Math.max(Math.abs(u - c) - (c - r), 0), dy = Math.max(Math.abs(v - c) - (c - r), 0);
    if (dx * dx + dy * dy > r * r) return null;
  }
  const x = (u - c) / scale, y = (v - c) / scale;
  const d = Math.hypot(x, y);
  if (Math.abs(d - 17) <= 3) {
    // Angle from 12 o'clock, clockwise, in degrees.
    let ang = (Math.atan2(x, -y) * 180) / Math.PI;
    if (ang < 0) ang += 360;
    return ang <= 232 ? ACCENT : TRACK;
  }
  // Rounded cap at the arc's start (top) and end.
  const caps = [[0, -17], [17 * Math.sin((232 * Math.PI) / 180), -17 * Math.cos((232 * Math.PI) / 180)]];
  for (const [px, py] of caps) if (Math.hypot(x - px, y - py) <= 3) return ACCENT;
  return BG;
}

function render(size, opts) {
  const SS = 4;
  return png(size, (px, py) => {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const u = ((px + (sx + 0.5) / SS) / size) * 64, v = ((py + (sy + 0.5) / SS) / size) * 64;
        const col = sample(u, v, opts);
        if (col) { r += col[0]; g += col[1]; b += col[2]; a += 255; }
      }
    }
    const n = SS * SS;
    return a === 0 ? [0, 0, 0, 0] : [Math.round(r / (a / 255)), Math.round(g / (a / 255)), Math.round(b / (a / 255)), Math.round(a / n)];
  });
}

const out = new URL("../apps/web/public/icons/", import.meta.url);
writeFileSync(new URL("icon-192.png", out), render(192, { rounded: true, scale: 1 }));
writeFileSync(new URL("icon-512.png", out), render(512, { rounded: true, scale: 1 }));
writeFileSync(new URL("apple-touch-icon.png", out), render(180, { rounded: false, scale: 1 }));
writeFileSync(new URL("icon-maskable-512.png", out), render(512, { rounded: false, scale: 0.78 }));
console.log("icons written");
