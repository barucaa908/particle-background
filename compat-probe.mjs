#!/usr/bin/env node
/**
 * 临时诊断脚本：验证粒子引擎的适配性疑点（用完即删）
 * 1) dispose 后是否恢复被透明化的容器背景
 * 2) mount() 再次调用（不同参数）是否被忽略
 * 3) 重复挂载/卸载是否残留
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const engine = readFileSync(join(here, 'src', 'particles.js'), 'utf8');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser = existsSync(EDGE) ? EDGE : 'C:\\Users\\李宪泽\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const HTTP_PORT = 9454;
const CDP_PORT = 9455;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HTML = `<!doctype html>
<html>
<head><meta charset="utf-8"><style>
  html, body { margin: 0; }
  body { background: #151517; color: #fff; }
  .wrap { background: #151517; min-height: 100vh; padding: 40px; }
</style></head>
<body><div class="wrap"><h1>probe</h1></div></body>
</html>`;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(HTML);
});
await new Promise((r) => server.listen(HTTP_PORT, '127.0.0.1', r));

let proc;
let ws;
try {
  proc = spawn(browser, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${process.env.TEMP}\\dsh-probe-${CDP_PORT}`,
    `http://127.0.0.1:${HTTP_PORT}/`
  ], { stdio: 'ignore', windowsHide: true });

  let list;
  for (let i = 0; i < 60; i++) {
    try {
      list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      if (list.length) break;
    } catch { /* retry */ }
    await sleep(250);
  }
  const page = list.find((t) => t.type === 'page' && t.url.includes('127.0.0.1'));
  if (!page) throw new Error('no page target');

  ws = new WebSocket(page.webSocketDebuggerUrl);
  let msgId = 0;
  const pending = new Map();
  const send = (method, params) => new Promise((resolve, reject) => {
    const mid = ++msgId;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    }
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  await send('Runtime.enable');
  await sleep(1000);

  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      return { __error: r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails) };
    }
    return r.result.value;
  };

  // 注入引擎
  await evalJs(engine);
  const boot = await evalJs(`(() => {
    window.__probe = { mode: null, dispose: null };
    const d1 = DSH_Particles.mount({ mode: 'behind', transparentize: true });
    window.__probe.dispose = d1;
    return { mounted: !!DSH_Particles, fn: typeof d1 };
  })()`);
  console.log('boot:', JSON.stringify(boot));
  await sleep(300); // 等 0ms/600ms 定时扫描

  const afterMount = await evalJs(`(() => {
    const wrap = document.querySelector('.wrap');
    const canvas = document.getElementById('dsh-particle-canvas');
    return {
      wrapInline: wrap.style.background,
      wrapComputed: getComputedStyle(wrap).backgroundColor,
      canvasZ: canvas ? getComputedStyle(canvas).zIndex : null,
      styleInjected: !!document.getElementById('dsh-particle-style'),
      bodyBg: getComputedStyle(document.body).backgroundColor
    };
  })()`);
  console.log('afterMount:', JSON.stringify(afterMount));

  // 第二次 mount（不同参数）应返回 dispose 且不生效 —— 记录行为
  const second = await evalJs(`(() => {
    const before = getComputedStyle(document.getElementById('dsh-particle-canvas')).zIndex;
    const ret = DSH_Particles.mount({ mode: 'overlay', zIndex: 999 });
    const after = getComputedStyle(document.getElementById('dsh-particle-canvas')).zIndex;
    return { before, after, returnsDispose: ret === window.__probe.dispose };
  })()`);
  console.log('secondMount:', JSON.stringify(second));

  // 卸载
  const disposed = await evalJs(`(() => {
    const wrap = document.querySelector('.wrap');
    const r = window.__probe.dispose();
    return { returned: typeof r };
  })()`);
  await sleep(300);
  const afterDispose = await evalJs(`(() => {
    const wrap = document.querySelector('.wrap');
    return {
      wrapInline: wrap.style.background,
      wrapComputed: getComputedStyle(wrap).backgroundColor,
      canvasGone: !document.getElementById('dsh-particle-canvas'),
      styleGone: !document.getElementById('dsh-particle-style')
    };
  })()`);
  console.log('afterDispose:', JSON.stringify(afterDispose));
  console.log('disposed:', JSON.stringify(disposed));

  // 卸载后重挂载（overlay）应正常
  const remount = await evalJs(`(() => {
    const h = DSH_Particles.mount({ mode: 'overlay' });
    const canvas = document.getElementById('dsh-particle-canvas');
    const z = canvas ? getComputedStyle(canvas).zIndex : null;
    h();
    return { z, ok: typeof h === 'function' };
  })()`);
  console.log('remountOverlay:', JSON.stringify(remount));
} finally {
  if (ws) try { ws.close(); } catch { /* ignore */ }
  if (proc) proc.kill();
  server.close();
}
