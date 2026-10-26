# 框架契约

## 模块

| 文件 | 职责 |
|---|---|
| `shared/config.mjs` | 唯一数值配置、体型公式 |
| `server/game.mjs` | 权威库存、作业、饭量、铁盆归属状态机 |
| `server/provider.mjs` | DeepSeek 接口，每位访客必须提供自己的 Key |
| `server/sse.mjs` | UTF-8、分包与 SSE 解码 |
| `server/index.mjs` | 本机会话、API、流、存档、停止和结算 |
| `public/app.mjs` | UI 呈现、操作、流式聊天 |
| `public/basin-physics.mjs` | 独立铁盆运动与拖放；坐标仅保存在前端 |

`public/style.css` 只提供功能定位和尺寸，没有预设视觉语言。`public/index.html` 是操作验证壳，Qwen 可重写前端或换框架；需要保留以下游戏和接口行为。

## 固定行为

- 四块田，8 秒成熟，每次收获 6 稻谷；种子无限。
- 3 稻谷 → 3 白米（5 秒）；3 白米 → 3 熟饭（6 秒）。
- 一盆最多 3 熟饭；1 熟饭 = 100 token 口粮；肚子最多 600。可连续补喂，但不能超过容量；盆里的饭不足整盆时也可以喂。
- `scale = 0.72 + 0.48 * clamp(remainingTokens / 600, 0, 1)`；脚底为缩放原点。吃饭增大、说话减小，不能用累计投喂量代替剩余饭量。
- 铁盆 `place: world | head`，没有固定面板槽、rack 或 side 状态。`world` 时可以任意拖、扔，重力落到视口底部。满盆投喂后仍在 world，变空盆。
- 饭量归零时把同一铁盆扣到头上。若盆里有尚未喂出的饭，先退回熟饭库存，再扣空盆，避免道具收回造成资源丢失。`retrieve` 后回到 world。点击取盆和拖下都可用。
- 后端作业使用截止时间；轮询只呈现状态，不按前端定时器发放库存。刷新会保留存档；铁盆坐标刷新后回地面。

## API

`GET /api/state` → `{ plots, stock, mill, cooker, basin, energy, maxEnergy, scale, busy, bubble, history, mode, serverNow, totalFed, totalTokens }`。

`POST /api/action`，JSON `{ type, plot? }`；type 为 `plant | harvest | mill | cook | fill | feed | retrieve`。`plot` 从 0 开始。返回新 state。客户端不能提交库存或饭量。

`POST /api/chat`，JSON `{ message }`；只接受 1—600 字。空腹 402，已有回复 409。返回 SSE：

```text
event: start
data: {"budget":192,"energy":300,"mode":"deepseek"}

event: delta
data: {"text":"你好","provisionalUsed":2,"estimated":true}

event: done
data: {"state":{},"usedTokens":42,"accounting":"exact","reason":"stop","notice":null,"warning":null}
```

`state` 在实际响应中是完整的新 state。停止：中止 fetch，服务端中止上游并结算。`POST /api/reset`，JSON `{}`，重置本会话。

## Token 规则与边界

- 游戏只扣输出 `usage.completion_tokens`；输入、系统提示和历史可能产生真实 API 费用，但不扣游戏饭量。
- 请求前预留 `min(剩余饭量, 192)` 并锁定会话，传上游 `max_tokens`。上游接受的硬上限负责截断，余额归零后程序禁止新回复，显示耗尽提示。
- DeepSeek 禁用 thinking。流中 `provisionalUsed` 只驱动缩小动画和带 `≈` 的余额；最终 usage 才是精确结算。网络 chunk 不等于 token。结尾可能有轻微校正。
- `finish_reason=length` 不一定代表没饭，192 的单条上限也会触发；只看实际余额是否归零。
- `accounting: exact | reserved_upper_bound | not_started`。不提供演示模式；未验证访客 Key 时，生产与聊天接口返回 428。
- HTTP 失败、未被上游接受：不扣口粮。上游接受后取消、断网或缺最终 usage：保守扣预留上限，并明确提示“非精确用量”。崩溃重启也如此，避免重用额度。实际供应商费用可能与该保守结算不同。
- 同一浏览器 cookie 共用同一会话；锁与余额在后端。仅绑定 127.0.0.1，适合单机课程展示；不是多用户线上服务。`.env` 不会被静态路由提供。

## 资料

- [DeepSeek Chat Completions：max_tokens、stream、usage](https://api-docs.deepseek.com/api/create-chat-completion/)
- [DeepSeek：实际 token 以 usage 为准](https://api-docs.deepseek.com/quick_start/token_usage/)
- [DeepSeek：接入地址与模型 ID](https://api-docs.deepseek.com/quick_start/)
- [llama.cpp 官方 server 文档](https://github.com/ggml-org/llama.cpp/tree/master/tools/server)

核对日期：2026-10-27。DeepSeek 默认模型 `deepseek-flash`；可在网页设置模型名。Key 必须由每位访客自行填写。本地 Key 按会话保存在内存；线上 Key 使用会话绑定的 AES-GCM 加密 Cookie，不进入游戏数据库，8 小时过期。线上游戏状态使用 D1 和版本比较更新。用 Qwen 编写这个工程，与网页中的对话模型是独立的两件事。
