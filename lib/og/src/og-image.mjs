import { deflateSync } from 'node:zlib';

const WIDTH = 1200;
const HEIGHT = 630;
const MAX_CACHE_ENTRIES = 250;
const cache = new Map();

const FONT = {
  ' ': ['00000','00000','00000','00000','00000','00000','00000'],
  A: ['01110','10001','10001','11111','10001','10001','10001'],
  B: ['11110','10001','10001','11110','10001','10001','11110'],
  C: ['01111','10000','10000','10000','10000','10000','01111'],
  D: ['11110','10001','10001','10001','10001','10001','11110'],
  E: ['11111','10000','10000','11110','10000','10000','11111'],
  F: ['11111','10000','10000','11110','10000','10000','10000'],
  G: ['01111','10000','10000','10111','10001','10001','01111'],
  H: ['10001','10001','10001','11111','10001','10001','10001'],
  I: ['11111','00100','00100','00100','00100','00100','11111'],
  J: ['00111','00010','00010','00010','10010','10010','01100'],
  K: ['10001','10010','10100','11000','10100','10010','10001'],
  L: ['10000','10000','10000','10000','10000','10000','11111'],
  M: ['10001','11011','10101','10101','10001','10001','10001'],
  N: ['10001','11001','10101','10011','10001','10001','10001'],
  O: ['01110','10001','10001','10001','10001','10001','01110'],
  P: ['11110','10001','10001','11110','10000','10000','10000'],
  Q: ['01110','10001','10001','10001','10101','10010','01101'],
  R: ['11110','10001','10001','11110','10100','10010','10001'],
  S: ['01111','10000','10000','01110','00001','00001','11110'],
  T: ['11111','00100','00100','00100','00100','00100','00100'],
  U: ['10001','10001','10001','10001','10001','10001','01110'],
  V: ['10001','10001','10001','10001','10001','01010','00100'],
  W: ['10001','10001','10001','10101','10101','10101','01010'],
  X: ['10001','10001','01010','00100','01010','10001','10001'],
  Y: ['10001','10001','01010','00100','00100','00100','00100'],
  Z: ['11111','00001','00010','00100','01000','10000','11111'],
  '0': ['01110','10001','10011','10101','11001','10001','01110'],
  '1': ['00100','01100','00100','00100','00100','00100','01110'],
  '2': ['01110','10001','00001','00010','00100','01000','11111'],
  '3': ['11110','00001','00001','01110','00001','00001','11110'],
  '4': ['00010','00110','01010','10010','11111','00010','00010'],
  '5': ['11111','10000','10000','11110','00001','00001','11110'],
  '6': ['01110','10000','10000','11110','10001','10001','01110'],
  '7': ['11111','00001','00010','00100','01000','01000','01000'],
  '8': ['01110','10001','10001','01110','10001','10001','01110'],
  '9': ['01110','10001','10001','01111','00001','00001','01110'],
  '-': ['00000','00000','00000','11111','00000','00000','00000'],
  '&': ['01100','10010','10100','01000','10101','10010','01101'],
  '.': ['00000','00000','00000','00000','00000','00110','00110'],
  "'": ['00100','00100','00000','00000','00000','00000','00000'],
};

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, checksum]);
}

function setPixel(pixels, x, y, color) {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
  const i = (y * WIDTH + x) * 3;
  pixels[i] = color[0]; pixels[i + 1] = color[1]; pixels[i + 2] = color[2];
}

function fillRect(pixels, x, y, width, height, color) {
  for (let py = y; py < y + height; py++) {
    for (let px = x; px < x + width; px++) setPixel(pixels, px, py, color);
  }
}

function drawText(pixels, text, x, y, scale, color) {
  let cursor = x;
  for (const character of text.toUpperCase()) {
    const glyph = FONT[character] || FONT[' '];
    glyph.forEach((row, gy) => {
      [...row].forEach((on, gx) => {
        if (on === '1') fillRect(pixels, cursor + gx * scale, y + gy * scale, scale, scale, color);
      });
    });
    cursor += 6 * scale;
  }
}

function fitText(text, maxWidth, preferredScale, minScale = 3) {
  const clean = String(text).normalize('NFKD').replace(/[^\x20-\x7E]/g, '').trim();
  const scale = Math.max(minScale, Math.min(preferredScale, Math.floor(maxWidth / Math.max(1, clean.length * 6))));
  const maxCharacters = Math.floor(maxWidth / (6 * scale));
  return {
    scale,
    text: clean.length > maxCharacters ? `${clean.slice(0, Math.max(0, maxCharacters - 3)).trim()}...` : clean,
  };
}

function encodePng(pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header[8] = 8; header[9] = 2;
  const scanlines = Buffer.alloc(HEIGHT * (1 + WIDTH * 3));
  for (let y = 0; y < HEIGHT; y++) {
    const target = y * (1 + WIDTH * 3);
    scanlines[target] = 0;
    pixels.copy(scanlines, target + 1, y * WIDTH * 3, (y + 1) * WIDTH * 3);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(scanlines, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function renderCertificateImage(cert) {
  const cacheKey = `${cert.certificateId}:${cert.learnerName}:${cert.programTitle}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const pixels = Buffer.alloc(WIDTH * HEIGHT * 3);
  fillRect(pixels, 0, 0, WIDTH, HEIGHT, [3, 20, 39]);
  fillRect(pixels, 0, 0, 20, HEIGHT, [191, 145, 60]);
  fillRect(pixels, 72, 62, 1056, 506, [247, 242, 226]);
  fillRect(pixels, 88, 78, 1024, 474, [9, 42, 61]);
  fillRect(pixels, 103, 93, 994, 444, [247, 242, 226]);
  fillRect(pixels, 103, 93, 994, 14, [191, 145, 60]);
  fillRect(pixels, 103, 523, 994, 14, [191, 145, 60]);
  drawText(pixels, 'AFRIENERGY COMMS LAB', 170, 137, 6, [9, 42, 61]);
  drawText(pixels, 'CERTIFICATE OF COMPLETION', 247, 222, 5, [155, 111, 39]);

  const learner = fitText(cert.learnerName, 880, 10, 5);
  drawText(pixels, learner.text, Math.round((WIDTH - learner.text.length * 6 * learner.scale) / 2), 305, learner.scale, [3, 20, 39]);
  const program = fitText(cert.programTitle, 820, 6, 4);
  drawText(pixels, program.text, Math.round((WIDTH - program.text.length * 6 * program.scale) / 2), 414, program.scale, [9, 82, 74]);
  drawText(pixels, `VERIFIED ${cert.certificateId}`, 377, 481, 3, [91, 91, 82]);

  const image = encodePng(pixels);
  cache.set(cacheKey, image);
  if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
  return image;
}

export function clearCertificateImageCache() {
  cache.clear();
}