#!/usr/bin/env node
/**
 * screenshot-extension.mjs —— 生成商店上架截图素材
 * Edge headless + 扩展加载，对 demo/ 下的页面逐张截图（1280×800 PNG），
 * 输出到 release/screenshots/。用法：node screenshot-extension.mjs
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const extDir = join(here, 'extension');
const demoDir = join(here, 'demo');
const outDir = join(here, 'release', 'screenshots');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CHROME = 'C:\\Users\\李宪泽\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const browser = process.env.DSH_CHROME || (existsSync(EDGE) ? EDGE : CHROME);
const CDP_PORT = 9495;
const HTTP_PORT = 9494;
const W = 1280;
const H = 800;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGES = [
  ['dark-dashboard', 'dashboard-dark'],
  ['light-blog', 'blog-light'],
  ['dark-hero', 'hero-dark']
];

const server = http.createServer((req, res) => {
  const name = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '') || 'index.html';
  let data;
  try {
    data = readFileSync(join(demoDir, name));
  } catch {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(data);
});

await new Promise((r) => server.listen(HTTP_PORT, '127.0.0.1', r));

let proc;
let ws;
try {
  proc = spawn(browser, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions-except=' + extDir,
    '--load-extension=' + extDir,
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${process.env.TEMP}\\dsh-shot-${CDP_PORT}`,
    `http://127.0.0.1:${HTTP_PORT}/dark-dashboard.html`
  ], { stdio: 'ignore', windowsHide: true });

  async function getJson(path) {
    for (let i = 0; i < 60; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${CDP_PORT}${path}`);
        if (res.ok) return await res.json();
      } catch { /* retry */ }
      await sleep(250);
    }
    throw new Error('CDP 端口未就绪');
  }

  const list = await getJson('/json/list');
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('没有页面 target');

  ws = new WebSocket(page.webSocketDebuggerUrl);
  let msgId = 0;
  const pending = new Map();
  const send = (method, params) => new Promise((resolve, reject) => {
    const mid = ++msgId;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    }
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

  mkdirSync(outDir, { recursive: true });
  console.log('[shot] 浏览器已就绪，开始截图…');

  for (const [pageName, outName] of PAGES) {
    await send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/${pageName}.html` });
    await sleep(6500); // 等页面 + 粒子/星云进入状态（流星平均 5.2s 一颗）
    const check = await send('Runtime.evaluate', {
      expression: `!!document.getElementById('dsh-particle-canvas')`,
      returnByValue: true
    });
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const file = join(outDir, `${outName}.png`);
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
    console.log(`[shot] ${pageName}.html → ${file}  (粒子层: ${check.result.value ? '是' : '否'})`);
  }

  console.log('[shot] 完成。截图可用于商店上架（1280×800）。');
} finally {
  if (ws) try { ws.close(); } catch { /* ignore */ }
  if (proc) proc.kill();
  server.close();
}
