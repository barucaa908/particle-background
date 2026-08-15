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
      return (b && b !== 'transparent' && b.indexOf('0, 0, 0, 0') === -1) ||
        (h && h !== 'transparent' && h.indexOf('0, 0, 0, 0') === -1);
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
      overlayAlpha: (s.opacity / 100) * 0.6
    };
  }

  function unmount() {
    if (handle) {
      handle();
      handle = null;
    }
    currentMode = null;
  }

  function apply() {
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
  apply();
})();
