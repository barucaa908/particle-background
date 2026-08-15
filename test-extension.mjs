#!/usr/bin/env node
/**
 * test-extension.mjs —— 无头 Chrome 实测扩展
 * 1) 本地起一个深色纯色背景的测试页
 * 2) 以 --load-extension 启动无头 Chrome 访问该页
 * 3) CDP 检查：粒子画布是否注入、z-index、body 透明化、大容器透明化
 * 4) 再访问 DSH GUI，确认扩展不重复挂载（画布唯一）
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const extDir = join(here, 'extension');
// 品牌版 Chrome(137+) 屏蔽了命令行 --load-extension，Edge 允许，优先用 Edge
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CHROME = 'C:\\Users\\李宪泽\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const chrome = process.env.DSH_CHROME ||
  (existsSync(EDGE) ? EDGE : CHROME);
const CDP_PORT = 9445;
const HTTP_PORT = 9444;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TEST_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>粒子背景扩展测试页</title>
  <style>
    html, body { margin: 0; }
    body { background: #151517; color: #e8ecf5; font-family: sans-serif; }
    .wrap { background: #151517; min-height: 100vh; padding: 40px; }
    h1 { color: #fff; } p { color: #9aa3b2; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Particle Background 扩展测试页</h1>
    <p>如果扩展生效：此处背景应为粒子层，本容器背景被透明化。</p>
  </div>
</body>
</html>`;

const GRADIENT_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>浮层模式测试页（渐变背景）</title>
  <style>
    html, body { margin: 0; height: 100%; }
    /* 无纯色背景 → 自动模式应解析为浮层模式 */
    body { background: linear-gradient(160deg, #10131c, #1d2438 55%, #0d1117); color: #e8ecf5; font-family: sans-serif; }
    main { padding: 60px; }
    h1 { color: #fff; } p { color: #9aa3b2; max-width: 640px; line-height: 1.8; }
  </style>
</head>
<body>
  <main>
    <h1>浮层模式 · 渐变背景页</h1>
    <p>本页无纯色背景，扩展应使用浮层模式：粒子悬浮在上方、低透明度、不遮文字，
    且不应注入 body 透明化样式。</p>
  </main>
</body>
</html>`;

/* 本地 HTTP 服务器 */
const server = http.createServer((req, res) => {
  const path = req.url.split('?')[0];
  const html = path.includes('gradient') ? GRADIENT_HTML : TEST_HTML;
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
});
await new Promise((r) => server.listen(HTTP_PORT, '127.0.0.1', r));

let chromeProc;
let ws;
try {
  chromeProc = spawn(chrome, [
    // 新版 Chrome headless 会忽略 --load-extension，必须用真实窗口（最小化启动）
    '--start-minimized',
    '--window-size=1280,800',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions-except=' + extDir,
    '--load-extension=' + extDir,
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${process.env.TEMP}\\dsh-ext-profile-${CDP_PORT}`,
    `http://127.0.0.1:${HTTP_PORT}/test.html`
  ], { stdio: 'ignore', windowsHide: false });

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
  const page = list.find((t) => t.type === 'page' && t.url.includes('127.0.0.1'));
  if (!page) throw new Error('没有找到测试页 target: ' + JSON.stringify(list.map((t) => t.url)));

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

  console.error('[test] 等待内容脚本注入…');
  await sleep(6000);

  const evalPage = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true });
    return r.exceptionDetails ? { error: r.exceptionDetails.exception?.description } : r.result.value;
  };

  /* 抓内容脚本异常 */
  let exceptions = [];
  const onMsg = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') {
      exceptions.push(m.params.exceptionDetails?.exception?.description || JSON.stringify(m.params.exceptionDetails));
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      exceptions.push('[console.error] ' + (m.params.args || []).map((a) => a.value || a.description || '').join(' '));
    }
  };
  ws.addEventListener('message', onMsg);

  /* 先看扩展是否加载成功 */
  await send('Page.navigate', { url: 'chrome://extensions/' });
  await sleep(4000);
  const extText = await evalPage('document.body.innerText.slice(0, 2000)');
  console.log('===== chrome://extensions =====');
  console.log(typeof extText === 'string' ? extText : JSON.stringify(extText, null, 1));

  /* 回到测试页 */
  await send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/test.html` });
  await sleep(7000);

  const state1 = await evalPage(`(() => {
    const canvas = document.getElementById('dsh-particle-canvas');
    const style = document.getElementById('dsh-particle-style');
    const wrap = document.querySelector('.wrap');
    return {
      canvasPresent: !!canvas,
      canvasZ: canvas ? getComputedStyle(canvas).zIndex : null,
      canvasBg: canvas ? getComputedStyle(canvas).backgroundColor : null,
      canvasCount: document.querySelectorAll('canvas').length,
      styleInjected: !!style,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      wrapBgInline: wrap ? wrap.style.background : null,
      wrapBgComputed: wrap ? getComputedStyle(wrap).backgroundColor : null
    };
  })()`);
  console.log('===== 测试页（自动模式 → 应解析为背景模式） =====');
  console.log(JSON.stringify(state1, null, 1));
  if (exceptions.length) {
    console.log('===== 捕获到的异常 =====');
    exceptions.slice(0, 10).forEach((e) => console.log('- ' + e));
  }

  /* 渐变背景页：自动模式应解析为浮层模式，不透明化 body，z-index 为最大值 */
  await send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/gradient.html` });
  await sleep(6000);
  const state3 = await evalPage(`(() => {
    const canvas = document.getElementById('dsh-particle-canvas');
    const style = document.getElementById('dsh-particle-style');
    return {
      canvasPresent: !!canvas,
      canvasZ: canvas ? getComputedStyle(canvas).zIndex : null,
      canvasBg: canvas ? getComputedStyle(canvas).backgroundColor : null,
      styleInjected: !!style,
      bodyBg: getComputedStyle(document.body).backgroundColor
    };
  })()`);
  console.log('===== 渐变背景页（自动模式 → 应解析为浮层模式） =====');
  console.log(JSON.stringify(state3, null, 1));

  /* 切到 DSH GUI：扩展应跳过（页面已有内置粒子层） */
  console.error('[test] 访问 DSH GUI 检查不重复挂载…');
  await send('Page.navigate', { url: 'http://127.0.0.1:3080/' });
  await sleep(8000);
  const state2 = await evalPage(`(() => ({
    canvasCount: document.querySelectorAll('canvas').length,
    hasParticleCanvas: !!document.getElementById('dsh-particle-canvas')
  }))()`);
  console.log('===== DSH GUI（扩展应跳过，不产生第二个画布） =====');
  console.log(JSON.stringify(state2, null, 1));

  const pass =
    state1.canvasPresent === true &&
    state1.canvasZ === '-1' &&
    state1.styleInjected === true &&
    state1.wrapBgInline === 'transparent' &&
    state3.canvasPresent === true &&
    state3.canvasZ === '2147483000' &&
    state3.styleInjected === false &&
    state2.canvasCount <= 1;
  console.log(pass ? '\n✅ 扩展实测通过' : '\n❌ 实测未通过，见上方输出');
  process.exitCode = pass ? 0 : 1;
} finally {
  if (ws) try { ws.close(); } catch { /* ignore */ }
  if (chromeProc) chromeProc.kill();
  server.close();
}
