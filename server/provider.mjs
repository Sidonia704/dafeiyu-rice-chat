import { readSSE } from './sse.mjs';

export const PERSONA = `你是大肥鱼，一位蓝发、蓝眼、鲸鱼尾巴的 Q 版鲸鱼娘。你最爱大白饭，性格俏皮、温和、带一点撒娇。用简洁中文回答用户的实际问题，通常 1 至 3 句，不写客套开场和总结。可以偶尔说“好吃”“最喜欢大白饭了”“爸，饿，喂”，不要每次都说。不要编造已经执行了游戏操作。饭量、体型、生产、token 余额和铁盆由程序控制，你无权改变，也不输出数值指令。不必每条回复都提饭。`;
export function providerName() { return 'deepseek'; }
// 校验用最小聊天请求（文档化接口 /chat/completions，max_tokens=1）。
export async function validateKey({ key, model = 'deepseek-flash', fetchImpl = fetch }) {
  const response = await fetchImpl('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ok' }], max_tokens: 1, thinking: { type: 'disabled' } }),
    signal: AbortSignal.timeout(20000)
  });
  const messages = { 401: 'API Key 无效（401）。', 402: 'API 账户余额不足（402）。', 429: '请求太频繁（429）。' };
  if (!response.ok) throw new Error(messages[response.status] || `DeepSeek 返回 HTTP ${response.status}。`);
  return { ok: true };
}
export async function* generate({ message, history, maxTokens, signal, settings, fetchImpl = fetch }) {
  const key = settings?.key;
  if (!key) throw new Error('请先填写并验证自己的 DeepSeek API Key。');
  const model = settings.model || 'deepseek-flash';
  const body = {
    model, messages: [{ role: 'system', content: PERSONA }, ...history.slice(-10), { role: 'user', content: message }],
    max_tokens: maxTokens, stream: true, stream_options: { include_usage: true }, temperature: 0.8
  };
  // 开启低强度思考提升回复质量；DeepSeek 的思考 token 会计入 usage.completion_tokens（即计入饭量）。
  body.thinking = { type: 'enabled' };
  body.reasoning_effort = 'low';
  const response = await fetchImpl('https://api.deepseek.com/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body), signal
  });
  // 不向浏览器转发原始上游错误正文，避免泄露账户或网关信息。
  if (!response.ok) {
    const messages = { 401: 'API Key 无效。', 402: 'API 账户余额不足。', 429: '请求太频繁，请稍后再试。' };
    throw new Error(messages[response.status] || `模型服务返回 HTTP ${response.status}。`);
  }
  if (!response.body) throw new Error('模型服务没有返回流。');
  yield { type: 'accepted' };
  let finished = false;
  for await (const data of readSSE(response.body)) {
    if (data === '[DONE]') { finished = true; break; }
    const chunk = JSON.parse(data);
    if (chunk.error) throw new Error('模型服务在生成时返回错误。');
    const choice = chunk.choices?.[0];
    const text = choice?.delta?.content;
    if (typeof text === 'string' && text) yield { type: 'delta', text };
    if (Number.isSafeInteger(chunk.usage?.completion_tokens)) {
      yield { type: 'usage', completionTokens: chunk.usage.completion_tokens, promptTokens: chunk.usage.prompt_tokens || 0 };
    }
    if (choice?.finish_reason) yield { type: 'finish', reason: choice.finish_reason };
  }
  if (!finished) throw new Error('模型连接提前结束，未收到 [DONE]。');
}
