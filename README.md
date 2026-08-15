# 粒子背景 · Particle Background

> ⭐ **浏览器扩展版（任何人可用）**：Chrome / Edge / Firefox 上安装后，
> 任何网页都能有星座连线粒子背景。安装包在 `release/particle-background-v1.0.3.zip`
> （拖进 `chrome://extensions` 即装），或上架商店。控制面板见 `extension/README.md`。
>
> 🧩 **DeepSeek Harness 内置版**：给 DSH Web GUI（http://127.0.0.1:3080）
> 美化界面，无需重启、刷新即生效（见下文"方式一"）。

星座连线粒子网络 + 星云光晕 + 星尘 + 流星 + 鼠标/触摸交互，自动适配深色/浅色主题。

![效果说明] 深色主题下：粒子缓慢漂移、近距离自动连线（DeepSeek 品牌蓝）；
鼠标（或手指）移入时周围粒子被吸引并向光标连线，光标处有光晕，偶尔有流星划过。

---

## 目录结构

```
DSH粒子背景/
├── src/
│   └── particles.js      # 粒子引擎（唯一事实来源，零依赖，纯浏览器 JS）
├── plugin/
│   ├── package.json      # 标准 DSH client 插件清单（dsh.client 声明）
│   ├── client.js         # 生成的客户端 bundle（__ModuleLoader__.load 格式）
│   └── lib/index.js      # 生成的服务端最小入口（no-op cordis 插件）
├── extension/            # 浏览器扩展（Chrome / Edge / Firefox，别人也能下载）
│   ├── manifest.json     # MV3 清单
│   ├── content.js        # 内容脚本（引擎 + 控制逻辑，构建生成）
│   ├── popup/            # 工具栏控制面板（开关/模式/密度/配色/特效/逐站停用）
│   ├── icons/            # 图标（程序化生成）
│   └── README.md         # 安装/上架说明
├── build-plugin.js       # 由 src/particles.js 重新生成 plugin/ 产物
├── build-extension.js    # 生成扩展 content.js + 图标 + release zip
├── install-now.js        # 即时注入脚本（打补丁到运行中的 dist，无需重启）
├── inspect-dom.mjs       # 调试工具：无头浏览器抓取 GUI 渲染 DOM
├── test-extension.mjs    # 端到端实测扩展（自动选 Edge）
├── generate-pages.mjs    # 生成 54 页多样化验证页面（demo/sweep/）
├── sweep-test.mjs        # 50+ 页面大规模验证：逐页等待/截图/像素分析/异常捕获
├── test-loop.mjs         # 粒子运动循环确定性测试（速度不发散回归）
├── png-decode.mjs        # 标准 PNG 解码器（截图像素分析，已与 System.Drawing 交叉验证）
├── screenshot-extension.mjs # 生成商店上架截图（Edge headless + 扩展）
├── demo/                 # 截图用的演示页面（深色看板/浅色博客/深色落地页）
├── release/              # 打包好的扩展 zip + 上架截图
└── README.md
```

---

## 浏览器扩展（给所有人用）

同一套引擎也能打包成浏览器扩展，在**任何网页**上显示粒子背景，
控制面板支持：全局开关、背景/浮层两种模式、密度、五种配色、特效开关、
逐站停用，设置可云同步。**实测通过**（Edge 端到端验证注入成功）。

- 自己用：`chrome://extensions` → 开发者模式 → 加载已解压的扩展 → 选 `extension/` 目录
- 分发：`release/particle-background-v1.0.3.zip` 可拖入安装，或上架
  Chrome Web Store / Edge 加载项 / Firefox AMO（详细步骤见 `extension/README.md`）
- 重新构建：`node build-extension.js`；端到端测试：`node test-extension.mjs`

---

## 方式一：即时注入（已执行，刷新即生效，无需重启）

`dsh` 的 `frontend-static` 每次请求都从磁盘重读 `dist/index.html`，所以改 dist
不重启也生效：

```bash
node install-now.js            # 安装 / 更新（幂等）
node install-now.js --uninstall # 卸载
```

安装后浏览器 **Ctrl+F5** 刷新 http://127.0.0.1:3080 即可看到粒子背景。
F12 控制台会打印 `[dsh-particles] 粒子背景已挂载`。

> 注意：DSH 升级（重装 `dsh-web-frontend`）会覆盖 dist，之后重跑一次
> `node install-now.js` 即可恢复。

## 方式二：标准 DSH 客户端插件（可随 profile 长期存在）

如果希望粒子背景成为 profile 的正式插件（升级后依然存在），按下面步骤：

