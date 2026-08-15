window.__ModuleLoader__.load({
	id: "dsh-particle-background",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		/**
		 * dsh-particles —— 通用粒子背景引擎（DeepSeek Harness GUI / 浏览器扩展共用）
		 * -----------------------------------------------------------------------
		 * 特性：
		 *   · 星座连线粒子网络（粒子之间近距离自动连线）
		 *   · 星云光晕（品牌蓝 + 紫，缓慢漂移，Lissajous 轨迹）
		 *   · 微光星尘（细小星点闪烁，极缓漂移）
		 *   · 鼠标交互（光标附近粒子被吸引、连线、光晕）
		 *   · 两种渲染模式：
		 *       behind  —— 画布藏在内容层之下（z-index:-1），可透明化大背景容器
		 *       overlay —— 画布浮在页面上方（pointer-events:none），低透明度氛围层，
		 *                  对任何网站都安全、不影响布局
		 *   · 主题自适应（body/html 实际背景色 → 主题变量 → prefers-color-scheme）
		 *   · 性能友好（DPR 上限、按面积自适应粒子数、prefers-reduced-motion 降级、
		 *     页面隐藏自动暂停）
		 *
		 * 对外接口：globalThis.DSH_Particles = { mount, dispose, CONFIG }
		 *   mount(options?) -> disposer
		 *   options 覆盖 CONFIG（见 defaultCfg），另有：
		 *     mode: 'behind' | 'overlay'   （默认 'behind'）
		 *     density: 1                   粒子密度倍率
		 *     overlayAlpha: 0.55           overlay 模式全局透明度
		 *     zIndex: null                 显式画布 z-index
		 *     transparentize: true         behind 模式是否透明化大背景容器
		 *     root: null                   透明化扫描根元素（默认 #root 或 body）
		 *     palette: null                { dot, line, accent, nebula:[{c,a,s}] } 覆盖主题色
		 *
		 * 本文件是唯一事实来源：
		 *   · DSH：install-now.js 生成 dist/assets/dsh-particles.js（追加自动挂载）
		 *   · DSH 插件：build-plugin.js 包裹成 __ModuleLoader__.load bundle
		 *   · 浏览器扩展：build-extension.js 拼接 content 逻辑生成 content.js
		 */
		(function (global) {
		  'use strict';
		
		  /* ============================== 默认配置 ============================== */
		  var CONFIG = {
		    maxParticles: 130,        // 星座粒子数上限（按屏幕面积再缩放）
		    linkDistance: 130,        // 粒子连线最大距离 px
		    lineOpacity: 0.20,        // 连线最大不透明度
		    dotOpacity: 0.90,         // 粒子点基础不透明度
		    twinkle: true,            // 粒子闪烁
		    starfield: true,          // 星尘层
		    stars: 90,                // 星尘数量
		    nebula: true,             // 星云光晕层
		    mouseRadius: 170,         // 鼠标影响半径 px
		    mouseAttract: 0.05,       // 鼠标吸引力
		    friction: 0.985,          // 每帧速度阻尼（防止鼠标吸引导致速度无限累积）
		    maxSpeed: 3.0,            // 粒子最大速度 px/帧
		    mouseLineOpacity: 0.42,   // 光标-粒子连线不透明度
		    mouseGlow: true,          // 光标处光晕（浮层模式下自动关闭，避免遮字）
		    shootingStars: true,      // 流星
		    shootingInterval: 5200,   // 流星平均间隔 ms
		    dprCap: 2,                // 设备像素比上限
		    bgVar: '--dsw-alias-bg-base',
		    accentVar: '--dsw-static-deepseek-450',
		    mode: 'behind',           // 'behind' | 'overlay'
		    density: 1,               // 粒子密度倍率
		    overlayAlpha: 0.5,        // overlay 模式全局透明度
		    zIndex: null,             // 显式画布 z-index（null → 自动）
		    transparentize: true,     // behind 模式是否透明化大背景容器
		    root: null,               // 透明化扫描根（null → #root 或 body）
		    palette: null             // 颜色覆盖
		  };
		
		  function defaultCfg(opts) {
		    var base = {};
		    for (var k in CONFIG) base[k] = CONFIG[k];
		    var o = opts || {};
		    for (var k2 in o) {
		      if (o[k2] !== undefined) base[k2] = o[k2];
		    }
		    return base;
		  }
		
		  /* ============================== 内部状态 ============================== */
		  var cfg = null;        // 本次挂载生效的配置（mount 时合并）
		  var canvas = null;
		  var ctx = null;
		  var rafId = 0;
		  var disposed = false;
		  var mounted = false;
		  var dpr = 1;
		  var W = 0;
		  var H = 0;
		  var particles = [];
		  var stars = [];
		  var shooters = [];       // 流星
		  var nextShootAt = 0;
		  var mouse = { x: -9999, y: -9999, active: false };
		  var theme = null;
		  var sprites = [];
		  var reduced = false;
		  var themeObserver = null;
		  var rootObserver = null;
		  var mediaDark = null;
		  var transparentPasses = [];
		  var scanTimer = null;
		  var lastScanAt = 0;
		  var MIN_SCAN_INTERVAL = 800;
		
		  /* ============================== 工具函数 ============================== */
		  function parseRgb(str) {
		    var m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(str || '');
		    if (!m) return { r: 21, g: 21, b: 23 };
		    return { r: +m[1], g: +m[2], b: +m[3] };
		  }
		
		  function lum(c) {
		    return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
		  }
		
		  function rgb(c) {
		    return 'rgb(' + c.r + ', ' + c.g + ', ' + c.b + ')';
		  }
		
		  function rgba(c, a) {
		    return 'rgba(' + c.r + ', ' + c.g + ', ' + c.b + ', ' + a + ')';
		  }
		
		  function clamp(v, lo, hi) {
		    return v < lo ? lo : v > hi ? hi : v;
		  }
		
		  function isOpaqueColor(s) {
		    return !!s && s !== 'transparent' && s.indexOf('0, 0, 0, 0') === -1;
		  }
		
		  /* ============================== 主题读取 ============================== */
		  /**
		   * body/html 背景透明时，找「覆盖视口 ≥60% 的大容器纯色背景」
		   * （常见布局：body 透明 + 内容容器上色）。这样透明 body 页面也能拿到正确主题，
		   * 而不是回退到系统偏好导致画布颜色与页面不符。
		   */
		  function findContainerBg() {
		    var root = document.body;
		    if (!root) return null;
		    var minArea = (global.innerWidth || 1280) * (global.innerHeight || 800) * 0.6;
		    var stack = [root];
		    var best = null;
		    var bestArea = 0;
		    var guard = 0;
		    while (stack.length > 0 && guard++ < 400) {
		      var el = stack.pop();
		      var kids = el.children;
		      for (var i = 0; i < kids.length; i++) {
		        var c = kids[i];
		        if (c === canvas) continue;                    // 跳过粒子画布自身
		        var pos = getComputedStyle(c).position;
		        if (pos === 'fixed' || pos === 'absolute') continue; // 悬浮层不是页面背景
		        var r = c.getBoundingClientRect();
		        var area = r.width * r.height;
		        if (area < minArea) continue;
		        var bg = getComputedStyle(c).backgroundColor;
		        if (isOpaqueColor(bg) && area > bestArea) {
		          bestArea = area;
		          best = bg;
		        }
		        stack.push(c);
		      }
		    }
		    return best;
		  }
		
		  function readBgColor() {
		    var cs = getComputedStyle(document.body);
		    var bg = cs.backgroundColor;
		    if (isOpaqueColor(bg)) return { value: bg, solid: true };
		    bg = getComputedStyle(document.documentElement).backgroundColor;
		    if (isOpaqueColor(bg)) return { value: bg, solid: true };
		    bg = findContainerBg();
		    if (isOpaqueColor(bg)) return { value: bg, solid: true };
		    var v = cs.getPropertyValue(cfg.bgVar).trim();
		    if (isOpaqueColor(v)) return { value: v, solid: false };
		    v = getComputedStyle(document.documentElement).getPropertyValue(cfg.bgVar).trim();
		    if (isOpaqueColor(v)) return { value: v, solid: false };
		    var dark = global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches;
		    return { value: dark ? 'rgb(21, 21, 23)' : 'rgb(249, 250, 251)', solid: false };
		  }
		
		  function readAccentColor() {
		    var cs = getComputedStyle(document.body);
		    var v = cs.getPropertyValue(cfg.accentVar).trim();
		    if (v) return v;
		    v = getComputedStyle(document.documentElement).getPropertyValue(cfg.accentVar).trim();
		    if (v) return v;
		    return 'rgb(86, 134, 254)';
		  }
		
		  function readTheme() {
		    var bgInfo = readBgColor();
		    var bgC = parseRgb(bgInfo.value);
		    var dark = lum(bgC) < 0.45;
		    var accent = parseRgb(readAccentColor());
		
		    var dot, line, nebula;
		    if (dark) {
		      dot = { r: 232, g: 240, b: 255 };        // 冷白
		      line = { r: 150, g: 178, b: 255 };       // 淡蓝
		      nebula = [
		        { c: accent, a: 0.11, s: 0.95 },
		        { c: { r: 139, g: 92, b: 246 }, a: 0.07, s: 1.05 },   // 紫
		        { c: { r: 56, g: 189, b: 248 }, a: 0.05, s: 0.75 }    // 青
		      ];
		    } else {
		      dot = { r: 44, g: 66, b: 122 };          // 深蓝灰
		      line = { r: 65, g: 118, b: 230 };
		      nebula = [
		        { c: accent, a: 0.10, s: 0.95 },
		        { c: { r: 139, g: 92, b: 246 }, a: 0.05, s: 1.05 }
		      ];
		    }
		
		    var t = { bg: bgC, dark: dark, accent: accent, dot: dot, line: line, nebula: nebula, solidBg: bgInfo.solid };
		
		    /* 调色板覆盖 */
		    if (cfg.palette) {
		      var p = cfg.palette;
		      if (p.dot) t.dot = parseRgb(p.dot);
		      if (p.line) t.line = parseRgb(p.line);
		      if (p.accent) t.accent = parseRgb(p.accent);
		      if (Array.isArray(p.nebula)) t.nebula = p.nebula.map(function (n) {
		        return { c: parseRgb(n.c || p.accent || 'rgb(86,134,254)'), a: n.a, s: n.s };
		      });
		    }
		    return t;
		  }
		
		  function makeSprite(c, alpha) {
		    var size = 256;
		    var s = document.createElement('canvas');
		    s.width = size;
		    s.height = size;
		    var g = s.getContext('2d');
		    var grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
		    grad.addColorStop(0, rgba(c, alpha));
		    grad.addColorStop(1, rgba(c, 0));
		    g.fillStyle = grad;
		    g.fillRect(0, 0, size, size);
		    return s;
		  }
		
		  function buildSprites() {
		    sprites = [];
		    if (!cfg.nebula) return;
		    for (var i = 0; i < theme.nebula.length; i++) {
		      sprites.push(makeSprite(theme.nebula[i].c, theme.nebula[i].a));
		    }
		  }
		
		  /* ============================== 粒子初始化 ============================== */
		  function initParticles() {
		    var area = W * H;
		    var n = Math.round(clamp(area / 11000, 40, cfg.maxParticles) * cfg.density);
		    n = Math.round(clamp(n, 10, 320));
		    particles = [];
		    for (var i = 0; i < n; i++) {
		      particles.push({
		        x: Math.random() * W,
		        y: Math.random() * H,
		        vx: (Math.random() - 0.5) * 0.34,
		        vy: (Math.random() - 0.5) * 0.34,
		        r: 1 + Math.random() * 1.7,
		        tw: Math.random() * Math.PI * 2,
		        accent: Math.random() < 0.15
		      });
		    }
		    stars = [];
		    if (cfg.starfield) {
		      for (var j = 0; j < cfg.stars; j++) {
		        stars.push({
		          x: Math.random() * W,
		          y: Math.random() * H,
		          r: 0.4 + Math.random() * 0.7,
		          tw: Math.random() * Math.PI * 2,
		          spd: 0.05 + Math.random() * 0.12
		        });
		      }
		    }
		  }
		
		  /* ============================== 绘制 ============================== */
		  function drawNebula(t) {
		    for (var i = 0; i < sprites.length; i++) {
		      var nb = theme.nebula[i];
		      var sx = W * (0.5 + 0.44 * Math.sin(t * 0.00012 * (1 + i * 0.33) + i * 2.4));
		      var sy = H * (0.5 + 0.44 * Math.cos(t * 0.00010 * (1 + i * 0.27) + i * 1.7));
		      var size = Math.max(W, H) * nb.s * 0.92;
		      ctx.drawImage(sprites[i], sx - size / 2, sy - size / 2, size, size);
		    }
		  }
		
		  /* 流星：从侧边斜向划过，拖着渐隐的亮尾 */
		  function drawShooters(t) {
		    var i, s;
		    for (i = shooters.length - 1; i >= 0; i--) {
		      s = shooters[i];
		      s.x += s.vx;
		      s.y += s.vy;
		      s.life -= s.decay;
		      if (s.life <= 0 || s.x < -80 || s.x > W + 80 || s.y < -80 || s.y > H + 80) {
		        shooters.splice(i, 1);
		        continue;
		      }
		      var sp = Math.hypot(s.vx, s.vy) || 1;
		      var len = 100;
		      var tx = s.x - (s.vx / sp) * len;
		      var ty = s.y - (s.vy / sp) * len;
		      var col = theme.dark ? { r: 255, g: 255, b: 255 } : { r: 96, g: 130, b: 220 };
		      var grad = ctx.createLinearGradient(s.x, s.y, tx, ty);
		      grad.addColorStop(0, rgba(col, 0.8 * s.life));
		      grad.addColorStop(1, rgba(col, 0));
		      ctx.strokeStyle = grad;
		      ctx.lineWidth = 2;
		      ctx.beginPath();
		      ctx.moveTo(s.x, s.y);
		      ctx.lineTo(tx, ty);
		      ctx.stroke();
		      ctx.fillStyle = rgba(col, 0.9 * s.life);
		      ctx.beginPath();
		      ctx.arc(s.x, s.y, 1.8, 0, Math.PI * 2);
		      ctx.fill();
		    }
		    if (shooters.length === 0 && t > nextShootAt) {
		      spawnShooter();
		      nextShootAt = t + cfg.shootingInterval * (0.5 + Math.random());
		    }
		  }
		
		  function spawnShooter() {
		    var fromLeft = Math.random() < 0.5;
		    var speed = 0.9 + Math.random() * 0.8;
		    var angle = (Math.PI / 4) * (0.55 + Math.random() * 0.65); // 30~60° 斜下
		    shooters.push({
		      x: fromLeft ? -30 : W + 30,
		      y: Math.random() * H * 0.55,
		      vx: Math.cos(angle) * speed * (fromLeft ? 1 : -1),
		      vy: Math.sin(angle) * speed,
		      life: 1,
		      decay: 0.004 + Math.random() * 0.004
		    });
		  }
		
		  function drawFrame(t) {
		    var i, j, p, q, dx, dy, d2;
		    var linkD2 = cfg.linkDistance * cfg.linkDistance;
		    var overlay = cfg.mode === 'overlay';
		
		    ctx.save();
		    if (overlay) {
		      ctx.globalAlpha = cfg.overlayAlpha;
		      // 深色页面用 screen 混合：只加光、不压暗文字；浅色页面保持正常混合
		      if (theme.dark) ctx.globalCompositeOperation = 'screen';
		    }
		
		    if (!overlay) {
		      ctx.fillStyle = rgb(theme.bg);
		      ctx.fillRect(0, 0, W, H);
		    }
		
		    /* 星云光晕是背景氛围层：浮层模式下不绘制，避免大面积色块盖住内容 */
		    if (cfg.nebula && !overlay) drawNebula(t);
		
		    if (cfg.shootingStars && !reduced) drawShooters(t);
		
		    if (cfg.starfield) {
		      for (i = 0; i < stars.length; i++) {
		        p = stars[i];
		        var sa = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * 0.0012 + p.tw));
		        ctx.fillStyle = rgba(theme.dark ? { r: 220, g: 230, b: 255 } : { r: 60, g: 82, b: 140 }, sa * 0.5);
		        ctx.beginPath();
		        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
		        ctx.fill();
		        p.x += p.spd * 0.2;
		        p.y -= p.spd * 0.08;
		        if (p.x > W + 4) p.x = -4;
		        if (p.y < -4) p.y = H + 4;
		      }
		    }
		
		    ctx.lineWidth = 1;
		    for (i = 0; i < particles.length; i++) {
		      p = particles[i];
		      for (j = i + 1; j < particles.length; j++) {
		        q = particles[j];
		        dx = p.x - q.x;
		        dy = p.y - q.y;
		        d2 = dx * dx + dy * dy;
		        if (d2 < linkD2) {
		          var a = (1 - Math.sqrt(d2) / cfg.linkDistance) * cfg.lineOpacity;
		          ctx.strokeStyle = rgba(theme.line, a);
		          ctx.beginPath();
		          ctx.moveTo(p.x, p.y);
		          ctx.lineTo(q.x, q.y);
		          ctx.stroke();
		        }
		      }
		    }
		
		    if (mouse.active) {
		      var mr2 = cfg.mouseRadius * cfg.mouseRadius;
		      for (i = 0; i < particles.length; i++) {
		        p = particles[i];
		        dx = p.x - mouse.x;
		        dy = p.y - mouse.y;
		        d2 = dx * dx + dy * dy;
		        if (d2 < mr2) {
		          var ma = (1 - Math.sqrt(d2) / cfg.mouseRadius) * cfg.mouseLineOpacity;
		          ctx.strokeStyle = rgba(theme.accent, ma);
		          ctx.beginPath();
		          ctx.moveTo(mouse.x, mouse.y);
		          ctx.lineTo(p.x, p.y);
		          ctx.stroke();
		        }
		      }
		      if (cfg.mouseGlow && !overlay && sprites.length > 0) {
		        var gs = cfg.mouseRadius * 1.4;
		        ctx.drawImage(sprites[0], mouse.x - gs / 2, mouse.y - gs / 2, gs, gs);
		      }
		    }
		
		    for (i = 0; i < particles.length; i++) {
		      p = particles[i];
		      var alpha = cfg.dotOpacity;
		      if (cfg.twinkle) alpha *= 0.55 + 0.45 * Math.sin(t * 0.0016 + p.tw);
		      ctx.fillStyle = rgba(p.accent ? theme.accent : theme.dot, alpha);
		      ctx.beginPath();
		      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
		      ctx.fill();
		    }
		
		    /* 粒子运动：鼠标吸引 + 阻尼/限速 + 越界环绕 */
		    for (i = 0; i < particles.length; i++) {
		      p = particles[i];
		      if (mouse.active) {
		        dx = mouse.x - p.x;
		        dy = mouse.y - p.y;
		        d2 = dx * dx + dy * dy;
		        var mr2b = cfg.mouseRadius * cfg.mouseRadius;
		        if (d2 < mr2b && d2 > 0.01) {
		          var d = Math.sqrt(d2);
		          var f = (1 - d / cfg.mouseRadius) * cfg.mouseAttract;
		          p.vx += (dx / d) * f;
		          p.vy += (dy / d) * f;
		        }
		      }
		      /* 阻尼 + 速度上限：鼠标吸引是逐帧加速度，若无衰减速度会无限累积，
		         粒子最终满屏乱飞、连线织成密网盖住内容（点化成线） */
		      p.vx *= cfg.friction;
		      p.vy *= cfg.friction;
		      var sp2 = p.vx * p.vx + p.vy * p.vy;
		      if (sp2 > cfg.maxSpeed * cfg.maxSpeed) {
		        var sp = Math.sqrt(sp2);
		        p.vx = (p.vx / sp) * cfg.maxSpeed;
		        p.vy = (p.vy / sp) * cfg.maxSpeed;
		      }
		      p.x += p.vx;
		      p.y += p.vy;
		      if (p.x < -24) p.x = W + 24; else if (p.x > W + 24) p.x = -24;
		      if (p.y < -24) p.y = H + 24; else if (p.y > H + 24) p.y = -24;
		    }
		
		    ctx.restore();
		  }
		
		  /* ============================== 生命周期 ============================== */
		  function onResize() {
		    if (disposed) return;
		    dpr = Math.min(global.devicePixelRatio || 1, cfg.dprCap);
		    W = global.innerWidth;
		    H = global.innerHeight;
		    canvas.width = Math.round(W * dpr);
		    canvas.height = Math.round(H * dpr);
		    canvas.style.width = W + 'px';
		    canvas.style.height = H + 'px';
		    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		    shooters = [];
		    nextShootAt = performance.now() + 2500;
		    initParticles();
		    if (reduced) drawFrame(performance.now());
		  }
		
		  function onMouseMove(e) {
		    mouse.x = e.clientX;
		    mouse.y = e.clientY;
		    mouse.active = true;
		  }
		
		  function onMouseLeave() {
		    mouse.active = false;
		    mouse.x = -9999;
		    mouse.y = -9999;
		  }
		
		  function onThemeChange() {
		    if (disposed) return;
		    theme = readTheme();
		    buildSprites();
		    if (cfg.mode !== 'overlay') {
		      canvas.style.background = rgb(theme.bg);
		    }
		    if (cfg.transparentize) transparentize();
		  }
		
		  function loop(t) {
		    if (disposed) return;
		    drawFrame(t);
		    rafId = global.requestAnimationFrame(loop);
		  }
		
		  /**
		   * 透明化「盖住画布的大面积背景容器」（仅 behind 模式）。
		   * 规则（对扫描根全子树 DFS）：
		   *   · 覆盖视口 ≥ 60% 的任意不透明背景容器 → 透明
		   *   · 覆盖 ≥ 30% 且颜色恰为主题底色 → 透明
		   *   · position:fixed / absolute 的悬浮层一律跳过
		   */
		  function transparentize() {
		    var root = cfg.root || document.getElementById('root') || document.body;
		    if (!root) return;
		    var base = rgb(theme.bg);
		    var stack = [root];
		    var guard = 0;
		    while (stack.length > 0 && guard++ < 4000) {
		      var el = stack.pop();
		      var kids = el.children;
		      for (var i = 0; i < kids.length; i++) {
		        var c = kids[i];
		        if (c === canvas) continue;
		        if (c.style.background === 'transparent') continue;
		        var r = c.getBoundingClientRect();
		        var cover = (r.width * r.height) / (W * H || 1);
		        if (cover >= 0.30) {
		          var cs = getComputedStyle(c);
		          if (cs.opacity === '0') continue;
		          var pos = cs.position;
		          if (pos === 'fixed' || pos === 'absolute') continue;
		          var bg = cs.backgroundColor;
		          var img = cs.backgroundImage;
		          var opaqueColor = isOpaqueColor(bg);
		          var hasImage = img && img !== 'none';
		          var big = cover >= 0.60;
		          var matchesBase = bg === base;
		          if ((big && (opaqueColor || hasImage)) || matchesBase) {
		            c.style.background = 'transparent';
		          }
		        }
		        stack.push(c);
		      }
		    }
		  }
		
		  /* 持续扫描：应用晚挂载 / 重渲染导致的大容器背景变化都能兜住 */
		  function scheduleScan() {
		    if (scanTimer !== null) return;
		    var now = Date.now();
		    var wait = Math.max(0, MIN_SCAN_INTERVAL - (now - lastScanAt));
		    scanTimer = global.setTimeout(function () {
		      scanTimer = null;
		      if (disposed) return;
		      lastScanAt = Date.now();
		      transparentize();
		    }, wait);
		  }
		
		  function scheduleTimedScans() {
		    var delays = [0, 600, 1500, 3000];
		    for (var i = 0; i < delays.length; i++) {
		      transparentPasses.push(global.setTimeout(function () {
		        if (disposed) return;
		        lastScanAt = Date.now();
		        transparentize();
		      }, delays[i]));
		    }
		  }
		
		  /**
		   * 挂载粒子背景。
		   * @param {object} [opts] 配置覆盖（见 defaultCfg / CONFIG 注释）
		   * @returns {function} 卸载函数
		   */
		  function mount(opts) {
		    if (mounted) return dispose;
		    if (typeof document === 'undefined') return function () {};
		    cfg = defaultCfg(opts);
		    reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
		    var overlay = cfg.mode === 'overlay';
		
		    theme = readTheme();
		
		    /* 画布 */
		    canvas = document.getElementById('dsh-particle-canvas');
		    if (!canvas) {
		      canvas = document.createElement('canvas');
		      canvas.id = 'dsh-particle-canvas';
		      canvas.setAttribute('aria-hidden', 'true');
		      document.body.appendChild(canvas);
		    }
		    var zIndex = cfg.zIndex !== null ? cfg.zIndex : (overlay ? 2147483000 : -1);
		    canvas.style.cssText =
		      'position:fixed;inset:0;z-index:' + zIndex + ';pointer-events:none;' +
		      (overlay ? 'background:transparent;' : 'background:' + rgb(theme.bg) + ';');
		    ctx = canvas.getContext('2d');
		
		    /* 样式覆写（behind 模式）：body 底色交给画布，内容保持在画布之上 */
		    if (!overlay && cfg.transparentize) {
		      if (!document.getElementById('dsh-particle-style')) {
		        var st = document.createElement('style');
		        st.id = 'dsh-particle-style';
		        var rootEl = document.getElementById('root');
		        st.textContent =
		          'html,body{background:transparent!important}' +
		          (rootEl ? '#root{position:relative;z-index:1}' : '');
		        document.head.appendChild(st);
		      }
		    }
		
		    buildSprites();
		    onResize();
		
		    global.addEventListener('resize', onResize);
		    global.addEventListener('mousemove', onMouseMove, { passive: true });
		    global.addEventListener('mouseleave', onMouseLeave);
		
		    /* 主题切换监听 */
		    themeObserver = new MutationObserver(function () { onThemeChange(); });
		    themeObserver.observe(document.body, { attributes: true });
		    themeObserver.observe(document.documentElement, { attributes: true });
		    if (global.matchMedia) {
		      mediaDark = global.matchMedia('(prefers-color-scheme: dark)');
		      if (mediaDark.addEventListener) {
		        mediaDark.addEventListener('change', onThemeChange);
		      } else if (mediaDark.addListener) {
		        mediaDark.addListener(onThemeChange);
		      }
		    }
		
		    /* 应用结构变化 → 持续补扫透明化 */
		    if (cfg.transparentize) {
		      var scanRoot = cfg.root || document.getElementById('root') || document.body;
		      if (scanRoot) {
		        rootObserver = new MutationObserver(function () { scheduleScan(); });
		        rootObserver.observe(scanRoot, { childList: true, subtree: true });
		      }
		      scheduleTimedScans();
		    }
		
		    mounted = true;
		    disposed = false;
		    if (reduced) {
		      drawFrame(performance.now());
		    } else {
		      rafId = global.requestAnimationFrame(loop);
		    }
		    return dispose;
		  }
		
		  function dispose() {
		    if (disposed) return;
		    disposed = true;
		    mounted = false;
		    if (rafId) global.cancelAnimationFrame(rafId);
		    rafId = 0;
		    for (var i = 0; i < transparentPasses.length; i++) global.clearTimeout(transparentPasses[i]);
		    transparentPasses = [];
		    if (scanTimer !== null) { global.clearTimeout(scanTimer); scanTimer = null; }
		    if (themeObserver) { themeObserver.disconnect(); themeObserver = null; }
		    if (rootObserver) { rootObserver.disconnect(); rootObserver = null; }
		    if (mediaDark) {
		      if (mediaDark.removeEventListener) mediaDark.removeEventListener('change', onThemeChange);
		      else if (mediaDark.removeListener) mediaDark.removeListener(onThemeChange);
		      mediaDark = null;
		    }
		    global.removeEventListener('resize', onResize);
		    global.removeEventListener('mousemove', onMouseMove);
		    global.removeEventListener('mouseleave', onMouseLeave);
		    shooters = [];
		    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
		    canvas = null;
		    ctx = null;
		    var st = document.getElementById('dsh-particle-style');
		    if (st && st.parentNode) st.parentNode.removeChild(st);
		  }
		
		  global.DSH_Particles = { mount: mount, dispose: dispose, CONFIG: CONFIG };
		})(globalThis);
		
		var name = "particle-background";
		var inject = [];
		function apply(ctx) {
			ctx.effect(() => {
				var mount = globalThis.DSH_Particles && globalThis.DSH_Particles.mount;
				var handle = mount ? mount() : null;
				return () => { if (handle) handle(); };
			}, "particle-background: mount");
		}
		exports.name = name;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
