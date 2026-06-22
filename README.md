# 跑路准时宝

> 提前 15 分钟告诉你：现在走，还是再等等。

一个兼容 Windows 和 macOS 的 Electron 桌面小组件。用户设置公司地址、回家地址和常用下班时间后，应用会在下班前 15 分钟检查路况和天气，并给出“现在走、晚点走、带伞走、别骑车走”的明确建议。

## 功能范围

- 公司地址、家地址、下班时间、提醒提前量、通勤方式配置
- 桌面小窗展示：推荐出发时间、红黄绿三档状态、现在走/晚 30 分钟耗时对比、天气动作建议
- AI 一句话决策：把路况和天气翻译成人话（OpenAI 兼容接口，可指向公司内部模型；未配置时自动降级为规则文案）
- 下班前自动弹系统通知
- 支持立即扫描、托盘常驻
- 支持高德 Web 服务 API
- 未配置高德 Key 时自动进入演示数据模式
- 一套代码打包 Windows `.exe` 和 macOS `.dmg/.app`

## 三档状态

- 🟢 绿色：放心走，路况正常
- 🟡 黄色：建议提前走，有雨或轻微拥堵
- 🔴 红色：赶紧走，再晚会堵 / 下雨

## 启动

```bash
npm install
npm run dev
```

## 高德 API Key

复制 `.env.example` 为 `.env`，填入高德 Web 服务 Key：

```bash
AMAP_KEY=你的Key
```

也可以在启动前设置环境变量。未配置时，应用会使用 mock 数据，方便演示。
也可以直接在应用「设置」里填写高德 Key，无需改文件。

## AI 一句话决策（可选）

支持任意 OpenAI 兼容接口（OpenAI、公司内部模型、DeepSeek、Moonshot 等）。在 `.env` 或应用「设置 → AI 一句话决策」里填写：

```bash
AI_KEY=你的Key
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
```

未配置时不影响主流程，建议文案由内置规则生成。

## 图标

应用与托盘图标由脚本生成（纯 Node，无第三方依赖），已包含在 `assets/`。如需重新生成：

```bash
npm run icons
```

## 打包

```bash
npm run build:win
npm run build:mac
```

注意：macOS 应用通常需要在 macOS 环境打包；Windows `.exe` 推荐在 Windows 环境打包。

## MVP 验收

- 首次打开可完成地址和下班时间设置
- 点击“立即扫描”能生成建议
- 下班前 15 分钟能触发系统通知
- 无 API Key 时也能用演示数据跑通
- Windows 和 macOS 有对应打包脚本
