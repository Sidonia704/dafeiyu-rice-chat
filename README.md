# 大肥鱼

种田、碾米、煮饭、装盆投喂鲸鱼娘，再用饭量兑换 AI 对话。吃饭变大，说话变小；铁盆可以任意抛掷、碰壁反弹，饭量耗尽后扣到角色头上。

- [打开网页](https://dafeiyu-sidonia704.racingmole513.chatgpt.site)
- [GitHub 源码](https://github.com/Sidonia704/dafeiyu-rice-chat)

必须填写并验证自己的 DeepSeek API Key，不提供演示模式，也不共用站长的 Key。Key 不进入源码、日志或游戏存档。线上使用加密、HttpOnly、Secure 会话 Cookie，8 小时后需重新验证；本地版仅保存在对应访客的服务端内存中。

本地运行：Node.js 22+，`npm start`，打开控制台地址后填写 Key。Windows 也可以双击 `启动.cmd`。

`npm test` 验证游戏、预算、停止、密钥隔离与铁盆边界。`npm run build` 构建 `hosting/` 中的线上版本，需要先在该目录安装依赖。公网游戏状态保存在 D1，并使用版本比较防止并发重复消费。

素材原图、切图信息与生成提示词保存在 `public/assets/`。界面与玩法保留本地 Qwen 完成的版本；这次修复恢复了铁盆右缘、补全旋转边界，并完成按访客隔离和公网适配。
