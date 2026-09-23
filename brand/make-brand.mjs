import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* ------------------------------------------------------------------ config --
 * The supplied artwork is a JPEG on a solid black ground, so the black stays:
 * keying it out would also eat the piece's own black outline and beard.
 * -------------------------------------------------------------------------- */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = process.argv[2] ?? path.join(HERE, "source/logo-lockup.jpg");
const ROOT = path.resolve(process.argv[3] ?? path.join(HERE, ".."));

const PAD = 0.07; // breathing room around the mark inside its square
const MARK_CROP = 0.78; // head-only cut — the full figure is far too thin to read
                        // in a square at nav (28px) or favicon (16px) sizes
const png = (img) => img.png({ compressionLevel: 9, palette: true, quality: 92, effort: 10 });

/* ------------------------------------------------------------ measure ----- */
const trimmed = await sharp(SRC).trim({ background: "#000000", threshold: 12 }).png().toBuffer();
const { data, info } = await sharp(trimmed).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H, channels: C } = info;

const lit = (x, y) => {
  const i = (y * W + x) * C;
  return data[i] > 40 || data[i + 1] > 40 || data[i + 2] > 40;
};

/** Tight bounding box of everything that is not background. */
function bbox(x0, y0, x1, y1) {
  let minX = x1, minY = y1, maxX = x0, maxY = y0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (!lit(x, y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/* The artwork is a king stacked above a wordmark; find the empty band between. */
const rowInk = [];
for (let y = 0; y < H; y++) {
  let n = 0;
  for (let x = 0; x < W; x++) if (lit(x, y)) n++;
  rowInk.push(n);
}
let split = -1;
for (let y = Math.floor(H * 0.4); y < H; y++) {
  if (rowInk[y] === 0) { split = y; break; }
}
if (split < 0) throw new Error("could not find the gap between mark and wordmark");

const fullMarkBox = bbox(0, 0, W, split);
const lockupBox = bbox(0, 0, W, H);
// Crown through beard: keeps the character readable once the square is small.
const markBox = { ...fullMarkBox, height: Math.round(fullMarkBox.height * MARK_CROP) };
console.log("full mark: ", JSON.stringify(fullMarkBox));
console.log("mark crop: ", JSON.stringify(markBox));
console.log("lockup box:", JSON.stringify(lockupBox));

/* --------------------------------------------------------- square mark ---- */
const side = Math.round(Math.max(markBox.width, markBox.height) * (1 + PAD * 2));

/** The mark, centred on a square black ground — the shape an app icon needs.
 *  `rgba` is needed for the ICO: Next.js refuses palette/RGB PNG entries. */
async function markSquare(size, { rgba = false } = {}) {
  const piece = await sharp(trimmed)
    .extract(markBox)
    .resize({ width: side, height: side, fit: "contain", background: "#000000", kernel: "lanczos3" })
    .png()
    .toBuffer();
  const out = sharp(piece).resize(size, size, { kernel: "lanczos3" });
  return rgba
    ? out.ensureAlpha().png({ compressionLevel: 9 }).toBuffer()
    : png(out).toBuffer();
}

/* --------------------------------------------------------------- .ico ----- */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = header.length + dir.length;
  entries.forEach((e, i) => {
    const b = i * 16;
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, b);
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, b + 1);
    dir.writeUInt8(0, b + 2);
    dir.writeUInt8(0, b + 3);
    dir.writeUInt16LE(1, b + 4);
    dir.writeUInt16LE(32, b + 6);
    dir.writeUInt32LE(e.png.length, b + 8);
    dir.writeUInt32LE(offset, b + 12);
    offset += e.png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

/* -------------------------------------------------------------- output ---- */
const write = (rel, buf) => {
  const t = path.join(ROOT, rel);
  mkdirSync(path.dirname(t), { recursive: true });
  writeFileSync(t, buf);
  console.log("  " + rel.padEnd(28) + (buf.length / 1024).toFixed(1) + " KB");
};

console.log("writing into " + ROOT);

// Nav / app mark, plus the full lockup for the README.
write("public/logo-mark.png", await markSquare(256));
write(
  "public/logo-lockup.jpg",
  await sharp(trimmed)
    .extract(lockupBox)
    .resize({ width: 900, kernel: "lanczos3" })
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer(),
);

// Next.js metadata file conventions.
write("src/app/icon.png", await markSquare(256));
write("src/app/apple-icon.png", await markSquare(180));
const ico = [];
for (const size of [16, 32, 48]) ico.push({ size, png: await markSquare(size, { rgba: true }) });
write("src/app/favicon.ico", buildIco(ico));

console.log("done — mark square is " + side + "px");
