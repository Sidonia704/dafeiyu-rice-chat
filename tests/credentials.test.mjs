import test from 'node:test';
import assert from 'node:assert/strict';
import { sealSettings, openSettings } from '../server/credentials.mjs';
test('线上 Key 使用加密、会话绑定与过期校验，密文不包含原 Key', async () => {
  const secret = Buffer.alloc(32, 7).toString('base64url');
  const value = await sealSettings({ key: 'sk-test-private', model: 'deepseek-flash' }, 'visitor-a', secret, 1000);
  assert.ok(!value.includes('sk-test-private'));
  assert.equal((await openSettings(value, 'visitor-a', secret, 2000)).key, 'sk-test-private');
  assert.equal(await openSettings(value, 'visitor-b', secret, 2000), null);
  assert.equal(await openSettings(value, 'visitor-a', secret, 9 * 3600000), null);
  assert.equal(await openSettings(value + 'corrupted', 'visitor-a', secret, 2000), null);
});
