#!/usr/bin/env node
/**
 * png-decode.mjs —— 标准 PNG 解码（全部滤波类型），用于截图像素分析
 * 用法：node png-decode.mjs <file.png>  # 打印尺寸 + 若干采样点
 * 正确性以 System.Drawing 的已知采样值为基准验证过。
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

export function decodePNG(path) {
  const buf = readFileSync(path);
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');
  let off = 8, width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!width || !height) throw new Error('no IHDR');
  if (bitDepth !== 8) throw new Error('unsupported bit depth ' + bitDepth);
  if (colorType !== 6 && colorType !== 2) throw new Error('unsupported color type ' + colorType);

  const raw = inflateSync(Buffer.concat(idat));
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const px = new Uint8Array(width * height * 4);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  const prev = new Uint8Array(stride); // 上一行（源布局）
  const row = new Uint8Array(stride);  // 当前行（源布局）
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const rowStart = y * (stride + 1) + 1;
    for (let i = 0; i < stride; i++) {
      const xr = raw[rowStart + i];
      const a = i >= bpp ? row[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = xr;
      if (f === 1) v = xr + a;
      else if (f === 2) v = xr + b;
      else if (f === 3) v = xr + ((a + b) >> 1);
      else if (f === 4) v = xr + paeth(a, b, c);
      row[i] = v & 0xFF;
    }
    // 展开到 RGBA 输出
    const out = px.subarray(y * width * 4, (y + 1) * width * 4);
    if (bpp === 4) {
      out.set(row);
    } else {
      for (let j = 0; j < width; j++) {
        out[j * 4] = row[j * 3];
        out[j * 4 + 1] = row[j * 3 + 1];
        out[j * 4 + 2] = row[j * 3 + 2];
        out[j * 4 + 3] = 255;
      }
    }
    prev.set(row);
  }
  return { width, height, data: px };
}

/* 独立运行：打印采样点（用于与 System.Drawing 交叉验证） */
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  const { width, height, data } = decodePNG(process.argv[2]);
  console.log(`${process.argv[2]} -> ${width}x${height}`);
  const pts = [[100, 100], [400, 300], [640, 400]];
  for (const [x, y] of pts) {
    const o = (y * width + x) * 4;
    console.log(`(${x},${y}) = rgb(${data[o]},${data[o + 1]},${data[o + 2]})`);
  }
}
