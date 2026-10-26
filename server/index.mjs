import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createState, act, publicState, reserveReply, settleReply, GameError } from './game.mjs';
import { generate, providerName, validateKey } from './provider.mjs';
import { CONFIG } from '../shared/config.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp' };
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new GameError('需要 JSON 请求。', 415);
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 12000) throw new GameError('消息太长。', 413);
  }
  try { return JSON.parse(raw); } catch { throw new GameError('JSON 格式错误。'); }
}
export function createApp({ persist = true, dataDir = resolve(ROOT, '.data'), generateImpl = generate, validateImpl = validateKey, mode = providerName() } = {}) {
  const sessions = new Map();
  const modelSettings = new Map(); // 每位访客各自的 Key，绝不写入 .data。
  const savePath = resolve(dataDir, 'sessions.json');
  const save = () => {
    if (!persist) return;
    mkdirSync(dataDir, { recursive: true });
    const tmp = `${savePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(sessions)), 'utf8');
    renameSync(tmp, savePath);
  };
  if (persist && existsSync(savePath)) {
    try {
      const rows = Object.entries(JSON.parse(readFileSync(savePath, 'utf8')));
      for (const [id, state] of rows.slice(-30)) {
        if (!/^[\da-f-]{36}$/.test(id) || state.version !== CONFIG.storageVersion || !Array.isArray(state.plots)) continue;
        if (Date.now() - state.lastSeen > 7 * 86400000) continue;
        // 重启时无法追问上游用量：保守结算尚未完成的额度，杜绝重复使用。
        if (state.reservation) settleReply(state, state.reservation, state.reservation.budget, 'cancelled');
        sessions.set(id, state);
      }
    } catch { console.error('本地存档无法读取，使用新存档。'); }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'");
    try {
      const host = req.headers.host || '';
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) throw new GameError('仅允许本机访问。', 403);
      if (req.headers.origin && req.headers.origin !== `http://${host}`) throw new GameError('拒绝跨站请求。', 403);
      const url = new URL(req.url, `http://${host}`);
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET') throw new GameError('方法不支持。', 405);
        let path = decodeURIComponent(url.pathname);
        if (path === '/') path = '/index.html';
        const base = path.startsWith('/shared/') ? resolve(ROOT, 'shared') : resolve(ROOT, 'public');
        const relative = path.startsWith('/shared/') ? path.slice(8) : path.slice(1);
        const target = resolve(base, relative);
        const normalizedBase = base.toLowerCase() + '/';
        if (!target.replaceAll('\\', '/').toLowerCase().startsWith(normalizedBase.replaceAll('\\', '/'))) throw new GameError('路径无效。', 403);
        let data;
        try { data = await readFile(target); } catch { throw new GameError('文件不存在。', 404); }
        res.writeHead(200, { 'Content-Type': MIME[extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(data); return;
      }
      const sid = req.headers.cookie?.match(/(?:^|;\s*)rice_sid=([\da-f-]{36})(?:;|$)/)?.[1];
      let id = sid && sessions.has(sid) ? sid : randomUUID();
      if (!sessions.has(id)) {
        if (sessions.size >= 30) {
          const removable = [...sessions].find(([, s]) => !s.busy);
          if (removable) { sessions.delete(removable[0]); modelSettings.delete(removable[0]); }
          else throw new GameError('当前会话已满。', 503);
        }
        sessions.set(id, createState());
        res.setHeader('Set-Cookie', `rice_sid=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`);
      }
      const state = sessions.get(id);
      state.lastSeen = Date.now();
      const payload = extra => ({ ...extra, mode: 'deepseek', model: modelSettings.get(id)?.model ?? null, hasKey: !!modelSettings.get(id)?.key });
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const result = publicState(state); save();
        return json(res, 200, payload(result));
      }
      if (req.method === 'POST' && url.pathname === '/api/model') {
        const data = await body(req);
        if (data.provider && data.provider !== 'deepseek') throw new GameError('仅支持使用自己的 DeepSeek API Key。');
        const key = typeof data.key === 'string' ? data.key.trim() : '';
        const model = typeof data.model === 'string' ? data.model.trim() : '';
        if (!key || key.length > 512 || /[\r\n]/.test(key)) throw new GameError('请填写有效的 DeepSeek API Key。');
        if (state.busy) throw new GameError('先停止当前回复。', 409);
        const modelName = model || 'deepseek-flash';
        if (!/^[a-zA-Z0-9._-]{1,100}$/.test(modelName)) throw new GameError('模型名无效。');
        try { await validateImpl({ key, model: modelName }); }
        catch (e) { throw new GameError(e.message, 400); }
        modelSettings.set(id, { key, model: modelName });
        // 响应不回显 Key；Key 只保存在服务端内存。
        return json(res, 200, { mode: 'deepseek', model: modelName, hasKey: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/action') {
        if (!modelSettings.has(id)) throw new GameError('请先填写并验证自己的 DeepSeek API Key。', 428);
        const action = await body(req);
        act(state, { type: action.type, plot: action.plot }); save();
        return json(res, 200, payload(publicState(state)));
      }
      if (req.method === 'POST' && url.pathname === '/api/reset') {
        await body(req);
        if (state.busy) throw new GameError('先停止当前回复，再重置。', 409);
        const fresh = createState(); sessions.set(id, fresh); save();
        return json(res, 200, payload(publicState(fresh)));
      }
      if (req.method === 'POST' && url.pathname === '/api/chat') {
        const data = await body(req);
        if (typeof data.message !== 'string' || !data.message.trim() || [...data.message].length > 600) throw new GameError('请输入 1 至 600 字的消息。');
        const message = data.message.trim();
        const settings = modelSettings.get(id);
        if (!settings) throw new GameError('请先填写并验证自己的 DeepSeek API Key。', 428);
        const modeNow = 'deepseek';
        const reservation = reserveReply(state); save();
        const controller = new AbortController();
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]);
        res.on('close', () => { if (!res.writableEnded) controller.abort(); });
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
        const send = (event, value) => { if (!res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`); };
        const ping = setInterval(() => { if (!res.destroyed) res.write(': keepalive\n\n'); }, 15000);
        send('start', { budget: reservation.budget, energy: state.energy, mode: modeNow });
        let accepted = false, output = '', usage = null, finish = 'stop', problem = null;
        try {
          for await (const event of generateImpl({ message, history: state.history, maxTokens: reservation.budget, signal, settings: { ...settings } })) {
            if (event.type === 'accepted') accepted = true;
            if (event.type === 'delta') {
              output += event.text;
              const estimate = Math.ceil([...output].reduce((sum, ch) => sum + (/[\u3400-\u9fff]/u.test(ch) ? 0.6 : /[a-z0-9\s]/i.test(ch) ? 0.3 : 0.7), 0));
              send('delta', { text: event.text, provisionalUsed: Math.min(reservation.budget - 1, estimate), estimated: true });
            }
            if (event.type === 'usage') usage = event;
            if (event.type === 'finish') finish = event.reason;
          }
        } catch (error) {
          finish = signal.aborted ? 'cancelled' : 'error';
          problem = signal.aborted ? '回复已停止。' : error.message;
        } finally {
          clearInterval(ping);
          const validUsage = Number.isSafeInteger(usage?.completionTokens) && usage.completionTokens >= 0 && usage.completionTokens <= reservation.budget;
          const used = validUsage ? usage.completionTokens : accepted ? reservation.budget : 0;
          settleReply(state, reservation, used, finish);
          if (output) {
            state.history.push({ role: 'user', content: message }, { role: 'assistant', content: output.slice(0, 8000) });
            state.history = state.history.slice(-20);
          }
          save();
          const exhausted = state.energy === 0;
          send('done', {
            state: payload(publicState(state)), usedTokens: used,
            promptTokens: usage?.promptTokens ?? null,
            accounting: validUsage ? 'exact' : accepted ? 'reserved_upper_bound' : 'not_started',
            reason: exhausted ? 'rice_empty' : finish,
            notice: exhausted ? '大白饭耗尽' : problem,
            warning: !validUsage && accepted ? '未取得最终 usage，按本次预留上限结算；这不是精确 token 用量。' : null
          });
          res.end();
        }
        return;
      }
      throw new GameError('接口不存在。', 404);
    } catch (error) {
      if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : '服务发生错误，请查看本机控制台。' });
      else res.end();
      if (!error.status) console.error(error.name, error.message);
    }
  });
  return { server, sessions, modelSettings };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3210);
  const { server } = createApp();
  server.listen(port, '127.0.0.1', () => console.log(`大肥鱼的饭堂：http://127.0.0.1:${port}  [${providerName()}]`));
}
