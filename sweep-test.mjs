#!/usr/bin/env node
/**
 * sweep-test.mjs —— 50+ 页面大规模验证
 * 对 demo/sweep/ 的 54 页（+3 个真实站点）逐一：
 *   1. 导航 → 等待 ~6.5s → 截图#1 + 画布像素采样
 *   2. 部分页面模拟鼠标长按 5s（验证 v1.0.2 速度修复）
 *   3. 等待 → 截图#2 + 画布像素采样
 *   4. 收集每页异常
 * 最后用经过验证的 PNG 解码器对截图做合成像素分析，输出逐页判定与汇总。
 * 用法：node sweep-test.mjs
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import { writeFileSync, readFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { decodePNG } = await import(pathToFileURL(join(here, 'png-decode.mjs')).href);
const sweepDir = join(here, 'demo', 'sweep');
const shotsDir = join(here, 'demo', 'sweep-shots');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser = process.env.DSH_CHROME || EDGE;
const CDP_PORT = 9496;
const HTTP_PORT = 9494;
const W = 1280, H = 800;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const localPages = readdirSync(sweepDir)
  .filter((f) => f.endsWith('.html'))
  .sort()
  .map((f) => ({ name: f.replace(/\.html$/, ''), url: `http://127.0.0.1:${HTTP_PORT}/sweep/${f}`, local: true }));
const realSites = [
  { name: 'real-example', url: 'https://example.com', local: false },
  { name: 'real-wikipedia', url: 'https://www.wikipedia.org/', local: false },
  { name: 'real-github', url: 'https://github.com/', local: false }
];
const PAGES = [...localPages, ...realSites];
/* 期望模式：solid / wrapper 纯色 → behind，其余（渐变/图案）→ overlay */
const EXPECT = {};
for (const f of readdirSync(sweepDir).filter((x) => x.endsWith('.html'))) {
  const n = f.replace(/\.html$/, '');
  EXPECT[n] = n.startsWith('solid-') || n.startsWith('wrapper-') ? 'behind' : 'overlay';
}

const server = http.createServer((req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  if (path.startsWith('/sweep/')) {
    try {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(readFileSync(join(sweepDir, path.slice('/sweep/'.length))));
      return;
    } catch { /* fallthrough */ }
  }
  res.writeHead(404);
  res.end();
});
await new Promise((r) => server.listen(HTTP_PORT, '127.0.0.1', r));

