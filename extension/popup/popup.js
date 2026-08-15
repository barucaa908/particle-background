/* 粒子背景扩展 —— 弹窗控制面板 */
'use strict';

var DEFAULTS = {
  enabled: true,
  mode: 'auto',
  density: 1,
  palette: 'blue',
  fxLines: true,
  fxNebula: true,
  fxStars: true,
  fxShooting: true,
  fxMouse: true,
  opacity: 100
};

var settings = Object.assign({}, DEFAULTS);
var hostname = null;

function $(id) { return document.getElementById(id); }

/* ---------- 分段按钮通用绑定 ---------- */
function initSeg(id, field, values, labelFor) {
  var seg = $(id);
  seg.addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    var v = btn.dataset.v;
    if (field === 'density') v = parseFloat(v);
    settings[field] = v;
    seg.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b === btn); });
    save();
    syncVisibility();
  });
  // 初始状态
  seg.querySelectorAll('button').forEach(function (b) {
    b.classList.toggle('on', String(b.dataset.v) === String(settings[field]));
  });
}

/* ---------- 保存 / 加载 ---------- */
function save() {
  chrome.storage.sync.set(settings);
}

function load() {
  chrome.storage.sync.get(DEFAULTS, function (got) {
    settings = Object.assign({}, DEFAULTS, got);
    applyToUi();
  });
  chrome.storage.local.get({ disabledSites: [] }, function (got) {
    var sites = got.disabledSites || [];
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs && tabs[0];
      if (tab && tab.url) {
        try { hostname = new URL(tab.url).hostname; } catch (e) { hostname = null; }
      }
      if (hostname) {
        $('siteDisabled').checked = sites.indexOf(hostname) !== -1;
        $('siteDisabled').closest('.row').style.display = 'flex';
      } else {
        $('siteDisabled').closest('.row').style.display = 'none';
      }
    });
  });
}

function applyToUi() {
  $('enabled').checked = settings.enabled;
  ['mode', 'density', 'palette'].forEach(function (f) { setSeg(f, settings[f]); });
  $('fxLines').checked = settings.fxLines;
  $('fxNebula').checked = settings.fxNebula;
  $('fxStars').checked = settings.fxStars;
  $('fxShooting').checked = settings.fxShooting;
  $('fxMouse').checked = settings.fxMouse;
  $('opacity').value = settings.opacity;
  $('opacityVal').textContent = settings.opacity + '%';
  syncVisibility();
  refreshState();
}

function setSeg(field, value) {
  var id = field === 'palette' ? 'paletteRow' : field + 'Seg';
  var seg = $(id);
  if (!seg) return;
  seg.querySelectorAll('button').forEach(function (b) {
    b.classList.toggle('on', String(b.dataset.v) === String(value));
  });
}

function syncVisibility() {
  $('opacitySec').hidden = settings.mode !== 'overlay';
  $('siteDisabled').disabled = !settings.enabled;
}

/* ---------- 当前状态提示 ---------- */
function refreshState() {
  var el = $('stateText');
  if (!settings.enabled) { el.textContent = '已全局停用'; return; }
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var tab = tabs && tabs[0];
    if (!tab || !tab.id) { el.textContent = ''; return; }
    chrome.tabs.sendMessage(tab.id, { type: 'dsh-particles:get-state' }, function (resp) {
      if (chrome.runtime.lastError || !resp) {
        el.textContent = hostname ? hostname + '：插件未在此页运行' : '';
        return;
      }
      if (!resp.mounted) { el.textContent = hostname ? hostname + '：未挂载' : ''; return; }
      var modeText = resp.mode === 'overlay' ? '浮层模式' : resp.mode === 'behind' ? '背景模式' : resp.mode;
      el.textContent = hostname + '：' + modeText + ' 已生效';
    });
  });
}

/* ---------- 事件绑定 ---------- */
$('enabled').addEventListener('change', function () { settings.enabled = this.checked; save(); syncVisibility(); refreshState(); });

['fxLines', 'fxNebula', 'fxStars', 'fxShooting', 'fxMouse'].forEach(function (id) {
  $(id).addEventListener('change', function () { settings[id] = this.checked; save(); });
});

$('opacity').addEventListener('input', function () {
  settings.opacity = parseInt(this.value, 10);
  $('opacityVal').textContent = settings.opacity + '%';
  save();
});

$('siteDisabled').addEventListener('change', function () {
  if (!hostname) return;
  chrome.storage.local.get({ disabledSites: [] }, function (got) {
    var sites = got.disabledSites || [];
    var i = sites.indexOf(hostname);
    if (this.checked && i === -1) sites.push(hostname);
    if (!this.checked && i !== -1) sites.splice(i, 1);
    chrome.storage.local.set({ disabledSites: sites });
  }.bind(this));
});

$('resetBtn').addEventListener('click', function () {
  chrome.storage.sync.remove(Object.keys(DEFAULTS));
  load();
});

initSeg('modeSeg', 'mode', ['auto', 'behind', 'overlay']);
initSeg('densitySeg', 'density', ['0.5', '1', '1.5', '2']);
initSeg('paletteRow', 'palette', ['blue', 'violet', 'cyan', 'white', 'green']);

load();
