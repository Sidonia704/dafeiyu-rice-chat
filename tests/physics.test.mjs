import test from 'node:test';
import assert from 'node:assert/strict';
import { BasinPhysics } from '../public/basin-physics.mjs';
globalThis.innerWidth = 1000; globalThis.innerHeight = 700;
globalThis.window = { addEventListener() {} };
globalThis.requestAnimationFrame = () => 0;
globalThis.document = { getElementById: () => ({ classList: { toggle() {}, remove() {} } }) };
function element() { return { style: {}, hidden: false, addEventListener() {}, setAttribute() {}, setPointerCapture() {}, querySelector: () => ({ src: '' }) }; }
function event(x, y) { return { button: 0, pointerId: 1, clientX: x, clientY: y, preventDefault() {}, stopPropagation() {} }; }
function make(options = {}) { return new BasinPhysics(element(), { onFeed() {}, isFeedTarget: () => false, onRetrieve: async () => true, ...options }); }
test('空盆可以抛掷，碰墙反向，最终落在窗口底部', () => {
  const p = make(); p.x = 850; p.y = 60; p.vx = 1500; p.vy = -300;
  p.frame(p.last + 32); assert.ok(p.vx < 0, '撞右墙必须向左弹');
  for (let n = 0; n < 700; n++) p.frame(p.last + 16);
  assert.equal(p.y, 700 - p.height - 4); assert.equal(p.vy, 0);
  assert.ok(p.x >= 0 && p.x <= 1000 - p.width);
});
test('只有满盆主动释放到角色处才投喂；普通物理碰撞不投喂', () => {
  let count = 0; const p = make({ onFeed: () => count++, isFeedTarget: x => x < 250 });
  p.setState({ place: 'world', rice: 3 });
  p.grab(event(400, 300)); p.move(event(100, 300)); p.release(event(100, 300));
  p.release(event(100, 300)); assert.equal(count, 1);
  p.x = 100; p.y = 100; p.frame(p.last + 16); assert.equal(count, 1);
  p.setState({ place: 'world', rice: 0 }); p.grab(event(400, 300)); p.release(event(100, 300));
  assert.equal(count, 1, '空盆不能变成饭');
});
test('头上的盆可以拖下来；窗口缩小时不会留在视口外', async () => {
  const p = make(); p.setState({ place: 'head', rice: 0 }); assert.equal(p.el.hidden, true);
  await p.takeFromHead(event(110, 100), element());
  assert.equal(p.el.hidden, false); assert.equal(p.drag.source, 'head');
  p.release(event(110, 100)); p.x = 900; p.y = 600;
  innerWidth = 360; innerHeight = 500; p.frame(p.last + 16);
  assert.ok(p.x <= 360 - p.width); assert.ok(p.y <= 500 - p.height - 4);
  innerWidth = 1000; innerHeight = 700;
});
test('铁盆旋转到右侧墙壁时完整外接矩形仍在窗口内', () => {
  const p = make(); p.x = innerWidth - p.width; p.y = 100; p.angle = 28; p.spin = 0;
  p.frame(p.last + 16);
  const radians = 28 * Math.PI / 180;
  const rotatedWidth = p.width * Math.cos(radians) + p.height * Math.sin(radians);
  assert.ok(p.x + p.width / 2 + rotatedWidth / 2 <= innerWidth + .001);
});
