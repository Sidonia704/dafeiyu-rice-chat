import { randomUUID } from 'node:crypto';
import { CONFIG, FULL_BELLY, bodyScale } from '../shared/config.mjs';

export class GameError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const demand = (condition, message, status) => { if (!condition) throw new GameError(message, status); };
export function createState(now = Date.now()) {
  return {
    version: CONFIG.storageVersion, createdAt: now, lastSeen: now,
    plots: Array.from({ length: CONFIG.plotCount }, () => ({ stage: 'empty', readyAt: 0 })),
    stock: { paddy: 0, white: 0, cooked: 0 },
    mills: [], cooker: null,
    basin: { place: 'world', rice: 0 },
    energy: 0, fed: false, busy: false, reservation: null,
    history: [], totalFed: 0, totalTokens: 0,
    bubble: '爸，饿，喂。'
  };
}
export function advance(state, now = Date.now()) {
  for (const plot of state.plots) {
    if (plot.stage === 'growing' && plot.readyAt <= now) plot.stage = 'ripe';
  }
  state.mills = state.mills.filter(job => {
    if (job.readyAt <= now) { state.stock.white += CONFIG.millOutput; return false; }
    return true;
  });
  if (state.cooker && state.cooker.readyAt <= now) {
    state.stock.cooked += CONFIG.cookOutput; state.cooker = null;
  }
  return state;
}
export function act(state, action, now = Date.now()) {
  advance(state, now);
  switch (action.type) {
    case 'plant': {
      demand(Number.isInteger(action.plot) && action.plot >= 0 && action.plot < state.plots.length, '稻田不存在。');
      const plot = state.plots[action.plot];
      demand(plot.stage === 'empty', '这块田已经种上啦。');
      plot.stage = 'growing'; plot.readyAt = now + CONFIG.growMs; break;
    }
    case 'harvest': {
      demand(Number.isInteger(action.plot) && action.plot >= 0 && action.plot < state.plots.length, '稻田不存在。');
      const plot = state.plots[action.plot];
      demand(plot.stage === 'ripe', '稻谷还没熟，别拔秧苗！');
      state.stock.paddy += CONFIG.harvestPaddy; plot.stage = 'empty'; plot.readyAt = 0; break;
    }
    case 'mill':
      demand(state.mills.length < CONFIG.millCount, '两台碾米机都在工作。');
      demand(state.stock.paddy >= CONFIG.millInput, '需要 1 份稻谷。');
      state.stock.paddy -= CONFIG.millInput;
      state.mills.push({ startedAt: now, readyAt: now + CONFIG.millMs }); break;
    case 'cook':
      demand(!state.cooker, '锅里的饭还没熟。');
      demand(state.stock.white >= CONFIG.cookInput, '需要 1 份白米。');
      state.stock.white -= CONFIG.cookInput;
      state.cooker = { startedAt: now, readyAt: now + CONFIG.cookMs }; break;
    case 'fill': {
      demand(state.basin.place === 'world', '先从大肥鱼头上取回铁盆。');
      demand(state.basin.rice === 0, '铁盆里已经有饭啦。');
      demand(state.stock.cooked > 0, '先煮一点大白饭。');
      const amount = Math.min(CONFIG.basinCapacity, state.stock.cooked);
      state.stock.cooked -= amount; state.basin.rice = amount; break;
    }
    case 'feed':
      demand(!state.busy, '这一句话说完再喂吧。', 409);
      demand(state.basin.place === 'world' && state.basin.rice > 0, '要用盛好饭的铁盆投喂哦。');
      demand(state.energy + state.basin.rice * CONFIG.tokensPerRice <= FULL_BELLY, '肚子暂时装不下这一盆，聊一会儿再喂吧。');
      state.energy += state.basin.rice * CONFIG.tokensPerRice;
      state.totalFed += state.basin.rice; state.basin.rice = 0;
      state.basin.place = 'world'; state.fed = true;
      state.bubble = ['好吃！', '最喜欢大白饭了！', '吃饱啦，接着聊！'][state.totalFed % 3]; break;
    case 'retrieve':
      demand(!state.busy, '等这句话说完。', 409);
      demand(state.basin.place === 'head', '等饭量用完，铁盆才会扣到头上。');
      state.basin = { place: 'world', rice: 0 };
      state.bubble = '盆拿下来啦。'; break;
    default: throw new GameError('未知的操作。');
  }
  state.lastSeen = now;
  return state;
}
export function reserveReply(state, limit = CONFIG.maxReplyTokens) {
  demand(!state.busy, '正在说话，先等一下。', 409);
  demand(state.energy > 0, '大白饭耗尽啦！请取下铁盆，盛饭后重新投喂。', 402);
  const reservation = { id: randomUUID(), budget: Math.min(state.energy, limit) };
  // 不提前减小 energy：前端用 provisional 估算动画，结尾按 usage 精确结算。
  state.busy = true; state.reservation = reservation;
  return reservation;
}
export function settleReply(state, reservation, usedTokens, reason = 'stop') {
  demand(state.reservation?.id === reservation.id, '回复已结算或已过期。', 409);
  demand(Number.isSafeInteger(usedTokens) && usedTokens >= 0 && usedTokens <= reservation.budget, '上游 token 用量不符合预算。', 502);
  state.energy = Math.max(0, state.energy - usedTokens);
  state.totalTokens += usedTokens; state.busy = false; state.reservation = null;
  if (state.energy === 0 && state.fed) {
    // 另装好但尚未投喂的饭先退回库存，扣盆不会凭空销毁熟饭。
    state.stock.cooked += state.basin.rice; state.basin.rice = 0;
    state.basin.place = 'head'; state.bubble = '饭吃完了，喂我！';
  } else if (reason === 'cancelled') state.bubble = '先歇会儿。';
  return state;
}
export function publicState(state, now = Date.now()) {
  advance(state, now);
  return {
    plots: state.plots, stock: state.stock, mills: state.mills, cooker: state.cooker,
    basin: state.basin, energy: state.energy, maxEnergy: FULL_BELLY,
    scale: bodyScale(state.energy), busy: state.busy,
    bubble: state.bubble, totalFed: state.totalFed, totalTokens: state.totalTokens,
    history: state.history, serverNow: now
  };
}
