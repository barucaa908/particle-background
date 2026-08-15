#!/usr/bin/env node
/**
 * generate-pages.mjs —— 生成 54 页多样化测试页（确定性种子，可复现）
 * 矩阵：6 种背景样式 × 3 种明暗主题 × 3 种布局 = 54 页，输出到 demo/sweep/
 * 用法：node generate-pages.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'demo', 'sweep');

/* 确定性 PRNG */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const THEMES = [
  { key: 'dark', bg: ['rgb(13,15,19)', 'rgb(23,26,33)'], text: '#e8ecf5', sub: '#9aa3b2', card: 'rgb(28,32,40)', line: '#2c303c' },
  { key: 'light', bg: ['rgb(246,247,250)', 'rgb(255,255,255)'], text: '#1a1d24', sub: '#5b6472', card: 'rgb(255,255,255)', line: '#e3e6ec' },
  { key: 'mid', bg: ['rgb(118,128,146)', 'rgb(140,150,168)'], text: '#10131a', sub: '#2a2f3a', card: 'rgb(150,160,178)', line: '#0f1220' }
];

/* 6 种背景样式：返回 { css, expectMode } */
function bgStyles(theme) {
  const [c1, c2] = theme.bg;
  return [
    { key: 'solid', css: `body{background:${c1}}`, expect: 'behind' },
    { key: 'linear', css: `body{background:linear-gradient(160deg,${c1},${c2})}`, expect: 'overlay' },
    { key: 'radial', css: `body{background:radial-gradient(circle at 30% 20%,${c1},${c2} 75%)}`, expect: 'overlay' },
    { key: 'multi', css: `body{background:linear-gradient(120deg,${c1} 0%,${c2} 45%,${c1} 100%)}`, expect: 'overlay' },
    { key: 'pattern', css: `body{background:repeating-linear-gradient(45deg,${c1} 0 14px,${c2} 14px 28px)}`, expect: 'overlay' },
    { key: 'wrapper', css: `body{background:transparent}.wrap{background:${c1};min-height:100vh}`, expect: 'behind' }
  ];
}

/* 3 种布局 */
function layoutArticle(t, rnd) {
  const paras = [];
  for (let i = 0; i < 6; i++) {
    paras.push(`<p>${(rnd() < 0.5 ? '星座连线的粒子背景是科技产品界面里最经典的氛围装饰之一：' : '粒子缓慢漂移，彼此靠近时自动连出细线，鼠标移过之处粒子微微靠拢。')}${(rnd() < 0.5 ? '它在视觉上属于加法中的减法——不抢内容，只给背景增加纵深与动感。' : '实现它的核心不过是一个全屏 canvas 和几十行几何计算，轻量且高效。')}</p>`);
  }
  return `
  <article class="wrap">
    <h1>给界面加一层会呼吸的星空</h1>
    <div class="meta">测试页 · 文章布局 · ${t.key} 主题</div>
    <h2>原理：距离即缘分</h2>
    ${paras.slice(0, 3).join('\n    ')}
    <pre>for (i = 0; i &lt; particles.length; i++)
  for (j = i + 1; j &lt; particles.length; j++)
    if (distSq(i, j) &lt; linkDist * linkDist)
      line(i, j, alpha = 1 - dist / linkDist);</pre>
    ${paras.slice(3).join('\n    ')}
    <blockquote>好的氛围装饰应该像呼吸一样自然：你看得见它，但从不觉得被打扰。</blockquote>
  </article>`;
}

function layoutDashboard(t, rnd) {
  const cards = [];
  for (let i = 0; i < 8; i++) {
    const v = Math.round(100 + rnd() * 9000);
    const up = rnd() < 0.7;
    cards.push(`<div class="card"><div class="k">指标 ${i + 1}</div><div class="v">${v.toLocaleString()}</div><div class="d ${up ? 'up' : 'down'}">${up ? '↑' : '↓'} ${(rnd() * 20).toFixed(1)}%</div></div>`);
  }
  const bars = [];
  for (let i = 0; i < 12; i++) bars.push(`<div class="b" style="height:${(20 + rnd() * 80).toFixed(0)}%"></div>`);
  return `
  <main class="wrap">
    <div class="topbar"><h1>数据概览</h1><div class="search">搜索…</div></div>
    <div class="cards">${cards.join('\n      ')}</div>
    <div class="panel"><h3>趋势</h3><div class="bars">${bars.join('')}</div></div>
  </main>`;
}

function layoutHero(t, rnd) {
  const feats = [];
  for (let i = 0; i < 3; i++) {
    feats.push(`<div class="f"><div class="ic"></div><h3>特性 ${i + 1}</h3><p>${rnd() < 0.5 ? '自动读取页面背景，深色浅色都恰到好处。' : '背景模式藏在内容之下，浮层模式对任何网站都安全。'}</p></div>`);
  }
  return `
  <div class="wrap hero">
    <div class="badge">✨ 星座粒子背景</div>
    <h1>让每个界面都有一片会呼吸的星空</h1>
    <div class="sub">星座连线、星云光晕、流星划过、鼠标交互——主题自适应，不遮挡操作。</div>
    <div class="cta"><a class="btn p">立即体验</a><a class="btn g">查看文档</a></div>
    <div class="feats">${feats.join('\n      ')}</div>
  </div>`;
}

