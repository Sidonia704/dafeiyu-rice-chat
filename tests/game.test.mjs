import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, bodyScale } from '../shared/config.mjs';
import { createState, act, advance, publicState, reserveReply, settleReply } from '../server/game.mjs';

function fedState() {
  const s = createState(0); act(s, { type: 'plant', plot: 0 }, 0);
  advance(s, CONFIG.growMs); act(s, { type: 'harvest', plot: 0 }, CONFIG.growMs);
  const millAt = CONFIG.growMs; act(s, { type: 'mill' }, millAt);
  advance(s, millAt + CONFIG.millMs);
  const cookAt = millAt + CONFIG.millMs; act(s, { type: 'cook' }, cookAt);
  advance(s, cookAt + CONFIG.cookMs);
  act(s, { type: 'fill' }, cookAt + CONFIG.cookMs); act(s, { type: 'feed' }, cookAt + CONFIG.cookMs);
  return s;
}
test('完整产线只在成熟时发放库存，投喂后铁盆仍可盛饭和继续投喂', () => {
  const s = fedState(); assert.equal(s.energy, 100);
  assert.deepEqual(s.stock, { paddy: 0, white: 0, cooked: 1 });
  assert.equal(s.basin.place, 'world');
  assert.throws(() => act(s, { type: 'retrieve' }, 19001));
  s.stock.cooked = 3;
  act(s, { type: 'fill' }, 19002); act(s, { type: 'feed' }, 19002);
  assert.equal(s.energy, 200); assert.equal(s.basin.place, 'world');
  // 盛饭只盛 1 碗；投喂把腹灌到 600 后，下一盆必须被拒绝而不是静默丢弃
  s.stock.cooked = 3; act(s, { type: 'fill' }, 19003);
  act(s, { type: 'feed' }, 19003); assert.equal(s.energy, 300);
  s.energy = 500; s.stock.cooked = 1; act(s, { type: 'fill' }, 19004);
  act(s, { type: 'feed' }, 19004); assert.equal(s.energy, 600);
  s.stock.cooked = 1; act(s, { type: 'fill' }, 19005);
  assert.throws(() => act(s, { type: 'feed' }, 19005));
  assert.equal(s.basin.rice, 1, '被拒投喂的饭留在盆里，不丢失');
});
test('未成熟不能收获，重复完成任务不会复制资源', () => {
  const s = createState(0); act(s, { type: 'plant', plot: 0 }, 0);
  assert.throws(() => act(s, { type: 'harvest', plot: 0 }, CONFIG.growMs - 1));
  act(s, { type: 'harvest', plot: 0 }, CONFIG.growMs);
  assert.throws(() => act(s, { type: 'harvest', plot: 0 }, CONFIG.growMs + 1));
  act(s, { type: 'mill' }, CONFIG.growMs + 1); advance(s, CONFIG.growMs + 1 + CONFIG.millMs);
  assert.equal(s.stock.white, 1); assert.equal(s.stock.paddy, 0);
});
test('吃饭放大，消耗 token 连续缩小，归零扣盆', () => {
  const s = createState(0); const small = publicState(s, 0).scale;
  Object.assign(s, fedState()); s.energy = 500; assert.ok(publicState(s).scale > small);
  const a = reserveReply(s); assert.equal(a.budget, 192); settleReply(s, a, 192);
  const mid = publicState(s).scale; assert.ok(mid > small && mid < CONFIG.maxScale);
  const b = reserveReply(s); assert.equal(b.budget, 192); settleReply(s, b, 192);
  assert.equal(s.energy, 116);
  const c = reserveReply(s); assert.equal(c.budget, 116); settleReply(s, c, 116);
  assert.equal(s.energy, 0); assert.equal(s.basin.place, 'head');
  assert.equal(publicState(s).scale, small);
  assert.throws(() => reserveReply(s), error => error.status === 402);
  act(s, { type: 'retrieve' }); assert.equal(s.basin.place, 'world');
  for (let n = 0; n < 300; n++) assert.ok(bodyScale(n) < bodyScale(n + 1));
});
test('同一会话只允许一个回复，重复结算、越预算、负数都被拒绝', () => {
  const s = fedState(), r = reserveReply(s);
  assert.throws(() => reserveReply(s), error => error.status === 409);
  assert.throws(() => settleReply(s, r, r.budget + 1));
  assert.throws(() => settleReply(s, r, -1));
  settleReply(s, r, 37); assert.equal(s.energy, 63);
  assert.throws(() => settleReply(s, r, 37));
});
test('余额为一个 token 仍可生成一个，上游失败可结算零消耗', () => {
  const s = fedState(); s.energy = 1;
  const r = reserveReply(s); assert.equal(r.budget, 1);
  settleReply(s, r, 0, 'error'); assert.equal(s.energy, 1);
  const again = reserveReply(s); settleReply(s, again, 1);
  assert.equal(s.energy, 0); assert.equal(s.basin.place, 'head');
});
test('库存不受浏览器自报余额和负数 plot 干扰', () => {
  const s = createState();
  assert.throws(() => act(s, { type: 'plant', plot: -1 }));
  assert.throws(() => act(s, { type: 'plant', plot: 0.5 }));
  assert.throws(() => act(s, { type: 'feed', energy: 999999 }));
  assert.equal(s.energy, 0);
});
test('扣盆前把未投喂的熟饭退回库存，不会凭空丢饭', () => {
  const s = fedState(); s.energy = 1; s.stock.cooked = 3;
  act(s, { type: 'fill' }); const r = reserveReply(s); settleReply(s, r, 1);
  assert.equal(s.stock.cooked, 3, '库存 2 + 盆里 1 碗退回');
  assert.equal(s.basin.rice, 0); assert.equal(s.basin.place, 'head');
});
