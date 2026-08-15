#!/usr/bin/env node
/**
 * build-extension.js —— 生成浏览器扩展（Chrome / Edge / Firefox）
 * ------------------------------------------------------------
 * 产物：
 *   extension/content.js    引擎 + 内容脚本主体（拼接生成）
 *   extension/icons/*.png   程序化生成的图标（16/32/48/128）
 *   release/…zip            可直接上传商店或拖入浏览器安装的安装包
 *
 * 用法：node build-extension.js
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { deflateSync, deflateRawSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = here; // 脚本位于项目根目录
const extDir = join(here, 'extension');
const releaseDir = join(here, 'release');
const VERSION = '1.0.0';

/* ============================== PNG 编码 ============================== */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (1 + width * 4) + 1);
  }
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw, { level: 9 })), pngChunk('IEND', Buffer.alloc(0))]);
}

/* ============================== 图标绘制 ============================== */
function distToSeg(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / (abx * abx + aby * aby || 1)));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

function drawIcon(size) {
  const s = size;
  const px = new Uint8Array(s * s * 4);
  const bg = [23, 23, 26];
  const dot = [232, 240, 255];
  const line = [86, 134, 254];
  const dots = [[0.30, 0.64], [0.50, 0.36], [0.72, 0.52], [0.54, 0.80]].map((d) => [d[0] * s, d[1] * s]);
  const links = [[0, 1], [1, 2], [0, 3], [1, 3]];
  const dotR = Math.max(1.1, s * 0.075);
  const lineW = Math.max(1.1, s * 0.05);
  const glow = Math.max(1.5, s * 0.14);
  const radius = s * 0.24;
  const half = s / 2;

  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const cx = x + 0.5, cy = y + 0.5;
      const ax = Math.abs(cx - half), ay = Math.abs(cy - half);
      let inside;
      if (ax > half - radius && ay > half - radius) {
        const dx = ax - (half - radius), dy = ay - (half - radius);
        inside = dx * dx + dy * dy <= radius * radius;
      } else {
        inside = ax <= half && ay <= half;
      }
      if (!inside) continue;

      let col = bg.slice();
      // 线条
      let minLine = Infinity;
      for (const [i, j] of links) {
        const d = distToSeg(cx, cy, dots[i][0], dots[i][1], dots[j][0], dots[j][1]);
        if (d < minLine) minLine = d;
      }
      if (minLine < lineW) {
        const a = Math.max(0, Math.min(1, 1 - (minLine - lineW / 2) / lineW));
        col = col.map((v, k) => v + (line[k] - v) * a);
      }
      // 光晕
      let minDot = Infinity;
      for (const [dx, dy] of dots) {
        const d = Math.hypot(cx - dx, cy - dy);
        if (d < minDot) minDot = d;
      }
      if (minDot < dotR + glow) {
        const a = Math.max(0, Math.min(1, 1 - (minDot - dotR) / glow)) * 0.35;
        col = col.map((v, k) => v + (line[k] - v) * a);
      }
      // 圆点
      if (minDot < dotR) {
        const a = Math.max(0, Math.min(1, 1 - (minDot - dotR * 0.6) / (dotR * 0.4)));
        col = col.map((v, k) => v + (dot[k] - v) * a);
      }
      const o = (y * s + x) * 4;
      px[o] = Math.round(col[0]);
      px[o + 1] = Math.round(col[1]);
      px[o + 2] = Math.round(col[2]);
      px[o + 3] = 255;
    }
  }
  return encodePNG(s, s, px);
}

/* ============================== ZIP 打包 ============================== */
function buildZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.path, 'utf8');
    const comp = deflateRawSync(f.data, { level: 9 });
    const crc = crc32(f.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    locals.push(Buffer.concat([lh, name, comp]));

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(f.data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([ch, name]));
    offset += lh.length + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

/* ============================== 组装 ============================== */
function main() {
  // 1) content.js = 引擎 + 内容脚本主体
  const engine = readFileSync(join(root, 'src', 'particles.js'), 'utf8');
  const main = readFileSync(join(extDir, 'src', 'content-main.js'), 'utf8');
  const content = engine + '\n' + main;
  writeFileSync(join(extDir, 'content.js'), content);

  // 2) 图标
  const iconDir = join(extDir, 'icons');
  mkdirSync(iconDir, { recursive: true });
  for (const s of [16, 32, 48, 128]) {
    writeFileSync(join(iconDir, `icon${s}.png`), drawIcon(s));
  }

  // 3) 打包
  const files = [
    ['manifest.json', readFileSync(join(extDir, 'manifest.json'), 'utf8')],
    ['content.js', content]
  ];
  for (const f of ['popup/popup.html', 'popup/popup.css', 'popup/popup.js']) {
    files.push([f, readFileSync(join(extDir, f), 'utf8')]);
  }
  for (const s of [16, 32, 48, 128]) {
    files.push([`icons/icon${s}.png`, readFileSync(join(iconDir, `icon${s}.png`))]);
  }

  mkdirSync(releaseDir, { recursive: true });
  const zipName = `particle-background-v${VERSION}.zip`;
  const zip = buildZip(files.map((f) => ({ path: f[0], data: Buffer.from(f[1]) })));
  writeFileSync(join(releaseDir, zipName), zip);

  console.log('[build-extension] 已生成:');
  console.log('  ' + join(extDir, 'content.js') + '  (' + content.length + ' bytes)');
  console.log('  ' + join(iconDir, 'icon{16,32,48,128}.png'));
  console.log('  ' + join(releaseDir, zipName) + '  (' + zip.length + ' bytes)');
  console.log('[build-extension] 安装方式: 浏览器 chrome://extensions → 开发者模式 → 加载已解压的扩展程序（选 extension 目录）；');
  console.log('                或直接拖入 release/' + zipName + '（.crx 需打包，见 README）。');
}

main();
