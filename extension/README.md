# 粒子背景 · 浏览器扩展（Chrome / Edge / Firefox）

给任意网页加上星座连线粒子背景：粒子网络、星云光晕、星尘闪烁、鼠标交互。
主题自适应（深色/浅色页面自动配色），不遮挡任何操作，可逐站开关。

## 安装方式（给用户）

### 方式一：加载已解压的扩展（推荐开发/内测）

1. 下载源码，进入 `extension/` 目录（含 `manifest.json` 的目录）
2. 打开浏览器：Chrome 地址栏输入 `chrome://extensions`（Edge 用 `edge://extensions`）
3. 右上角打开 **开发者模式**
4. 点击 **加载已解压的扩展程序**，选择 `extension/` 目录
5. 完成，去任意网页看看效果（点工具栏图标可调设置）

### 方式二：直接安装 zip（Chrome 137+ / Edge）

- 把 `../release/particle-background-v1.0.2.zip` **直接拖进** `chrome://extensions` 页面
  （需要开发者模式）即可安装
- 命令行方式：`chrome --load-extension="...\extension"`（注意：品牌版 Chrome 137+
  已屏蔽命令行加载，请用手动方式或 Edge）

### 方式三：上架商店（给所有人一键安装）

**Chrome Web Store（需 $5 一次性开发者注册费）：**
1. 访问 https://chrome.google.com/webstore/devconsole 注册开发者账号（$5）
2. 点"添加新项目"，上传 `../release/particle-background-v1.0.2.zip`
3. 填写商店信息：名称、描述、截图（1280×800 至少 1 张）、分类、语言
4. 提交审核（通常 1~3 天），通过后任何人搜索"粒子背景"即可安装

**Edge 加载项（免费，无需开发者费用）：**
1. 访问 https://partner.microsoft.com/dashboard/microsoftedge 注册开发者
2. 上传同一份 zip，填写信息提交审核

**Firefox：** manifest 已含 `browser_specific_settings.gecko.id`，
到 https://addons.mozilla.org 提交即可。

## 使用

点击工具栏图标打开控制面板：

| 项 | 说明 |
| --- | --- |
| 开关 | 全局启用/停用 |
| 模式 | 自动（深色纯色页面→背景模式，其余→浮层模式）/ 背景（粒子在内容下方）/ 浮层（粒子悬浮在上方，任何网站安全） |
| 密度 | 0.5× ~ 2× |
| 配色 | 蓝 / 紫 / 青 / 白 / 绿 |
| 特效 | 连线 / 星云 / 星尘 / 流星 / 鼠标交互 |
| 在此网站停用 | 只对当前网站关闭（存于本地） |

设置通过 `chrome.storage.sync` 存储，登录 Chrome 账号会自动同步。

## 权限说明

- `storage`：保存设置与逐站停用列表
- `<all_urls>`：内容脚本在所有网页注入粒子层
- 无网络请求、无数据收集

## 目录结构

```
extension/
├── manifest.json          MV3 清单
├── content.js             内容脚本（引擎 + 控制逻辑，由构建脚本生成）
├── src/content-main.js    控制逻辑源码（设置、模式解析、挂载/卸载）
├── popup/                 工具栏控制面板
└── icons/                 图标（程序化生成）
```

## 开发 / 构建

```bash
node build-extension.js     # 重新生成 content.js + 图标 + release zip
node test-extension.mjs     # 无头/最小化浏览器端到端实测（自动选 Edge）
node screenshot-extension.mjs  # 生成 1280×800 商店上架截图（release/screenshots/）
```

引擎源码在 `../src/particles.js`，与 DeepSeek Harness GUI 内置版共用同一份代码，
改引擎后重跑 `build-extension.js` 即可。

## 已知限制

- 品牌版 Chrome 137+ 屏蔽了 `--load-extension` 命令行加载，测试脚本自动改用 Edge；
  用户安装请用"加载已解压的扩展程序"或商店安装。
- DeepSeek Harness 页面自身已内置粒子背景，扩展在该页面自动跳过，避免双重挂载。
