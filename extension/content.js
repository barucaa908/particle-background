/**
 * dsh-particles —— 通用粒子背景引擎（DeepSeek Harness GUI / 浏览器扩展共用）
 * -----------------------------------------------------------------------
 * 特性：
 *   · 星座连线粒子网络（粒子之间近距离自动连线）
 *   · 星云光晕（品牌蓝 + 紫，缓慢漂移，Lissajous 轨迹）
 *   · 微光星尘（细小星点闪烁，极缓漂移）
 *   · 鼠标/触摸交互（光标或手指附近粒子被吸引、连线、光晕）
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
 *   再次调用 mount 可重配置（自动停止旧实例并应用新参数）；
 *   卸载（dispose）会还原被透明化的页面背景，不留副作用。
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
    maxParticles: 180,        // 星座粒子数上限（按屏幕面积再缩放；大屏更密）
    linkDistance: 130,        // 粒子连线最大距离 px
    lineOpacity: 0.23,        // 连线最大不透明度
    dotOpacity: 0.95,         // 粒子点基础不透明度
    twinkle: true,            // 粒子闪烁
    starfield: true,          // 星尘层
    stars: 90,                // 星尘数量
    nebula: true,             // 星云光晕层
    mouseRadius: 170,         // 鼠标影响半径 px
    mouseAttract: 0.07,       // 鼠标吸引力（v1.0.0 手感：更强、更跟手）
    friction: 0.99,           // 每帧速度阻尼（仅鼠标吸引时启用，防发散；保留甩动感）
    maxSpeed: 5.0,            // 粒子最大速度 px/帧（有界版 v1.0.0：能甩旋涡但不失控）
    idleWanderAmp: 0.45,      // 空闲漂移的目标速度正弦游走幅度（px/帧）
    idleWanderRate: 0.02,     // 空闲时实际速度向目标速度的收敛率
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
  var transparentized = [];   // 被本实例透明化的元素快照（{el, prev}），卸载时还原
  var themeTimer = null;      // 主题变化防抖定时器
  var reducedMedia = null;    // prefers-reduced-motion 运行期监听
  var reducedChangeHandler = null;
  var ownerToken = null;      // 本实例在画布上的所有权标识（防止多副本双绘）
  var styleEl = null;         // 本实例注入的 <style>
  var colorCtx = null;        // 颜色归一化用离屏 canvas（支持 hex/hsl/oklch 等）

  /* ============================== 工具函数 ============================== */
  /**
   * 把任意 CSS 颜色字符串解析为 {r,g,b}。
   * 先用正则吃 rgb()/rgba()；其余（hex/hsl/oklch/命名色/var 链等）
   * 交给 canvas 2D 上下文归一化，兼容现代 CSS 颜色空间。
   */
  function parseRgb(str) {
    var m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(str || '');
    if (m) return { r: +m[1], g: +m[2], b: +m[3] };
    var out = normalizeColor(str);
    m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(out || '');
    if (m) return { r: +m[1], g: +m[2], b: +m[3] };
    m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(out || '');
    if (m) {
      var h = m[1];
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16)
      };
    }
    return { r: 21, g: 21, b: 23 };
  }

  /* 用离屏 canvas 把任意 CSS 颜色归一化成标准串（不改动页面 DOM） */
  function normalizeColor(str) {
    if (!str || typeof document === 'undefined') return '';
    try {
      if (!colorCtx) {
        var c = document.createElement('canvas');
        c.width = 1;
        c.height = 1;
        colorCtx = c.getContext('2d');
      }
      if (!colorCtx) return '';
      var prev = colorCtx.fillStyle;
      colorCtx.fillStyle = str;
      var out = colorCtx.fillStyle;
      colorCtx.fillStyle = prev;
      return out || '';
    } catch (e) {
      return '';
    }
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

  /* 选取透明化扫描根：#root 为空壳（如 MSN 残留的空 div）时回退到 body */
  function pickScanRoot() {
    if (cfg && cfg.root && cfg.root.nodeType === 1) return cfg.root;
    var r = document.getElementById('root');
    if (r && r.children.length > 0) return r;
    return document.body;
  }

  /* 颜色饱和度：max(r,g,b)-min(r,g,b)，越大越鲜艳 */
  function chroma(c) {
    var mx = Math.max(c.r, c.g, c.b);
    var mn = Math.min(c.r, c.g, c.b);
    return (mx - mn) / 255;
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
          /* 只认接近中性色的容器（白色/灰/黑）；鲜艳的蓝色块不是页面底色，
             否则画布会被填成整屏蓝 */
          var cc = parseRgb(bg);
          if (chroma(cc) <= 0.30) {
            bestArea = area;
            best = bg;
          }
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
      dot = { r: 30, g: 52, b: 112 };          // 深蓝（浅色页更醒目）
      line = { r: 50, g: 102, b: 224 };
      nebula = [
        { c: accent, a: 0.12, s: 0.95 },
        { c: { r: 139, g: 92, b: 246 }, a: 0.06, s: 1.05 }
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
    var n = Math.round(clamp(area / 9500, 55, cfg.maxParticles) * cfg.density);
    n = Math.round(clamp(n, 10, 320));
    particles = [];
    for (var i = 0; i < n; i++) {
      var bvx = (Math.random() - 0.5) * 1.0;
      var bvy = (Math.random() - 0.5) * 1.0;
      particles.push({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: bvx,
        vy: bvy,
        baseVx: bvx,   // 空闲漂移目标速度基线（永不被阻尼衰减，粒子不会冻住）
        baseVy: bvy,
        r: 1.2 + Math.random() * 1.8,
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
    var overlay = cfg.mode === 'overlay';
    // 浮层模式悬浮在内容之上：连线明显缩短并减淡，避免"网格罩在文字上"
    var linkDist = overlay ? cfg.linkDistance * 0.55 : cfg.linkDistance;
    var linkD2 = linkDist * linkDist;
    var lineAlphaMul = overlay ? 0.35 : 1;

    ctx.save();
    if (overlay) {
      /* 浮层模式每帧必须清空：否则粒子/鼠标线会留下永不消失的拖尾，
         长时间使用后整张画布积成一层淡蓝薄雾（"大面积蓝色"的来源） */
      ctx.clearRect(0, 0, W, H);
      // 浮层模式：浅色页面自动减淡 25%，避免粒子抢过正文
      ctx.globalAlpha = cfg.overlayAlpha * (theme.dark ? 1 : 0.75);
      // 深色页面用 screen 混合：只加光、不压暗文字；浅色页面保持正常混合
      if (theme.dark) ctx.globalCompositeOperation = 'screen';
    }

    if (!overlay) {
      ctx.fillStyle = rgb(theme.bg);
      ctx.fillRect(0, 0, W, H);
    }

    /* 星云光晕是背景氛围层：浮层模式下不绘制，避免大面积色块盖住内容 */
    if (cfg.nebula && !overlay) drawNebula(t);

    /* 浅色页浮层不画流星（流星的亮尾也是线，可能划过正文） */
    if (cfg.shootingStars && !reduced && !(overlay && !theme.dark)) drawShooters(t);

    if (cfg.starfield) {
      for (i = 0; i < stars.length; i++) {
        p = stars[i];
        var sa = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * 0.0012 + p.tw));
        ctx.fillStyle = rgba(theme.dark ? { r: 220, g: 230, b: 255 } : { r: 60, g: 82, b: 140 }, sa * (overlay ? 0.32 : 0.5));
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        p.x += p.spd * 0.2;
        p.y -= p.spd * 0.08;
        if (p.x > W + 4) p.x = -4;
        if (p.y < -4) p.y = H + 4;
      }
    }

    /* 浅色页浮层不画连线（星座连线 + 鼠标连线），只留粒子和星尘，保证阅读零干扰 */
    if (!overlay || theme.dark) {
      ctx.lineWidth = overlay ? 0.5 : 1;
      for (i = 0; i < particles.length; i++) {
        p = particles[i];
        for (j = i + 1; j < particles.length; j++) {
          q = particles[j];
          dx = p.x - q.x;
          dy = p.y - q.y;
          d2 = dx * dx + dy * dy;
          if (d2 < linkD2) {
            var a = (1 - Math.sqrt(d2) / linkDist) * cfg.lineOpacity * lineAlphaMul;
            ctx.strokeStyle = rgba(theme.line, a);
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.stroke();
          }
        }
      }
    }

    if (mouse.active && (!overlay || theme.dark)) {
      var mr2 = cfg.mouseRadius * cfg.mouseRadius;
      for (i = 0; i < particles.length; i++) {
        p = particles[i];
        dx = p.x - mouse.x;
        dy = p.y - mouse.y;
        d2 = dx * dx + dy * dy;
        if (d2 < mr2) {
          var ma = (1 - Math.sqrt(d2) / cfg.mouseRadius) * cfg.mouseLineOpacity * (overlay ? 0.5 : 1);
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
      if (cfg.twinkle) alpha *= 0.65 + 0.35 * Math.sin(t * 0.0016 + p.tw);
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
      /* 鼠标吸引时阻尼防发散（保留甩动感）；
         空闲时目标速度沿正弦缓慢游走、实际速度向目标收敛：
         粒子画出有机曲线，永远在动、永远不会冻成静态点 */
      if (mouse.active) {
        p.vx *= cfg.friction;
        p.vy *= cfg.friction;
      } else {
        var tVx = p.baseVx + Math.sin(t * 0.00045 + p.tw) * cfg.idleWanderAmp;
        var tVy = p.baseVy + Math.cos(t * 0.00055 + p.tw * 1.7) * cfg.idleWanderAmp;
        p.vx += (tVx - p.vx) * cfg.idleWanderRate;
        p.vy += (tVy - p.vy) * cfg.idleWanderRate;
      }
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

  function onTouchStart(e) {
    var t = e.touches && e.touches[0];
    if (t) {
      mouse.x = t.clientX;
      mouse.y = t.clientY;
      mouse.active = true;
    }
  }

  function onTouchMove(e) {
    var t = e.touches && e.touches[0];
    if (t) {
      mouse.x = t.clientX;
      mouse.y = t.clientY;
      mouse.active = true;
    }
  }

  function onTouchEnd() {
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
    if (cfg.transparentize && cfg.mode !== 'overlay') transparentize();
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
    if (cfg.mode === 'overlay') return;   // 浮层模式不碰页面背景
    var root = pickScanRoot();
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
          /* 只移除纯色大容器；带背景图的大容器是页面视觉的一部分，不透明化
             （否则图片被挖掉、露出画布纯色，形成"色块污染"） */
          if ((big && opaqueColor && !hasImage) || matchesBase) {
            var tracked = false;
            for (var t = 0; t < transparentized.length; t++) {
              if (transparentized[t].el === c) { tracked = true; break; }
            }
            if (!tracked) transparentized.push({ el: c, prev: c.style.background });
            c.style.background = 'transparent';
          }
        }
        stack.push(c);
      }
    }
  }

  /* 还原被透明化的元素（dispose / 重配置时调用，恢复页面原始背景） */
  function restoreTransparentized() {
    for (var i = transparentized.length - 1; i >= 0; i--) {
      var rec = transparentized[i];
      var el = rec && rec.el;
      if (el && el.style && el.style.background === 'transparent') {
        if (rec.prev) el.style.background = rec.prev;
        else el.style.removeProperty('background');
      }
    }
    transparentized = [];
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

  /* 主题变化防抖：SPA 高频改 body/html 属性时合并处理 */
  function scheduleThemeApply() {
    if (themeTimer !== null) return;
    themeTimer = global.setTimeout(function () {
      themeTimer = null;
      if (disposed) return;
      onThemeChange();
    }, 120);
  }

  /**
   * 挂载粒子背景。
   * @param {object} [opts] 配置覆盖（见 defaultCfg / CONFIG 注释）
   * @returns {function} 卸载函数
   */
  function mount(opts) {
    if (typeof document === 'undefined') return function () {};
    if (mounted) stop();   // 重配置：停掉当前实例（保留画布，随后复用）
    if (!ownerToken) ownerToken = 'dsh-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
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
    } else if (canvas.dataset.dshParticle && canvas.dataset.dshParticle !== ownerToken) {
      // 画布已被其它引擎副本持有（如 DSH 插件与扩展同时加载）：不接管、不绘制
      canvas = null;
      ctx = null;
      return function () {};
    }
    if (!canvas || typeof canvas.getContext !== 'function') {
      canvas = null;
      ctx = null;
      return function () {};
    }
    ctx = canvas.getContext('2d');
    if (!ctx) {
      // 画布已被其它上下文占用（如 webgl）
      canvas = null;
      return function () {};
    }
    canvas.dataset.dshParticle = ownerToken;

    var zIndex = cfg.zIndex !== null ? cfg.zIndex : (overlay ? 2147483000 : -1);
    canvas.style.cssText =
      'position:fixed;inset:0;z-index:' + zIndex + ';pointer-events:none;' +
      (overlay ? 'background:transparent;' : 'background:' + rgb(theme.bg) + ';');

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
        styleEl = st;
      }
    } else if (styleEl && styleEl.parentNode) {
      styleEl.parentNode.removeChild(styleEl);   // 从 behind 切到 overlay 时清掉旧样式
      styleEl = null;
    }

    buildSprites();
    onResize();

    global.addEventListener('resize', onResize);
    global.addEventListener('mousemove', onMouseMove, { passive: true });
    global.addEventListener('mouseleave', onMouseLeave);
    global.addEventListener('touchstart', onTouchStart, { passive: true });
    global.addEventListener('touchmove', onTouchMove, { passive: true });
    global.addEventListener('touchend', onTouchEnd, { passive: true });

    /* 主题切换监听（属性过滤 + 防抖，避免 SPA 高频属性变化拖慢页面） */
    themeObserver = new MutationObserver(function () { scheduleThemeApply(); });
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-ds-dark-theme'] });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-ds-dark-theme'] });
    if (global.matchMedia) {
      mediaDark = global.matchMedia('(prefers-color-scheme: dark)');
      if (mediaDark.addEventListener) {
        mediaDark.addEventListener('change', scheduleThemeApply);
      } else if (mediaDark.addListener) {
        mediaDark.addListener(scheduleThemeApply);
      }
      /* 运行期响应系统「减弱动态效果」切换 */
      reducedMedia = global.matchMedia('(prefers-reduced-motion: reduce)');
      reducedChangeHandler = function (m) {
        reduced = !!m.matches;
        if (reduced) {
          if (rafId) global.cancelAnimationFrame(rafId);
          rafId = 0;
          drawFrame(performance.now());
        } else if (mounted && !disposed) {
          rafId = global.requestAnimationFrame(loop);
        }
      };
      if (reducedMedia.addEventListener) {
        reducedMedia.addEventListener('change', reducedChangeHandler);
      } else if (reducedMedia.addListener) {
        reducedMedia.addListener(reducedChangeHandler);
      }
    }

    /* 应用结构变化 → 持续补扫透明化 */
    if (cfg.transparentize && !overlay) {
      var scanRoot = pickScanRoot();
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

  /* 停掉当前实例的运行态（rAF/定时器/监听/观察器），并还原被透明化的元素。
     不删除画布 —— 供 mount() 重配置时复用。 */
  function stop() {
    if (rafId) global.cancelAnimationFrame(rafId);
    rafId = 0;
    for (var i = 0; i < transparentPasses.length; i++) global.clearTimeout(transparentPasses[i]);
    transparentPasses = [];
    if (scanTimer !== null) { global.clearTimeout(scanTimer); scanTimer = null; }
    if (themeTimer !== null) { global.clearTimeout(themeTimer); themeTimer = null; }
    if (themeObserver) { themeObserver.disconnect(); themeObserver = null; }
    if (rootObserver) { rootObserver.disconnect(); rootObserver = null; }
    if (mediaDark) {
      if (mediaDark.removeEventListener) mediaDark.removeEventListener('change', scheduleThemeApply);
      else if (mediaDark.removeListener) mediaDark.removeListener(scheduleThemeApply);
      mediaDark = null;
    }
    if (reducedMedia) {
      if (reducedMedia.removeEventListener) reducedMedia.removeEventListener('change', reducedChangeHandler);
      else if (reducedMedia.removeListener) reducedMedia.removeListener(reducedChangeHandler);
      reducedMedia = null;
    }
    global.removeEventListener('resize', onResize);
    global.removeEventListener('mousemove', onMouseMove);
    global.removeEventListener('mouseleave', onMouseLeave);
    global.removeEventListener('touchstart', onTouchStart);
    global.removeEventListener('touchmove', onTouchMove);
    global.removeEventListener('touchend', onTouchEnd);
    restoreTransparentized();
    shooters = [];
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    mounted = false;
    stop();
    if (canvas && canvas.dataset.dshParticle === ownerToken) {
      delete canvas.dataset.dshParticle;
    }
    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
    canvas = null;
    ctx = null;
    if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
    styleEl = null;
  }

  global.DSH_Particles = { mount: mount, dispose: dispose, CONFIG: CONFIG };
})(globalThis);

