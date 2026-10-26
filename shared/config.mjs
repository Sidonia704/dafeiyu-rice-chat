// 唯一数值来源；Qwen 调整平衡时从这里入手。
export const CONFIG = Object.freeze({
  plotCount: 4,
  millCount: 2,
  growMs: 20000,
  harvestPaddy: 1,
  millMs: 10000,
  millInput: 1,
  millOutput: 1,
  cookMs: 6000,
  cookInput: 1,
  cookOutput: 2,
  basinCapacity: 1,
  bellyCapacity: 6,
  tokensPerRice: 100,
  maxReplyTokens: 192,
  minScale: 0.72,
  maxScale: 1.20,
  storageVersion: 2
});
export const FULL_BELLY = CONFIG.bellyCapacity * CONFIG.tokensPerRice;
export function bodyScale(remainingTokens) {
  const ratio = Math.max(0, Math.min(1, remainingTokens / FULL_BELLY));
  return CONFIG.minScale + (CONFIG.maxScale - CONFIG.minScale) * ratio;
}
