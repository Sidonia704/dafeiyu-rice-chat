import { CONFIG, bodyScale } from '/shared/config.mjs';
import { BasinPhysics } from '/basin-physics.mjs';
const $ = id => document.getElementById(id);
const meter = document.querySelector('.meter');
let state = null, chatting = false, controller = null, newest = 0, actionPending = false, happyUntil = 0, toastTimer, panelCollapsed = false, lastBubble = '';
function withinFish(x, y) { const r = $('drop-zone').getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; }
const physics = new BasinPhysics($('basin-world'), { onFeed: () => action('feed'), isFeedTarget: withinFish, onRetrieve: () => action('retrieve') });
function toast(message) { if (!message) return; $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 3600); }
async function request(url, data) {
  const response = await fetch(url, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const value = await response.json(); if (!response.ok) throw new Error(value.error || '请求失败。'); return value;
}
function setEnergy(value, estimated = false) {
  value = Math.max(0, value); $('energy').textContent = `${estimated ? '≈' : ''}${Math.round(value)}`;
  $('energy-bar').style.width = `${value / (state?.maxEnergy || 600) * 100}%`;
  meter.setAttribute('aria-valuenow', Math.round(value));
  $('fish-body').style.transform = `scale(${bodyScale(value)})`;
}
function characterPose() {
  const pose = chatting ? 'chew' : Date.now() < happyUntil ? 'happy' : state?.energy > 0 ? 'idle' : 'hungry';
  const file = `/assets/character-${pose}.png`; if ($('character').getAttribute('src') !== file) $('character').src = file;
  $('character').classList.toggle('chewing', chatting);
}
function pop(node, name) { node.classList.remove(name); void node.offsetWidth; node.classList.add(name); }
function scrollChat() { $('chat-log').scrollTop = $('chat-log').scrollHeight; }
function createMessage(role, content) {
  const row = document.createElement('div'); row.className = `message ${role}`;
  const label = document.createElement('div'); label.className = 'message-label'; label.textContent = role === 'user' ? '你' : '大肥鱼';
  const body = document.createElement('div'); body.className = 'message-body'; body.textContent = content;
  row.append(label, body); $('chat-log').append(row); scrollChat(); return body;
}
function renderHistory(history) {
  const marker = JSON.stringify(history); if ($('chat-log').dataset.history === marker) return;
  $('chat-log').dataset.history = marker; $('chat-log').replaceChildren();
  history.forEach(item => createMessage(item.role, item.content));
}
function notice(message) { if (!message) return; const n = document.createElement('div'); n.className = 'notice'; n.textContent = message; $('chat-log').append(n); scrollChat(); }
const seconds = time => Math.max(0, Math.ceil((time - Date.now()) / 1000));
function summaryText() {
  const parts = [`稻谷 ${state.stock.paddy}`, `白米 ${state.stock.white}`, `熟饭 ${state.stock.cooked}`];
  const ripe = state.plots.filter(p => p.stage === 'ripe').length; if (ripe) parts.push(`熟田 ${ripe}`);
  if (state.mills.length) parts.push(`碾米 ${state.mills.map(j => seconds(j.readyAt)).join('/')}`);
  if (state.cooker) parts.push(`煮饭 ${seconds(state.cooker.readyAt)}s`);
  if (state.basin.place === 'head') parts.push('盆扣在头上');
  else if (state.basin.rice > 0) parts.push('盆里盛满饭');
  return parts.join(' · ');
}
function render(next) {
  if (next.serverNow < newest) return; newest = next.serverNow; state = next;
  document.querySelector('main').inert = !state.hasKey;
  $('basin-world').inert = !state.hasKey;
  if (!state.hasKey) {
    $('settings').hidden = false;
    if (!$('model-status').textContent) $('model-status').textContent = '请先填写并验证自己的 Key';
  }
  $('capacity').textContent = state.maxEnergy; meter.setAttribute('aria-valuemax', state.maxEnergy);
  if (!chatting) setEnergy(state.energy);
  characterPose();
  const text = chatting ? '嚼嚼……' : state.bubble;
  if ($('bubble').textContent !== text) { $('bubble').textContent = text; pop($('bubble'), 'bubble-pop'); }
  $('head-basin').hidden = state.basin.place !== 'head'; physics.setState(state.basin);
  $('retrieve').hidden = state.basin.place !== 'head'; $('retrieve').disabled = state.busy || actionPending;
  $('send').disabled = !state.hasKey || state.energy <= 0 || state.busy || chatting; $('stop').hidden = !chatting;
  $('message').placeholder = state.energy > 0 ? '说点什么…' : '先喂饭…';
  for (const key of ['paddy', 'white', 'cooked']) $(key).textContent = state.stock[key];
  state.plots.forEach((plot, index) => {
    const node = $('plots').children[index]; node.className = `plot ${plot.stage}`;
    node.querySelector('img').src = `/assets/field-${plot.stage === 'empty' ? 'empty' : plot.stage === 'ripe' ? 'ripe' : 'growing'}.png`;
    node.querySelector('span').textContent = plot.stage === 'empty' ? '种' : plot.stage === 'ripe' ? '收' : `${seconds(plot.readyAt)}s`;
    node.disabled = plot.stage === 'growing' || actionPending;
    node.setAttribute('aria-label', `稻田 ${index + 1}，${plot.stage === 'empty' ? '播种' : plot.stage === 'ripe' ? '收获' : '生长中'}`);
  });
  const millsFull = state.mills.length >= CONFIG.millCount;
  for (let i = 0; i < CONFIG.millCount; i++) {
    const job = state.mills[i], button = $(`mill-${i}`), progress = $(`mill-progress-${i}`);
    button.disabled = !!job || millsFull || state.stock.paddy < CONFIG.millInput || actionPending;
    button.textContent = job ? `${seconds(job.readyAt)}s` : '碾米';
    progress.hidden = !job;
    if (job) progress.value = 1 - Math.max(0, job.readyAt - Date.now()) / (job.readyAt - job.startedAt);
  }
  const cookJob = state.cooker, cookButton = $('cook'), cookProgress = $('cook-progress');
  cookButton.disabled = !!cookJob || state.stock.white < CONFIG.cookInput || actionPending;
  cookButton.textContent = cookJob ? `${seconds(cookJob.readyAt)}s` : '煮饭';
  cookProgress.hidden = !cookJob;
  if (cookJob) cookProgress.value = 1 - Math.max(0, cookJob.readyAt - Date.now()) / (cookJob.readyAt - cookJob.startedAt);
  $('cooker-image').src = `/assets/cooker-${state.cooker || state.stock.cooked ? 'ready' : 'idle'}.png`;
  const full = state.basin.place === 'world' && state.basin.rice > 0;
  $('fill').disabled = state.basin.place !== 'world' || full || state.stock.cooked < 1 || actionPending;
  $('feed').disabled = !full || state.busy || actionPending;
  $('production-summary').textContent = summaryText();
  if (!chatting) renderHistory(state.history);
}
async function action(type, plot) {
  if (actionPending) return false; actionPending = true; if (state) render(state);
  try {
    const result = await request('/api/action', { type, plot });
    if (type === 'feed') { happyUntil = Date.now() + 1500; pop($('fish-pulse'), 'pop'); refresh(); }
    actionPending = false; render(result); if (type === 'feed') setTimeout(characterPose, 1600); return true;
  } catch (error) { toast(error.message); return false; }
  finally { actionPending = false; if (state) render(state); }
}
for (let index = 0; index < CONFIG.plotCount; index++) {
  const node = document.createElement('button'), img = document.createElement('img'); node.className = 'plot'; img.alt = ''; img.draggable = false;
  node.append(img, document.createElement('span'));
  node.onclick = () => action(state.plots[index].stage === 'ripe' ? 'harvest' : 'plant', index); $('plots').append(node);
}
for (const type of ['mill-0', 'mill-1', 'cook', 'fill', 'feed', 'retrieve']) $(type).onclick = () => action(type.startsWith('mill-') ? 'mill' : type);
$('head-basin').addEventListener('pointerdown', e => physics.takeFromHead(e, $('drop-zone')));
$('panel-toggle').onclick = () => {
  panelCollapsed = !panelCollapsed;
  $('production-body').hidden = panelCollapsed;
  $('production-summary').hidden = !panelCollapsed;
  $('panel-toggle').textContent = panelCollapsed ? '展开' : '收起';
  $('panel-toggle').setAttribute('aria-expanded', String(!panelCollapsed));
  if (state) render(state);
};
function fishClick() { if (state?.basin.place === 'head') action('retrieve'); else if (state?.basin.rice > 0) action('feed'); }
$('drop-zone').onclick = fishClick;
$('drop-zone').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fishClick(); } };
$('reset').onclick = async () => {
  if (chatting || state?.busy) return toast('先停止回复。'); if (!confirm('重置进度和聊天记录？')) return;
  try { render(await request('/api/reset', {})); } catch (error) { toast(error.message); }
};
$('settings-toggle').onclick = () => { if (state?.hasKey) $('settings').hidden = !$('settings').hidden; };
$('model-save').onclick = async () => {
  if (!$('model-key').value.trim()) return $('model-key').reportValidity();
  $('model-status').textContent = '验证中…';
  $('model-save').disabled = true;
  try {
    const result = await request('/api/model', { provider: 'deepseek', key: $('model-key').value, model: $('model-name').value.trim() });
    $('model-key').value = '';
    $('model-status').textContent = `已验证 · ${result.model}`;
    render(await request('/api/state'));
    $('settings').hidden = true;
  } catch (error) { $('model-status').textContent = error.message; $('model-key').value = ''; }
  finally { $('model-save').disabled = false; }
};
async function* streamEvents(stream) {
  let buffer = ''; const decoder = new TextDecoder();
  for await (const bytes of stream) {
    buffer += decoder.decode(bytes, { stream: true }); buffer = buffer.replace(/\r\n/g, '\n'); let end;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, end); buffer = buffer.slice(end + 2);
      const event = chunk.split('\n').find(line => line.startsWith('event:'))?.slice(6).trim();
      const data = chunk.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (event && data) yield { event, value: JSON.parse(data) };
    }
  }
}
$('chat-form').onsubmit = async event => {
  event.preventDefault(); const message = $('message').value.trim();
  if (!message || chatting || state?.busy) return; if (!state || state.energy <= 0) return toast('先喂饭。');
  const startingEnergy = state.energy; chatting = true; controller = new AbortController(); render(state);
  createMessage('user', message); const partial = createMessage('assistant', ''); $('message').value = ''; let gotDone = false;
  try {
    const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }), signal: controller.signal });
    if (!response.ok) throw new Error((await response.json()).error || '聊天失败。');
    for await (const { event, value } of streamEvents(response.body)) {
      if (event === 'delta') { partial.textContent += value.text; setEnergy(startingEnergy - value.provisionalUsed, value.estimated); scrollChat(); }
      if (event === 'done') {
        gotDone = true; chatting = false; $('chat-log').dataset.history = ''; render(value.state);
        notice(value.notice); if (value.warning) toast(value.warning);
      }
    }
    if (!gotDone) throw new Error('连接中断，正在结算。');
  } catch (error) { toast(error.name === 'AbortError' ? '已停止，正在结算。' : error.message); $('chat-log').dataset.history = ''; }
  finally {
    chatting = false; controller = null;
    try { render(await request('/api/state')); } catch (error) { toast(error.message); } characterPose();
  }
};
$('message').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('chat-form').requestSubmit(); } };
$('stop').onclick = () => controller?.abort();
let polling = false;
async function refresh() {
  if (polling) return; polling = true;
  try { render(await request('/api/state')); } catch { } finally { polling = false; }
}
await refresh(); setInterval(refresh, 900);
