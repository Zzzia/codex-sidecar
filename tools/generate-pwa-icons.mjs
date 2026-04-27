import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const iconDir = path.join(rootDir, "public", "icons");

const COLORS = {
  background: [245, 240, 232, 255],
  panel: [255, 251, 244, 255],
  panelBorder: [217, 208, 194, 255],
  text: [45, 42, 37, 255],
  muted: [107, 98, 85, 255],
  accent: [63, 128, 91, 255],
  running: [188, 129, 35, 255],
};

const crcTable = new Uint32Array(256);
for (let index = 0; index < crcTable.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}

function encodePng(size, pixels) {
  const rowLength = size * 4 + 1;
  const scanlines = Buffer.alloc(rowLength * size);
  for (let y = 0; y < size; y += 1) {
    scanlines[y * rowLength] = 0;
    pixels.copy(scanlines, y * rowLength + 1, y * size * 4, (y + 1) * size * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function setPixel(pixels, size, x, y, color, alpha = 1) {
  if (x < 0 || y < 0 || x >= size || y >= size || alpha <= 0) {
    return;
  }
  const offset = (y * size + x) * 4;
  const sourceAlpha = (color[3] / 255) * Math.min(1, alpha);
  const targetAlpha = pixels[offset + 3] / 255;
  const outAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
  if (outAlpha <= 0) {
    return;
  }
  for (let channel = 0; channel < 3; channel += 1) {
    pixels[offset + channel] = Math.round(
      (color[channel] * sourceAlpha +
        pixels[offset + channel] * targetAlpha * (1 - sourceAlpha)) /
        outAlpha,
    );
  }
  pixels[offset + 3] = Math.round(outAlpha * 255);
}

function fill(pixels, size, color) {
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      setPixel(pixels, size, x, y, color);
    }
  }
}

function roundedRectCoverage(x, y, left, top, width, height, radius) {
  const right = left + width;
  const bottom = top + height;
  if (x < left || x >= right || y < top || y >= bottom) {
    return 0;
  }

  const cornerX = x < left + radius ? left + radius : x > right - radius ? right - radius : x;
  const cornerY = y < top + radius ? top + radius : y > bottom - radius ? bottom - radius : y;
  const distance = Math.hypot(x - cornerX, y - cornerY);
  return Math.max(0, Math.min(1, radius + 0.5 - distance));
}

function drawRoundedRect(pixels, size, rect, color) {
  const left = Math.round(rect.x);
  const top = Math.round(rect.y);
  const right = Math.ceil(rect.x + rect.width);
  const bottom = Math.ceil(rect.y + rect.height);
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const coverage = roundedRectCoverage(
        x + 0.5,
        y + 0.5,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        rect.radius,
      );
      setPixel(pixels, size, x, y, color, coverage);
    }
  }
}

function drawCircle(pixels, size, cx, cy, radius, color) {
  const left = Math.floor(cx - radius - 1);
  const top = Math.floor(cy - radius - 1);
  const right = Math.ceil(cx + radius + 1);
  const bottom = Math.ceil(cy + radius + 1);
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const coverage = Math.max(0, Math.min(1, radius + 0.5 - distance));
      setPixel(pixels, size, x, y, color, coverage);
    }
  }
}

function drawIcon(size, maskable) {
  const pixels = Buffer.alloc(size * size * 4);
  fill(pixels, size, COLORS.background);

  const scale = size / 512;
  const inset = maskable ? 104 * scale : 92 * scale;
  const panelSize = size - inset * 2;
  const panelRadius = (maskable ? 60 : 66) * scale;
  const border = 10 * scale;

  drawRoundedRect(
    pixels,
    size,
    {
      x: inset,
      y: inset,
      width: panelSize,
      height: panelSize,
      radius: panelRadius,
    },
    COLORS.panelBorder,
  );
  drawRoundedRect(
    pixels,
    size,
    {
      x: inset + border,
      y: inset + border,
      width: panelSize - border * 2,
      height: panelSize - border * 2,
      radius: panelRadius - border,
    },
    COLORS.panel,
  );

  const offset = maskable ? 12 * scale : 0;
  drawRoundedRect(
    pixels,
    size,
    {
      x: (128 + offset) * scale,
      y: (130 + offset) * scale,
      width: 58 * scale,
      height: 252 * scale,
      radius: 24 * scale,
    },
    COLORS.accent,
  );
  drawRoundedRect(
    pixels,
    size,
    {
      x: (214 + offset) * scale,
      y: (136 + offset) * scale,
      width: 164 * scale,
      height: 42 * scale,
      radius: 20 * scale,
    },
    COLORS.running,
  );
  drawRoundedRect(
    pixels,
    size,
    {
      x: (214 + offset) * scale,
      y: (214 + offset) * scale,
      width: 164 * scale,
      height: 30 * scale,
      radius: 15 * scale,
    },
    COLORS.text,
  );
  drawRoundedRect(
    pixels,
    size,
    {
      x: (214 + offset) * scale,
      y: (274 + offset) * scale,
      width: 128 * scale,
      height: 30 * scale,
      radius: 15 * scale,
    },
    COLORS.muted,
  );
  drawRoundedRect(
    pixels,
    size,
    {
      x: (214 + offset) * scale,
      y: (334 + offset) * scale,
      width: 96 * scale,
      height: 30 * scale,
      radius: 15 * scale,
    },
    COLORS.accent,
  );
  drawCircle(
    pixels,
    size,
    (368 + offset) * scale,
    (348 + offset) * scale,
    18 * scale,
    COLORS.running,
  );

  return encodePng(size, pixels);
}

await mkdir(iconDir, { recursive: true });
await Promise.all([
  writeFile(path.join(iconDir, "codex-sidecar-192.png"), drawIcon(192, false)),
  writeFile(path.join(iconDir, "codex-sidecar-512.png"), drawIcon(512, false)),
  writeFile(path.join(iconDir, "codex-sidecar-maskable-512.png"), drawIcon(512, true)),
]);
