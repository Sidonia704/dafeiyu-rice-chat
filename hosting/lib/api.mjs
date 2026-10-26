import { createState, act, advance, publicState, reserveReply, settleReply, GameError } from '../../server/game.mjs';
import { generate, validateKey } from '../../server/provider.mjs';
import { sealSettings, openSettings } from '../../server/credentials.mjs';

const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const fail = (message, status = 400) => { throw new GameError(message, status); };
const cookie = (request, name) => request.headers.get('cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith(name + '='))?.slice(name.length + 1);
async function input(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) fail('需要 JSON 请求。', 415);
  const reader = request.body?.getReader(); if (!reader) fail('缺少请求内容。');
  let size = 0, text = ''; const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength; if (size > 12000) { await reader.cancel(); fail('消息太长。', 413); }
    text += decoder.decode(value, { stream: true });
  }
  try { return JSON.parse(text + decoder.decode()); } catch { fail('JSON 格式错误。'); }
}
async function load(db, id) {
  const row = await db.prepare('SELECT game_json, revision FROM game_sessions WHERE id = ?').bind(id).first();
  return row ? { state: JSON.parse(row.game_json), revision: row.revision } : null;
}
async function mutate(db, id, operation) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const current = await load(db, id); if (!current) fail('会话已过期，请刷新。', 401);
    const result = operation(current.state);
    const response = await db.prepare('UPDATE game_sessions SET game_json = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?')
      .bind(JSON.stringify(current.state), Date.now(), id, current.revision).run();
    if (response.meta.changes === 1) return { state: current.state, result };
  }
  fail('操作繁忙，请重试。', 409);
}
export async function handleApi(request, env, ctx) {
  const cookies = [];
  const json = (value, status = 200) => {
    const h = new Headers({ ...headers, 'Content-Type': 'application/json; charset=utf-8' });
    for (const value of cookies) h.append('Set-Cookie', value);
    return new Response(JSON.stringify(value), { status, headers: h });
  };
  try {
    const url = new URL(request.url);
    if (request.headers.get('origin') && request.headers.get('origin') !== url.origin) fail('拒绝跨站请求。', 403);
    if (!env.DB || !env.SESSION_SECRET) fail('网站服务尚未配置完成。', 503);
    let id = cookie(request, 'rice_sid'), current;
    if (/^[\da-f-]{36}$/.test(id || '')) current = await load(env.DB, id);
    if (!current) {
      id = crypto.randomUUID(); const initial = createState();
      await env.DB.prepare('INSERT INTO game_sessions (id, game_json, revision, updated_at) VALUES (?, ?, 0, ?)').bind(id, JSON.stringify(initial), Date.now()).run();
      current = { state: initial, revision: 0 };
      cookies.push(`rice_sid=${id}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800`);
      // 定期回收过期游戏记录；不包含任何 API Key。
      if (Math.random() < .02) ctx.waitUntil(env.DB.prepare('DELETE FROM game_sessions WHERE updated_at < ?').bind(Date.now() - 7 * 86400000).run());
    }
    if (current.state.reservation && Date.now() - (current.state.reservation.startedAt || 0) > 90000) {
      current = await mutate(env.DB, id, state => {
        if (state.reservation && Date.now() - (state.reservation.startedAt || 0) > 90000) settleReply(state, state.reservation, state.reservation.budget, 'cancelled');
      });
    }
    const settings = await openSettings(cookie(request, 'rice_model'), id, env.SESSION_SECRET);
    const payload = state => ({ ...publicState(state), mode: 'deepseek', model: settings?.model || null, hasKey: !!settings });
    if (request.method === 'GET' && url.pathname === '/api/state') return json(payload(current.state));
    if (request.method === 'POST' && url.pathname === '/api/model') {
      const data = await input(request);
      if (data.provider && data.provider !== 'deepseek') fail('仅支持使用自己的 DeepSeek API Key。');
      if (current.state.busy) fail('先停止当前回复。', 409);
      const key = typeof data.key === 'string' ? data.key.trim() : '';
      const model = typeof data.model === 'string' && data.model.trim() ? data.model.trim() : 'deepseek-flash';
      if (!key || key.length > 512 || /[\r\n]/.test(key)) fail('请填写有效的 DeepSeek API Key。');
      if (!/^[a-zA-Z0-9._-]{1,100}$/.test(model)) fail('模型名无效。');
      try { await validateKey({ key, model }); } catch (error) { fail(error.message); }
      const sealed = await sealSettings({ key, model }, id, env.SESSION_SECRET);
      cookies.push(`rice_model=${sealed}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`);
      return json({ mode: 'deepseek', model, hasKey: true });
    }
    if (!settings) fail('请先填写并验证自己的 DeepSeek API Key。', 428);
    if (request.method === 'POST' && url.pathname === '/api/action') {
      const data = await input(request);
      const updated = await mutate(env.DB, id, state => act(state, { type: data.type, plot: data.plot }));
      return json(payload(updated.state));
    }
    if (request.method === 'POST' && url.pathname === '/api/reset') {
      await input(request);
      const updated = await mutate(env.DB, id, state => {
        if (state.busy) fail('先停止当前回复。', 409);
        Object.assign(state, createState());
      });
      return json(payload(updated.state));
    }
    if (request.method !== 'POST' || url.pathname !== '/api/chat') fail('接口不存在。', 404);
    const data = await input(request);
    if (typeof data.message !== 'string' || !data.message.trim() || [...data.message].length > 600) fail('请输入 1 至 600 字的消息。');
    const message = data.message.trim();
    const initial = await mutate(env.DB, id, state => { advance(state); const r = reserveReply(state); r.startedAt = Date.now(); return r; });
    const reservation = initial.result;
    const abort = new AbortController();
    const signal = AbortSignal.any([request.signal, abort.signal, AbortSignal.timeout(60000)]);
    const encoder = new TextEncoder(); let channel, closed = false;
    const stream = new ReadableStream({ start(c) { channel = c; }, cancel() { closed = true; abort.abort(); } });
    const send = (event, value) => {
      if (closed) return;
      try { channel.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`)); }
      catch { closed = true; abort.abort(); }
    };
    const task = (async () => {
      send('start', { budget: reservation.budget, energy: initial.state.energy, mode: 'deepseek' });
      let accepted = false, output = '', usage = null, finish = 'stop', problem = null;
      const ping = setInterval(() => { if (!closed) { try { channel.enqueue(encoder.encode(': keepalive\n\n')); } catch { closed = true; abort.abort(); } } }, 15000);
      try {
        for await (const event of generate({ message, history: initial.state.history, maxTokens: reservation.budget, signal, settings })) {
          if (event.type === 'accepted') accepted = true;
          if (event.type === 'delta') {
            output += event.text;
            const estimate = Math.ceil([...output].reduce((sum, ch) => sum + (/[\u3400-\u9fff]/u.test(ch) ? .6 : /[a-z0-9\s]/i.test(ch) ? .3 : .7), 0));
            send('delta', { text: event.text, provisionalUsed: Math.min(reservation.budget - 1, estimate), estimated: true });
          }
          if (event.type === 'usage') usage = event;
          if (event.type === 'finish') finish = event.reason;
        }
      } catch (error) { finish = signal.aborted ? 'cancelled' : 'error'; problem = signal.aborted ? '回复已停止。' : error.message; }
      finally {
        clearInterval(ping);
        const exact = Number.isSafeInteger(usage?.completionTokens) && usage.completionTokens >= 0 && usage.completionTokens <= reservation.budget;
        const used = exact ? usage.completionTokens : accepted ? reservation.budget : 0;
        try {
          const final = await mutate(env.DB, id, state => {
            settleReply(state, reservation, used, finish);
            if (output) { state.history.push({ role: 'user', content: message }, { role: 'assistant', content: output.slice(0, 8000) }); state.history = state.history.slice(-20); }
          });
          send('done', { state: payload(final.state), usedTokens: used, promptTokens: usage?.promptTokens ?? null,
            accounting: exact ? 'exact' : accepted ? 'reserved_upper_bound' : 'not_started',
            reason: final.state.energy === 0 ? 'rice_empty' : finish,
            notice: final.state.energy === 0 ? '大白饭耗尽' : problem,
            warning: !exact && accepted ? '未取得最终 usage，按本次预留上限结算。' : null });
        } catch { send('error', { error: '结算连接中断，请刷新确认饭量。' }); }
        if (!closed) { closed = true; channel.close(); }
      }
    })();
    ctx.waitUntil(task);
    const h = new Headers({ ...headers, 'Content-Type': 'text/event-stream; charset=utf-8', 'X-Accel-Buffering': 'no' });
    for (const value of cookies) h.append('Set-Cookie', value);
    return new Response(stream, { headers: h });
  } catch (error) {
    return json({ error: error.status ? error.message : '服务暂时不可用，请稍后重试。' }, error.status || 500);
  }
}