```bash
# 1) 重新生成插件产物（引擎改动后也要重跑）
node build-plugin.js

# 2) 安装到 web profile（在 profile 目录里 pnpm add 本地包）
cd ~/.dsh/profiles/web
pnpm add "file:E:\我的项目\DSH粒子背景\plugin"
# 或使用 dsh 的插件命令（本质就是 pnpm 转发）：
# dsh plugin --profile web add "file:E:\我的项目\DSH粒子背景\plugin"

# 3) 在 ~/.dsh/profiles/web/cordis.patch.yml 中追加一行 roster（注意是数组元素）：
#    - insert:
#        - id: particle-bg
#          name: 'dsh-particle-background'

# 4) 重启 dsh web（新插件条目只有重启后才会进入 Loader）
dsh web
```

重启后 `window.__DSH_BOOT__` 会多出一条
`/plugins/dsh-particle-background/client.js`，浏览器运行时动态加载并挂载粒子层。

---

## 配置（src/particles.js 顶部的 CONFIG）

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `maxParticles` | 130 | 星座粒子数上限（按屏幕面积自适应缩放） |
| `linkDistance` | 130 | 粒子连线最大距离（px） |
| `lineOpacity` | 0.20 | 连线最大不透明度 |
| `dotOpacity` | 0.90 | 粒子点不透明度 |
| `twinkle` | true | 粒子闪烁 |
| `starfield` | true | 星尘层开关 |
| `nebula` | true | 星云光晕开关 |
| `shootingStars` | true | 流星开关（斜向划过、渐隐亮尾） |
| `shootingInterval` | 5200 | 流星平均间隔（ms） |
| `mouseRadius` | 170 | 鼠标影响半径（px） |
| `mouseAttract` | 0.07 | 鼠标吸引力 |
| `friction` | 0.99 | 鼠标交互时的每帧速度阻尼（防发散；值越大甩动感越强） |
| `maxSpeed` | 5.0 | 粒子最大速度（px/帧），有界版 v1.0.0：能甩出旋涡但不失控 |
| `mouseLineOpacity` | 0.42 | 光标-粒子连线不透明度 |
| `dprCap` | 2 | 设备像素比上限（性能） |

改完配置后重新执行：

```bash
node install-now.js     # 方式一
node build-plugin.js    # 方式二（如已走插件路线）
```

## 兼容性 / 行为说明

- **主题自适应**：读取 `--dsw-alias-bg-base`（背景）与 `--dsw-static-deepseek-450`
  （品牌蓝），监听 body 上 `data-ds-dark-theme` 属性的切换（带属性过滤与防抖，
  SPA 高频 DOM 变化不会卡顿），主题切换时自动换色；支持 hex/hsl/oklch 等现代
  颜色写法。
- **不干扰 UI**：canvas 位于内容层之下（`#root` 被抬到 `z-index:1`），
  `pointer-events: none`，不挡点击、不挡文本；浮层模式下绝不改动页面背景。
- **性能**：DPR 上限 2、粒子数按面积自适应、标签页隐藏自动暂停（rAF 语义）、
  `prefers-reduced-motion: reduce` 时退化为静态画面，且运行中切换系统动效
  设置会即时响应。
- **透明化外壳**：脚本会持续扫描 `#root` 全子树，把「覆盖视口 ≥ 60% 的
  不透明背景容器」（应用外壳、对话区等）以及「≥ 30% 且用主题底色填充的容器」
  设为透明，让粒子在主要内容区域透出；侧栏/输入条/气泡/弹窗等小块表面
  保持原样，不影响可读性。MutationObserver 持续兜底，应用晚挂载或
  React 重渲染导致的新容器也能及时处理。**卸载（dispose）或切换模式时会完整
  还原被透明化的背景**，不会在页面上留下副作用。空壳 `#root`（有 id 但无内容，
  如部分新闻站点）会自动回退到 body 扫描；带背景图的大容器不会被挖掉。
- **重配置**：运行中再次调用 `mount(options)` 会停止旧实例并按新参数重挂载
  （模式/密度/配色等即时生效），同一页面由多个副本同时加载时只保留一个实例。
- **底色识别**：body/html 透明时，只把「接近中性色」的大容器认作页面底色；
  鲜艳的蓝色块不会让画布整屏变蓝。
- **浮层零拖尾**：浮层模式每帧清空画布，粒子与鼠标线不留残影，长时间停留
  也不会在页面上积出淡色薄雾。
- **粒子活性**：阻尼（防鼠标吸引失控）只在鼠标交互时生效，空闲时粒子保持
  自主漂移（带缓慢随机转向，幅度约 15~45 px/s），不会"冻成静态点"。

## 卸载

```bash
node install-now.js --uninstall   # 方式一：移除脚本标签 + 资产文件，刷新即恢复
# 方式二：dsh plugin --profile web remove dsh-particle-background，
#         并在 cordis.patch.yml 里删掉对应 roster 行，重启
```
