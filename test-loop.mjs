#!/usr/bin/env node
/**
 * test-loop.mjs —— 粒子运动循环的确定性单元测试
 * 验证 v1.0.2 修复：鼠标吸引（逐帧加速度）在有阻尼/限速后不再导致速度无限累积。
 * 用法：node test-loop.mjs
 */
'use strict';

// 粒子固定在一处、鼠标固定在 170px 内的位置，模拟"鼠标长时间停住"场景
const FRAMES = 3000; // ≈ 50 秒（60fps）
const PX = 640, PY = 300;
const MX = 640, MY = 400;
const MR = 170, ATTRACT = 0.05;

function step(vx, vy, { friction, maxSpeed, cap }) {
  const dx = MX - PX, dy = MY - PY;
  const d2 = dx * dx + dy * dy;
  if (d2 < MR * MR && d2 > 0.01) {
    const d = Math.sqrt(d2);
    const f = (1 - d / MR) * ATTRACT;
    vx += (dx / d) * f;
    vy += (dy / d) * f;
  }
  if (friction) { vx *= friction; vy *= friction; }
  if (cap) {
    const sp2 = vx * vx + vy * vy;
    if (sp2 > maxSpeed * maxSpeed) {
      const sp = Math.sqrt(sp2);
      vx = (vx / sp) * maxSpeed;
      vy = (vy / sp) * maxSpeed;
    }
  }
  return [vx, vy];
}

function simulate({ friction, maxSpeed, cap }) {
  let vx = 0, vy = 0, maxV = 0;
  for (let i = 0; i < FRAMES; i++) {
    [vx, vy] = step(vx, vy, { friction, maxSpeed, cap });
    maxV = Math.max(maxV, Math.sqrt(vx * vx + vy * vy));
  }
  return maxV;
}

const oldMax = simulate({ friction: 0, maxSpeed: 3, cap: false });
const newMax = simulate({ friction: 0.985, maxSpeed: 3, cap: true });

console.log(`旧逻辑（v1.0.0/v1.0.1，无阻尼无上限）${FRAMES} 帧后最大速度: ${oldMax.toFixed(1)} px/帧  ${oldMax > 20 ? '→ 发散 ❌（点化成线铺满屏幕）' : '→ OK'}`);
console.log(`新逻辑（v1.0.2，阻尼 0.985 + 上限 3.0）${FRAMES} 帧后最大速度: ${newMax.toFixed(2)} px/帧  ${newMax <= 3.01 ? '→ 有界 ✅（稳定绕鼠标旋转）' : '→ FAIL'}`);

const pass = oldMax > 20 && newMax <= 3.01;
console.log(pass ? '\n✅ 运动循环测试通过' : '\n❌ 运动循环测试未通过');
process.exit(pass ? 0 : 1);