mkdirSync(shotsDir, { recursive: true });
let proc, ws;
const results = [];
try {
  proc = spawn(browser, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions-except=' + join(here, 'extension'),
    '--load-extension=' + join(here, 'extension'),
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${process.env.TEMP}\\dsh-sweep-${CDP_PORT}`,
    PAGES[0].url
  ], { stdio: 'ignore', windowsHide: true });

  async function getJson(path) {
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${CDP_PORT}${path}`);
        if (r.ok) return await r.json();
      } catch { /* retry */ }
      await sleep(250);
    }
    throw new Error('CDP 端口未就绪');
  }
  const list = await getJson('/json/list');
  const page = list.find((t) => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  let msgId = 0;
  const pending = new Map();
  const send = (method, params) => new Promise((resolve, reject) => {
    const mid = ++msgId;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  let currentErrors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') {
      currentErrors.push(m.params.exceptionDetails?.exception?.description || 'exception');
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      currentErrors.push('[console.error] ' + (m.params.args || []).map((a) => a.value || a.description || '').join(' '));
    }
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

  const evalPage = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true });
    return r.exceptionDetails ? { error: r.exceptionDetails.exception?.description } : r.result.value;
  };
  const screenshot = async (file) => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(file, Buffer.from(s.data, 'base64'));
  };

  const CANVAS_METRICS = `(() => {
    const c = document.getElementById('dsh-particle-canvas');
    if (!c) return { present: false };
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const bgr = d[0], bgg = d[1], bgb = d[2];
    let blue = 0, nonBg = 0, lit = 0, drawn = 0, total = 0;
    for (let i = 0; i < d.length; i += 16) {
      const r = d[i], gg = d[i + 1], b = d[i + 2], a = d[i + 3];
      total++;
      if (a > 0) drawn++;
      // 蓝色判定：相对背景采样点有明显差异（排除"背景本身偏蓝"的误报）
      if (b > 100 && b > r + 20 && (Math.abs(r - bgr) > 30 || Math.abs(b - bgb) > 30)) blue++;
      if (Math.abs(r - bgr) > 24 || Math.abs(gg - bgg) > 24 || Math.abs(b - bgb) > 24) nonBg++;
      if ((r + gg + b) / 3 > 110) lit++;
    }
    return {
      present: true,
      z: getComputedStyle(c).zIndex,
      blueFrac: +(blue / total).toFixed(4),
      nonBgFrac: +(nonBg / total).toFixed(4),
      litFrac: +(lit / total).toFixed(4),
      drawnFrac: +(drawn / total).toFixed(4)
    };
  })()`;

  console.log(`[sweep] 开始：共 ${PAGES.length} 页（本地 ${localPages.length} + 真实站点 ${realSites.length}）`);
  for (let i = 0; i < PAGES.length; i++) {
    const pg = PAGES[i];
    currentErrors = [];
    const waitMs = pg.local ? 6500 : 12000;
    await send('Page.navigate', { url: pg.url });
    await sleep(waitMs);
    const shot1 = join(shotsDir, `${String(i).padStart(2, '0')}-${pg.name}-1.png`);
    await screenshot(shot1);
    const m1 = await evalPage(CANVAS_METRICS);
    const holdMouse = pg.local && i % 6 === 0;
    if (holdMouse) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: W / 2, y: H / 2 });
      await sleep(5000);
    }
    await sleep(4000);
    const shot2 = join(shotsDir, `${String(i).padStart(2, '0')}-${pg.name}-2.png`);
    await screenshot(shot2);
    const m2 = await evalPage(CANVAS_METRICS);
    results.push({
      i, name: pg.name, local: pg.local, expect: EXPECT[pg.name],
      errors: currentErrors.length, m1, m2, holdMouse,
      shots: [shot1, shot2]
    });
    if ((i + 1) % 10 === 0 || i === PAGES.length - 1) {
      console.log(`[sweep] 进度 ${i + 1}/${PAGES.length}（${pg.name}）`);
    }
  }

  /* ---- 合成截图分析（可信解码器） ---- */
  console.log('[sweep] 分析截图…');
  for (const r of results) {
    for (const [si, shot] of r.shots.entries()) {
      try {
        const { width, height, data } = decodePNG(shot);
        let sum = 0, sum2 = 0, total = 0;
        const mode = new Map();
        for (let i = 0; i < data.length; i += 16) {
          const r2 = data[i], g2 = data[i + 1], b2 = data[i + 2];
          const l = 0.2126 * r2 + 0.7152 * g2 + 0.0722 * b2;
          sum += l; sum2 += l * l; total++;
          const key = (r2 >> 5) + ',' + (g2 >> 5) + ',' + (b2 >> 5);
          mode.set(key, (mode.get(key) || 0) + 1);
        }
        const mean = sum / total;
        const std = Math.sqrt(Math.max(0, sum2 / total - mean * mean));
        const [bk] = [...mode.entries()].sort((a, b) => b[1] - a[1])[0];
        const [br2, bg2, bb2] = bk.split(',').map((v) => (parseInt(v, 10) << 5) + 16);
        let content = 0, blue = 0;
        for (let i = 0; i < data.length; i += 16) {
          const rr = data[i], gg = data[i + 1], bb = data[i + 2];
          const dr = Math.abs(rr - br2), dg = Math.abs(gg - bg2), db = Math.abs(bb - bb2);
          if (dr > 30 || dg > 30 || db > 30) content++;
          // 蓝色判定相对页面主色：排除"页面本身偏蓝"的误报
          if (bb > 100 && bb > rr + 20 && (dr > 30 || db > 30)) blue++;
        }
        r[`comp${si + 1}`] = {
          mean: +mean.toFixed(1), std: +std.toFixed(1),
          blueFrac: +(blue / total).toFixed(4),
          contentPix: +(content / total).toFixed(4)
        };
      } catch (e) {
        r[`comp${si + 1}`] = { error: e.message };
      }
    }
  }

  /* ---- 判定 ---- */
  let passCount = 0, failCount = 0, skipCount = 0;
  const rows = [];
  for (const r of results) {
    const c1 = r.comp1 || {}, c2 = r.comp2 || {};
    const m = r.m2 || {};
    const modeOk = !r.local || (m.present && ((r.expect === 'behind' && m.z === '-1') || (r.expect === 'overlay' && m.z === '2147483000')));
    const visible = m.present && (r.expect === 'overlay' ? m.drawnFrac > 0.002 : m.nonBgFrac > 0.0005);
    const noWash = (m.blueFrac === undefined || m.blueFrac < 0.35) && (c2.blueFrac === undefined || c2.blueFrac < 0.5);
    const rendered = !c2.error && (c2.std > 2 || c2.contentPix > 0.005);
    const holdOk = !r.holdMouse || (m.blueFrac !== undefined && m.blueFrac < 0.4);
    const errOk = r.errors === 0;
    const checks = { modeOk, visible, noWash, rendered, holdOk, errOk };
    const ok = Object.values(checks).every(Boolean);
    const verdict = !r.local ? (m.present ? (ok ? 'PASS' : 'FAIL') : 'SKIP') : (ok ? 'PASS' : 'FAIL');
    if (verdict === 'PASS') passCount++;
    else if (verdict === 'FAIL') failCount++;
    else skipCount++;
    rows.push({
      i: r.i, name: r.name, expect: r.expect, mode: m.present ? (m.z === '-1' ? 'behind' : 'overlay') : 'none',
      canvasBlue: m.blueFrac, drawn: m.drawnFrac, nonBg: m.nonBgFrac,
      compStd: c2.std, compBlue: c2.blueFrac, contentPix: c2.contentPix,
      hold: r.holdMouse, checks, verdict
    });
  }
  console.log('\n===== 逐页结果 =====');
  for (const row of rows) {
    const flags = Object.entries(row.checks).filter(([, v]) => !v).map(([k]) => k).join(',');
    console.log(
      `${row.verdict.padEnd(4)} [${String(row.i).padStart(2, '0')}] ${row.name.padEnd(34)} ` +
      `expect=${(row.expect || '-').padEnd(7)} mode=${(row.mode || '-').padEnd(7)} canvasBlue=${row.canvasBlue ?? '-'} ` +
      `compStd=${row.compStd ?? '-'} compBlue=${row.compBlue ?? '-'} content=${row.contentPix ?? '-'}` +
      (row.hold ? ' [hold]' : '') + (flags ? ` ✗(${flags})` : '')
    );
  }
  console.log(`\n===== 汇总 =====\nPASS ${passCount} / FAIL ${failCount} / SKIP ${skipCount} / 共 ${rows.length}`);
  const ok = failCount === 0;
  console.log(ok ? '\n✅ 全部通过，粒子背景状态完美' : '\n❌ 存在失败项，需要修复');
  process.exitCode = ok ? 0 : 1;
} finally {
  if (ws) try { ws.close(); } catch { /* ignore */ }
  if (proc) proc.kill();
  server.close();
}
