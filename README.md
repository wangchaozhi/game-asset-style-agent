# Game Asset Agent

上传几张风格参考图，由 Claude 担任「AI 美术总监」：先从参考图提炼可复用的**风格指南**（色板 hex、技法、线条、光影、视角、比例），再按你的需求规划素材清单、调用图像模型批量生成，**逐张看图审核**，风格跑偏就带着具体问题重画——最终得到一套看起来出自同一款游戏的素材。

![flow](https://img.shields.io/badge/flow-参考图→风格指南→规划→生成→审核→重画-e2562b)

## 功能

- 🎨 **风格提炼**：Claude 视觉分析参考图，保存结构化风格指南，项目内所有后续生成都复用它
- 🧩 **10 类游戏素材**：角色、精灵表、敌人、道具图标、地图瓦片、场景物件、背景、UI、特效、头像
- 🔁 **自审闭环**：每张图生成后 Claude 会对照参考图打一致性分（1–10），不合格自动重画（每张最多 2 次）
- 🧬 **跨素材一致性**：可把已通过的素材（如主角设定图）作为额外参考，画同一角色的动画帧 / 头像
- ⚡ 并行生成、SSE 实时日志（含思考摘要）、可随时停止、刷新页面自动续接任务
- 🔌 图像模型可插拔：OpenAI `gpt-image-1`（多图参考 edits）、Google Gemini Image、离线 Mock

## 快速开始

```bash
npm install
cp .env.example .env   # 填入 ANTHROPIC_API_KEY 以及 OPENAI_API_KEY / GEMINI_API_KEY 之一
npm start              # http://localhost:5173
```

没有任何 key 时可先体验界面：

```bash
AGENT_MODE=demo npm start
```

演示模式不调用 Claude，用脚本跑一遍「风格提取 → 生成 → 入库」，图像用本地 Mock 占位图。

## 架构

```
public/            原生 HTML/CSS/JS 前端（无构建步骤）
src/server.ts      Express API + SSE 事件流
src/agent.ts       Claude 智能体循环（Anthropic TypeScript SDK，手写 tool-use loop）
src/imageProviders.ts  OpenAI / Gemini / Mock 图像通道 + sharp 图像处理
src/store.ts       基于文件系统的项目存储（data/projects/<id>/）
```

Agent 工具：

| 工具 | 作用 |
|---|---|
| `save_style_guide` | 保存从参考图提炼的风格指南（含英文 `prompt_prefix`） |
| `generate_image` | 调用图像模型；自动附带参考图，可额外附带已有素材；结果图片回传给 Claude 查看 |
| `review_asset` | 记录通过/驳回、一致性评分和原因 |

默认模型 `claude-opus-5-5`（adaptive thinking，effort 可通过 `CLAUDE_EFFORT` 调整），已开启服务端 refusal fallback（`fallbacks: "default"`）和 prompt caching。

## 配置

见 [.env.example](.env.example)。数据保存在 `data/`（已 gitignore）。

## License

MIT