/**
 * content-main.js —— 浏览器扩展内容脚本主体
 * 由 build-extension.js 拼接到 src/particles.js 之后生成 extension/content.js。
 * 职责：读取设置（chrome.storage）、决定渲染模式、挂载/卸载引擎、响应设置变化。
 */
(function () {
  'use strict';

  var DEFAULTS = {
    enabled: true,     // 总开关
    mode: 'auto',      // 'auto' | 'behind' | 'overlay'
    density: 1,        // 0.5 / 1 / 1.5 / 2
    palette: 'blue',   // 'blue' | 'violet' | 'cyan' | 'white' | 'green'
    fxLines: true,
    fxNebula: true,
    fxStars: true,
    fxShooting: true,
    fxMouse: true,
    opacity: 100       // 0-100：浮层模式透明度
  };

  var PALETTES = {
    blue: null, // 跟随主题默认（DeepSeek 蓝）
    violet: {
      accent: 'rgb(139, 92, 246)',
      line: 'rgb(167, 139, 250)',
      nebula: [
        { c: 'rgb(139, 92, 246)', a: 0.10, s: 1.0 },
        { c: 'rgb(236, 72, 153)', a: 0.05, s: 0.9 }
      ]
    },
    cyan: {
      accent: 'rgb(34, 211, 238)',
      line: 'rgb(103, 232, 249)',
      nebula: [
        { c: 'rgb(34, 211, 238)', a: 0.10, s: 1.0 },
        { c: 'rgb(59, 130, 246)', a: 0.06, s: 0.9 }
      ]
    },
    white: {
      accent: 'rgb(255, 255, 255)',
      line: 'rgb(226, 232, 240)',
      nebula: [{ c: 'rgb(255, 255, 255)', a: 0.06, s: 1.0 }]
    },
    green: {
      accent: 'rgb(74, 222, 128)',
      line: 'rgb(134, 239, 172)',
      nebula: [{ c: 'rgb(34, 197, 94)', a: 0.08, s: 1.0 }]
    }
  };

  var handle = null;
  var currentMode = null;

  function siteKey() {
    return location.hostname || 'local';
  }

  function solidBg() {
    try {
      var b = getComputedStyle(document.body).backgroundColor;
      var h = getComputedStyle(document.documentElement).backgroundColor;
      if ((b && b !== 'transparent' && b.indexOf('0, 0, 0, 0') === -1) ||
        (h && h !== 'transparent' && h.indexOf('0, 0, 0, 0') === -1)) {
        return true;
      }
      // body/html 透明但大容器有纯色背景（常见布局）：也应走背景模式
      var els = document.body.querySelectorAll('div,main,section,article,aside,header,footer,nav');
      for (var i = 0; i < els.length; i++) {
        var r = els[i].getBoundingClientRect();
        if (r.width * r.height >= innerWidth * innerHeight * 0.6) {
          var bg = getComputedStyle(els[i]).backgroundColor;
          if (bg && bg !== 'transparent' && bg.indexOf('0, 0, 0, 0') === -1) return true;
        }
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  function resolveMode(pref) {
    if (pref === 'behind' || pref === 'overlay') return pref;
    return solidBg() ? 'behind' : 'overlay';
  }

  function buildOpts(s) {
    var mode = resolveMode(s.mode);
    return {
      mode: mode,
      density: s.density,
      transparentize: mode === 'behind',
      palette: PALETTES[s.palette] || null,
      twinkle: s.fxStars !== false,
      starfield: s.fxStars !== false,
      nebula: s.fxNebula !== false,
      shootingStars: s.fxShooting !== false,
      lineOpacity: s.fxLines === false ? 0 : undefined,
      mouseRadius: s.fxMouse === false ? 0 : undefined,
      mouseAttract: s.fxMouse === false ? 0 : undefined,
      mouseLineOpacity: s.fxMouse === false ? 0 : undefined,
      mouseGlow: s.fxMouse !== false,
      overlayAlpha: (s.opacity / 100) * 0.45
    };
  }

  function unmount() {
    if (handle) {
      handle();
      handle = null;
    }
    currentMode = null;
  }

  function doApply() {
    if (document.getElementById('dsh-particle-canvas')) {
      // 页面已自带粒子层（例如 DeepSeek Harness 内置实例），扩展不重复挂载
      unmount();
      return;
    }
    chrome.storage.sync.get(DEFAULTS, function (sync) {
      chrome.storage.local.get({ disabledSites: [] }, function (local) {
        var disabled = (local.disabledSites || []).indexOf(siteKey()) !== -1;
        var enabled = sync.enabled !== false && !disabled;
        if (!enabled) {
          unmount();
          return;
        }
        var opts = buildOpts(sync);
        unmount();
        currentMode = opts.mode;
        handle = window.DSH_Particles.mount(opts);
      });
    });
  }

  var applyTimer = null;

  /* 设置变化防抖：滑杆拖动等高频写入合并成一次重挂载，避免每 tick 重建粒子层 */
  function apply(immediate) {
    if (applyTimer !== null) {
      global.clearTimeout(applyTimer);
      applyTimer = null;
    }
    if (immediate) {
      doApply();
      return;
    }
    applyTimer = global.setTimeout(function () {
      applyTimer = null;
      doApply();
    }, 150);
  }

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === 'sync' || area === 'local') apply();
  });

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg && msg.type === 'dsh-particles:get-state') {
      sendResponse({ mounted: !!handle, mode: currentMode });
      return true;
    }
  });

  /* 异步等待引擎就绪后启动（content.js = 引擎 + 本文件，引擎同步执行完毕） */
  apply(true);
})();
