#!/usr/bin/env node
/**
 * inspect-dom.mjs —— 调试工具：用无头 Chrome + CDP 抓取 GUI 渲染后的 DOM 结构
 * 用途：排查「粒子背景被哪个元素盖住」这类渲染层级问题。
 * 用法：node inspect-dom.mjs [端口]   （默认 9333，用完自动退出并杀掉 Chrome）
 */
import { spawn } from 'node:child_process';

const chrome = process.env.DSH_CHROME ||
  'C:\\Users\\李宪泽\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const port = process.argv[2] || 9333;
const url = process.argv[3] || 'http://127.0.0.1:3080/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(chrome, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${process.env.TEMP}\\dsh-cdp-profile-${port}`,
  url
], { stdio: 'ignore', windowsHide: true });

let ws;
try {
  async function getJson(path) {
    for (let i = 0; i < 60; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}${path}`);
        if (res.ok) return await res.json();
      } catch { /* retry */ }
      await sleep(250);
    }
    throw new Error('CDP 端口未就绪');
  }

  const list = await getJson('/json/list');
  const page = list.find((t) => t.type === 'page' && t.url.includes('127.0.0.1'));
  if (!page) throw new Error('没有找到 GUI 页面 target: ' + JSON.stringify(list.map((t) => t.url)));

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
  console.error('[inspect] 已连接，等待应用挂载…');
  await sleep(8000);

  const expr = `(() => {
    const W = innerWidth, H = innerHeight;
    const opaque = [];
    const structure = [];
    const walk = (el, depth) => {
      if (depth > 12 || opaque.length > 300) return;
      if (depth <= 5) {
        const r0 = el.getBoundingClientRect();
        structure.push({
          d: depth,
          tag: el.tagName.toLowerCase(),
          id: el.id || undefined,
          cls: typeof el.className === 'string' ? el.className.slice(0, 90) : '',
          w: Math.round(r0.width), h: Math.round(r0.height),
          pos: getComputedStyle(el).position,
          z: getComputedStyle(el).zIndex,
          bg: getComputedStyle(el).backgroundColor
        });
      }
      const cs = getComputedStyle(el);
      const bg = cs.backgroundColor;
      const img = cs.backgroundImage;
      const rect = el.getBoundingClientRect();
      const cover = (rect.width * rect.height) / (W * H);
      const hasPaint = (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') || (img && img !== 'none');
      if (hasPaint && cover > 0.01 && cs.opacity !== '0') {
        opaque.push({
          d: depth,
          tag: el.tagName.toLowerCase(),
          id: el.id || undefined,
          cls: typeof el.className === 'string' ? el.className.slice(0, 90) : '',
          bg: bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)' ? 'none' : bg,
          img: img === 'none' ? '' : img.slice(0, 60),
          pos: cs.position,
          z: cs.zIndex,
          op: cs.opacity,
          coverPct: Math.round(cover * 100)
        });
      }
      for (const c of el.children) walk(c, depth + 1);
    };
    walk(document.body, 0);
    const canvas = document.getElementById('dsh-particle-canvas');
    const touched = [];
    for (const el of document.querySelectorAll('div,section,main,aside')) {
      if (el.style && el.style.background === 'transparent') {
        const r = el.getBoundingClientRect();
        touched.push({
          cls: typeof el.className === 'string' ? el.className.slice(0, 70) : '',
          w: Math.round(r.width), h: Math.round(r.height)
        });
      }
    }
    return {
      W, H,
      colorScheme: document.documentElement.style.colorScheme,
      darkAttr: document.body.getAttribute('data-ds-dark-theme'),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      canvasPresent: !!canvas,
      canvasZ: canvas ? getComputedStyle(canvas).zIndex : null,
      canvasBg: canvas ? getComputedStyle(canvas).backgroundColor : null,
      transparentized: touched,
      structure,
      opaque
    };
  })()`;

  const evaluate = async () => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.exceptionDetails) {
      console.error('[inspect] 页面内求值失败: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails));
      return null;
    }
    return r.result.value;
  };

  const screenshot = async (name) => {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    if (shot && shot.data) {
      const { writeFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const { homedir } = await import('node:os');
      const file = join(process.env.TEMP || homedir(), name + '.png');
      writeFileSync(file, Buffer.from(shot.data, 'base64'));
      console.error('[inspect] 截图已保存: ' + file);
    }
  };

  // 先看深色主题
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await sleep(1500);
  await screenshot('dsh-dark');
  console.log('===== DARK THEME =====');
  console.log(JSON.stringify(await evaluate(), null, 1));

  // 再看浅色主题
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await sleep(1500);
  await screenshot('dsh-light');
  console.log('===== LIGHT THEME =====');
  console.log(JSON.stringify(await evaluate(), null, 1));
} finally {
  if (ws) try { ws.close(); } catch { /* ignore */ }
  proc.kill();
  process.exit(0);
}
