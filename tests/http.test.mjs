import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.mjs';

test('真实 HTTP：会话隔离、预算截断、错误回滚、密钥不可作为静态文件读取', async t => {
  let behavior = 'normal'; let recordedBudget;
  async function* fakeGenerate({ maxTokens }) {
    recordedBudget = maxTokens;
    if (behavior === 'before_error') throw new Error('not started');
    yield { type: 'accepted' };
    yield { type: 'delta', text: '饭饭！' };
    if (behavior === 'after_error') throw new Error('network gone');
    yield { type: 'usage', completionTokens: maxTokens, promptTokens: 9 };
    yield { type: 'finish', reason: 'length' };
  }
  const { server, sessions } = createApp({ persist: false, generateImpl: fakeGenerate, validateImpl: async () => ({ ok: true }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const first = await fetch(`${base}/api/state`);
  const cookie = first.headers.get('set-cookie').split(';')[0]; await first.json();
  const validated = await fetch(`${base}/api/model`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'test-only' }) }); await validated.json();
  const s = [...sessions.values()][0];
  const post = message => fetch(`${base}/api/chat`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) });
  let response = await post('空腹'); assert.equal(response.status, 402); await response.json();
  s.energy = 23; s.fed = true; s.basin.place = 'world';
  response = await post('耗尽'); const output = await response.text();
  assert.equal(recordedBudget, 23); assert.ok(output.includes('rice_empty')); assert.equal(s.energy, 0); assert.equal(s.basin.place, 'head');
  behavior = 'before_error'; s.energy = 33;
  response = await post('失败'); await response.text(); assert.equal(s.energy, 33); assert.equal(s.busy, false);
  behavior = 'after_error';
  response = await post('中断'); const interrupted = await response.text();
  assert.equal(s.energy, 0); assert.ok(interrupted.includes('reserved_upper_bound'));
  const other = await (await fetch(`${base}/api/state`)).json(); assert.equal(other.history.length, 0);
  assert.equal((await fetch(`${base}/.env`)).status, 404);
  assert.equal((await fetch(`${base}/server/provider.mjs`)).status, 404);
  assert.equal((await fetch(`${base}/api/action`, { method: 'POST', headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
});

test('强制访客填写 Key：会话隔离、无回显、禁止演示模式', async t => {
  let validated = null;
  const fakeValidate = async ({ key, model }) => { validated = { key, model }; return { ok: true }; };
  const { server, sessions, modelSettings } = createApp({ persist: false, generateImpl: async function* () { yield { type: 'accepted' }; }, validateImpl: fakeValidate });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const first = await fetch(`${base}/api/state`); const cookie = first.headers.get('set-cookie').split(';')[0];
  assert.equal((await first.json()).hasKey, false);
  const rejected = await fetch(`${base}/api/action`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{"type":"plant","plot":0}' });
  assert.equal(rejected.status, 428); await rejected.json();
  const post = body => fetch(`${base}/api/model`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let response = await post({ provider: 'deepseek' }); assert.equal(response.status, 400); await response.json();
  response = await post({ provider: 'deepseek', key: 'sk-test', model: '' });
  const result = await response.json();
  assert.equal(response.status, 200); assert.equal(validated.model, 'deepseek-flash');
  assert.equal(result.mode, 'deepseek'); assert.equal(result.hasKey, true);
  assert.ok(!JSON.stringify(result).includes('sk-test'), '响应不得回显 Key');
  const state = await (await fetch(`${base}/api/state`, { headers: { Cookie: cookie } })).json(); assert.equal(state.hasKey, true);
  const other = await (await fetch(`${base}/api/state`)).json(); assert.equal(other.hasKey, false);
  assert.equal([...modelSettings.values()][0].key, 'sk-test');
  assert.ok(!JSON.stringify([...sessions.values()]).includes('sk-test'));
  response = await post({ provider: 'mock' }); assert.equal(response.status, 400); await response.json();
  response = await post({ provider: 'vllm' }); assert.equal(response.status, 400); await response.json();
});

test('断开浏览器会中止生成并解除 busy，不允许并发双花', async t => {
  let started;
  const accepted = new Promise(resolve => started = resolve);
  async function* slow({ signal }) {
    yield { type: 'accepted' }; yield { type: 'delta', text: '第一口' }; started();
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
  }
  const { server, sessions } = createApp({ persist: false, generateImpl: slow, validateImpl: async () => ({ ok: true }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const first = await fetch(`${base}/api/state`); const cookie = first.headers.get('set-cookie').split(';')[0]; await first.json();
  const validated = await fetch(`${base}/api/model`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'test-only' }) }); await validated.json();
  const state = [...sessions.values()][0]; state.energy = 100; state.fed = true;
  const options = { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{"message":"你好"}' };
  const controller = new AbortController();
  const response = await fetch(`${base}/api/chat`, { ...options, signal: controller.signal });
  await accepted;
  const concurrent = await fetch(`${base}/api/chat`, options); assert.equal(concurrent.status, 409); await concurrent.json();
  controller.abort(); await response.text().catch(() => {});
  for (let n = 0; n < 30 && state.busy; n++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(state.busy, false); assert.equal(state.energy, 0);
});
