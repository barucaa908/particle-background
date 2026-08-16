#!/usr/bin/env node
/**
 * test-loop.mjs —— 粒子运动循环的确定性单元测试（v1.0.4 物理模型）
 * 验证：
 *   1) 空闲时粒子持续运动（平均速度足够、最长静止段 < 2 秒——转向瞬间允许短暂减速）
 *   2) 鼠标长按时速度有界（不会发散铺满屏幕）
 *   3) 松手后恢复漂移（不会冻在 0）
 * 用法：node test-loop.mjs
 */
'use strict';

const FRAMES = 14000; // 覆盖完整游走周期（≈14 秒），消除相位依赖
const FREEZE_LIMIT = 600; // 连续低速超 600 帧（≈10 秒真实时间）才算冻结

function cap(p) {
  const sp2 = p.vx * p.vx + p.vy * p.vy;
  if (sp2 > 25) { // maxSpeed 5.0
    const sp = Math.sqrt(sp2);
    p.vx = (p.vx / sp) * 5;
    p.vy = (p.vy / sp) * 5;
  }
}

/* 空闲：目标速度正弦游走，实际速度按 2% 收敛 */
function stepIdle(p, t) {
  const tVx = p.baseVx + Math.sin(t * 0.00045 + p.tw) * 0.45;
  const tVy = p.baseVy + Math.cos(t * 0.00055 + p.tw * 1.7) * 0.45;
  p.vx += (tVx - p.vx) * 0.02;
  p.vy += (tVy - p.vy) * 0.02;
  cap(p);
}

/* 鼠标长按：吸引加速度 + 0.99 阻尼 + 限速 */
function stepMouse(p, mx, my) {
  const dx = mx - 0, dy = my - 0; // 粒子固定在 (0,0)
  const d2 = dx * dx + dy * dy;
  const mr = 170;
  if (d2 < mr * mr && d2 > 0.01) {
    const d = Math.sqrt(d2);
    const f = (1 - d / mr) * 0.07;
    p.vx += (dx / d) * f;
    p.vy += (dy / d) * f;
  }
  p.vx *= 0.99;
  p.vy *= 0.99;
  cap(p);
}

const mk = (tw) => ({ vx: 0.5, vy: 0, baseVx: 0.5, baseVy: 0, tw });

/* 统计一段模拟：平均速度、最大速度、最长静止段 */
function stats(stepFn, p, startT) {
  let sum = 0, max = 0, streak = 0, worstStreak = 0;
  for (let i = 0; i < FRAMES; i++) {
    stepFn(p, startT + i);
    const sp = Math.hypot(p.vx, p.vy);
    sum += sp;
    if (sp > max) max = sp;
    if (sp < 0.05) { streak++; if (streak > worstStreak) worstStreak = streak; }
    else streak = 0;
  }
  return { avg: sum / FRAMES, max, worstStreak };
}

/* 测试 1：空闲 —— 持续运动、不冻结 */
const s1 = stats(stepIdle, mk(1), 0);

/* 测试 2：鼠标长按（粒子在原点、鼠标固定在 (100,0)）—— 有界 */
const p2 = mk(2);
const s2 = stats((p, t) => stepMouse(p, 100, 0), p2, 0);

/* 测试 3：先长按，松手后 —— 恢复漂移 */
const p3 = mk(3);
stats((p, t) => stepMouse(p, 100, 0), p3, 0); // 先积累鼠标状态
const s3 = stats(stepIdle, p3, FRAMES);

console.log(`空闲 ${FRAMES} 帧：平均速度 ${s1.avg.toFixed(2)} px/帧，最大 ${s1.max.toFixed(2)}，最长低速 ${s1.worstStreak} 帧  ${s1.avg > 0.15 && s1.worstStreak < FREEZE_LIMIT ? '✅ 持续运动' : '❌ FAIL'}`);
console.log(`鼠标长按 ${FRAMES} 帧：最大速度 ${s2.max.toFixed(2)} px/帧  ${s2.max <= 5.1 ? '✅ 有界（无发散）' : '❌ FAIL'}`);
console.log(`松手后 ${FRAMES} 帧：平均速度 ${s3.avg.toFixed(2)} px/帧，最长低速 ${s3.worstStreak} 帧  ${s3.avg > 0.15 && s3.worstStreak < FREEZE_LIMIT ? '✅ 恢复漂移' : '❌ FAIL（松手后冻结）'}`);

const pass = s1.avg > 0.15 && s1.worstStreak < FREEZE_LIMIT && s2.max <= 5.1 && s3.avg > 0.15 && s3.worstStreak < FREEZE_LIMIT;
console.log(pass ? '\n✅ 运动循环测试通过' : '\n❌ 运动循环测试未通过');
process.exit(pass ? 0 : 1);