const LAYOUTS = [
  { key: 'article', fn: layoutArticle },
  { key: 'dashboard', fn: layoutDashboard },
  { key: 'hero', fn: layoutHero }
];

function pageHtml(theme, bg, layout, rnd) {
  const t = theme;
  const accent = t.key === 'dark' ? '#5686fe' : '#3b5bd6';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${bg.key}-${theme.key}-${layout.key}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  ${bg.css}
  body { color: ${t.text}; font: 15px/1.8 -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
  .wrap { max-width: 960px; margin: 0 auto; padding: 48px 32px; }
  h1 { font-size: 30px; line-height: 1.35; margin-bottom: 10px; }
  h2 { font-size: 20px; margin: 28px 0 10px; }
  .meta { color: ${t.sub}; font-size: 13px; margin-bottom: 24px; }
  p { margin-bottom: 14px; color: ${t.text}; }
  pre { background: ${t.card}; color: ${t.key === 'light' ? '#333' : '#d6dce6'}; border-radius: 10px; padding: 14px 16px; font: 12px/1.6 ui-monospace, Consolas, monospace; margin: 16px 0; overflow-x: auto; }
  blockquote { border-left: 3px solid ${accent}; padding: 2px 0 2px 16px; color: ${t.sub}; margin: 18px 0; }
  .topbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
  .search { background: ${t.card}; border: 1px solid ${t.line}; border-radius: 9px; padding: 6px 14px; color: ${t.sub}; font-size: 13px; }
  .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
  .card { background: ${t.card}; border: 1px solid ${t.line}; border-radius: 11px; padding: 14px; }
  .card .k { color: ${t.sub}; font-size: 12px; }
  .card .v { font-size: 22px; font-weight: 700; margin-top: 4px; }
  .card .d { font-size: 12px; margin-top: 2px; }
  .card .d.up { color: #22a06b; } .card .d.down { color: #d64545; }
  .panel { background: ${t.card}; border: 1px solid ${t.line}; border-radius: 11px; padding: 16px; }
  .panel h3 { font-size: 14px; margin-bottom: 12px; }
  .bars { display: flex; align-items: flex-end; gap: 6px; height: 130px; }
  .bars .b { flex: 1; border-radius: 4px 4px 0 0; background: linear-gradient(180deg, ${accent}, ${t.key === 'light' ? '#9db4f0' : '#2b4fa8'}); }
  .hero { text-align: center; }
  .badge { display: inline-block; font-size: 13px; padding: 5px 14px; border-radius: 999px; border: 1px solid ${accent}; color: ${accent}; background: transparent; margin-bottom: 22px; }
  .hero h1 { font-size: 44px; margin-bottom: 14px; }
  .sub { color: ${t.sub}; font-size: 17px; margin-bottom: 30px; }
  .cta { display: flex; gap: 12px; justify-content: center; margin-bottom: 48px; }
  .btn { padding: 11px 28px; border-radius: 999px; font-weight: 600; text-decoration: none; }
  .btn.p { background: ${accent}; color: #fff; }
  .btn.g { border: 1px solid ${t.line}; color: ${t.text}; }
  .feats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
  .f { background: ${t.card}; border: 1px solid ${t.line}; border-radius: 12px; padding: 18px 16px; text-align: left; }
  .f .ic { width: 26px; height: 26px; border-radius: 8px; background: linear-gradient(135deg, ${accent}, #8b5cf6); margin-bottom: 10px; }
  .f h3 { font-size: 15px; margin-bottom: 4px; }
  .f p { color: ${t.sub}; font-size: 13px; line-height: 1.6; }
</style>
</head>
<body>
${layout.fn(t, rnd)}
</body>
</html>`;
}

mkdirSync(outDir, { recursive: true });
const rnd = mulberry32(20260815);
const pages = [];
for (const theme of THEMES) {
  const bgs = bgStyles(theme);
  for (const bg of bgs) {
    for (const layout of LAYOUTS) {
      pages.push({
        name: `${bg.key}-${theme.key}-${layout.key}`,
        file: join(outDir, `${bg.key}-${theme.key}-${layout.key}.html`),
        expect: bg.expect,
        html: pageHtml(theme, bg, layout, rnd)
      });
    }
  }
}
for (const p of pages) writeFileSync(p.file, p.html, 'utf8');
console.log(`[generate-pages] 已生成 ${pages.length} 页 -> ${outDir}`);
console.log('[generate-pages] 期望模式分布: behind ' + pages.filter(p => p.expect === 'behind').length + ' / overlay ' + pages.filter(p => p.expect === 'overlay').length);
