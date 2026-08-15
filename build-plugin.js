#!/usr/bin/env node
/**
 * build-plugin.js —— 由 src/particles.js 生成 DSH 客户端插件包
 * ------------------------------------------------------------
 * 产物：
 *   plugin/client.js      —— __ModuleLoader__.load 格式的客户端 bundle
 *   plugin/lib/index.js   —— 服务端（node 半区）最小 cordis 插件入口
 *
 * 用法：node build-plugin.js
 * 引擎改动后重跑一次即可重新生成，避免两份代码漂移。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const engine = readFileSync(join(here, 'src', 'particles.js'), 'utf8');

const PLUGIN_ID = 'dsh-particle-background';
const PLUGIN_NAME = 'particle-background';

const clientBundle = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(PLUGIN_ID)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
${engine
  .split('\n')
  .map((l) => '\t\t' + l)
  .join('\n')}
\t\tvar name = ${JSON.stringify(PLUGIN_NAME)};
\t\tvar inject = [];
\t\tfunction apply(ctx) {
\t\t\tctx.effect(() => {
\t\t\t\tvar mount = globalThis.DSH_Particles && globalThis.DSH_Particles.mount;
\t\t\t\tvar handle = mount ? mount() : null;
\t\t\t\treturn () => { if (handle) handle(); };
\t\t\t}, "particle-background: mount");
\t\t}
\t\texports.name = name;
\t\texports.apply = apply;
\t\texports.inject = inject;
\t\treturn module.exports;
\t}
});
`;

const nodeIndex = `// dsh-particle-background —— node 半区最小入口（host 侧无逻辑）
const name = ${JSON.stringify(PLUGIN_NAME)};
function apply() {}
export { name, apply };
`;

mkdirSync(join(here, 'plugin', 'lib'), { recursive: true });
writeFileSync(join(here, 'plugin', 'client.js'), clientBundle);
writeFileSync(join(here, 'plugin', 'lib', 'index.js'), nodeIndex);
console.log('[build-plugin] wrote plugin/client.js and plugin/lib/index.js');
