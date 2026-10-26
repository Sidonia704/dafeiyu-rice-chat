import test from 'node:test';
import assert from 'node:assert/strict';
import { readSSE } from '../server/sse.mjs';
import { generate } from '../server/provider.mjs';
const encoder = new TextEncoder();
function fragmented(text) {
  const bytes = encoder.encode(text);
  return new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 3) c.enqueue(bytes.slice(i, i + 3)); c.close(); } });
}
test('SSE 能处理 UTF-8 中文被分包、注释、CRLF 和多行 data', async () => {
  const events = [];
  for await (const event of readSSE(fragmented(': ping\r\n\r\ndata: 中文\r\ndata: 第二行\r\n\r\ndata: [DONE]\r\n\r\n'))) events.push(event);
  assert.deepEqual(events, ['中文\n第二行', '[DONE]']);
});
test('DeepSeek 请求带访客自己的 Key 和服务端预算，usage 与 finish 在同一块也能结算', async () => {
    let sent;
    const fakeFetch = async (url, options) => {
      sent = JSON.parse(options.body); assert.equal(url, 'https://api.deepseek.com/chat/completions');
      return new Response(fragmented('data: {"choices":[{"delta":{"content":"你好"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"length"}],"usage":{"completion_tokens":17,"prompt_tokens":22}}\n\ndata: [DONE]\n\n'));
    };
    const result = [];
    for await (const event of generate({ message: 'Hi', history: [], maxTokens: 17, signal: new AbortController().signal, settings: { key: 'unit-test-only' }, fetchImpl: fakeFetch })) result.push(event);
    assert.equal(sent.max_tokens, 17); assert.equal(sent.thinking.type, 'enabled'); assert.equal(sent.reasoning_effort, 'low');
    assert.equal(sent.stream_options.include_usage, true);
    assert.equal(result.find(e => e.type === 'usage').completionTokens, 17);
    assert.equal(result.find(e => e.type === 'finish').reason, 'length');
});
test('没有访客 Key 时不会调用模型，也没有演示回复', async () => {
  let called = false;
  await assert.rejects(async () => { for await (const event of generate({ message: 'Hi', history: [], maxTokens: 1, fetchImpl: async () => { called = true; } })) {} }, /API Key/);
  assert.equal(called, false);
});
