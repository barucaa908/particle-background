#!/usr/bin/env node
/**
 * install-now.js —— 把粒子背景即时注入到正在运行的 DSH Web GUI
 * ------------------------------------------------------------
 * 原理：dsh 的 frontend-static 每次请求都会从磁盘重读 dist/index.html，
 * 因此只需：
 *   1) 把 src/particles.js 生成 dist/assets/dsh-particles.js（经典脚本 + 自动挂载）
 *   2) 在 dist/index.html 的 <head> 里加一行 <script defer ...>
 * 刷新浏览器页面（建议 Ctrl+F5）即生效，无需重启 dsh web、不会中断会话。
 *
 * 用法：
 *   node install-now.js            # 安装 / 更新（幂等，重复执行安全）
 *   node install-now.js --uninstall  # 卸载（移除脚本标签与资产文件）
 *
 * 注意：DSH 升级（重装 dsh-web-frontend）会覆盖 dist，届时重跑本脚本即可。
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const UNINSTALL = process.argv.includes('--uninstall');

const ASSET_NAME = 'dsh-particles.js';
const TAG_RE = /<!-- dsh-particles -->\s*<script defer src="\/assets\/dsh-particles\.js\?v=[^"]*"><\/script>\s*/;

function distDir() {
  const p = join(homedir(), '.dsh', 'profiles', 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist');
  if (!existsSync(join(p, 'index.html'))) {
    throw new Error('找不到 dsh-web-frontend/dist（期望路径: ' + p + '）。确认 dsh web 正在运行且 profile 位于 ~/.dsh/profiles。');
  }
  return p;
}

function autoMountSnippet() {
  return `
/* dsh-particles 自动挂载（dist 直载路径） */
(function () {
  var mount = function () {
    var h = window.DSH_Particles && window.DSH_Particles.mount();
    console.log('[dsh-particles] 粒子背景已挂载（Ctrl+F5 可刷新，F12 查看报错）');
    return h;
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
`;
}

function main() {
  const dist = distDir();
  const indexPath = join(dist, 'index.html');
  const assetPath = join(dist, 'assets', ASSET_NAME);
  let html = readFileSync(indexPath, 'utf8');

  if (UNINSTALL) {
    if (TAG_RE.test(html)) {
      html = html.replace(TAG_RE, '');
      writeFileSync(indexPath, html);
    }
    if (existsSync(assetPath)) rmSync(assetPath);
    console.log('[install-now] 已卸载：移除脚本标签与 ' + assetPath);
    console.log('[install-now] 刷新页面后粒子背景将不再加载。');
    return;
  }

  const engine = readFileSync(join(here, 'src', 'particles.js'), 'utf8');
  const version = Date.now();
  const bundle = engine + '\n' + autoMountSnippet();

  writeFileSync(assetPath, bundle);

  const tag = `<!-- dsh-particles --><script defer src="/assets/${ASSET_NAME}?v=${version}"></script>`;
  if (TAG_RE.test(html)) {
    html = html.replace(TAG_RE, tag);
  } else {
    html = html.replace('</head>', '  ' + tag + '\n  </head>');
  }
  writeFileSync(indexPath, html);

  console.log('[install-now] 已写入: ' + assetPath);
  console.log('[install-now] 已更新: ' + indexPath);
  console.log('[install-now] 完成！在浏览器里 Ctrl+F5 刷新 http://127.0.0.1:3080 即可看到粒子背景。');
}

try {
  main();
} catch (err) {
  console.error('[install-now] 失败: ' + err.message);
  process.exit(1);
}
