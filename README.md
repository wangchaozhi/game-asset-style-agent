# Game Asset Agent

[![CI](https://github.com/wangchaozhi/game-asset-style-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/wangchaozhi/game-asset-style-agent/actions/workflows/ci.yml)

上传几张风格参考图，由 Claude 担任「AI 美术总监」：先从参考图提炼可复用的**风格指南**（色板 hex、技法、线条、光影、视角、比例），再按你的需求规划素材清单、调用图像模型批量生成，**逐张看图审核**，风格跑偏就带着具体问题重画——最终得到一套看起来出自同一款游戏的素材。

![flow](https://img.shields.io/badge/flow-参考图→风格指南→规划→生成→审核→重画-e2562b)

## 功能

- 🎨 **风格提炼**：Claude 视觉分析参考图，保存结构化风格指南，项目内所有后续生成都复用它
- 🧩 **10 类游戏素材**：角色、精灵表、敌人、道具图标、地图瓦片、场景物件、背景、UI、特效、头像
- 🎯 **色板一致性检测**：在 Lab 色彩空间计算素材与风格色板的色差，给出色板内像素占比与主要色板外颜色；结果附在每次生成里供 Agent 审核，查看器也可查看
- 🔁 **自审闭环**：每张图生成后 Claude 会对照参考图打一致性分（1–10），不合格自动重画（每张最多 2 次）
- 🧬 **跨素材一致性**：可把已通过的素材（如主角设定图）作为额外参考，画同一角色的动画帧 / 头像
- 📦 **引擎可用的导出**：按类型分目录的 ZIP（含多尺寸、manifest、Godot 4 SpriteFrames `.tres`），以及图集 PNG + TexturePacker JSON（Phaser / PixiJS 可直接加载）和 Phaser 动画定义
- 💰 **成本可控**：实时用量与费用估算；单次运行可设图像次数 / 费用上限，达到后 Agent 停止出图并收尾；图像接口限流自动退避重试
- ⚡ 并行生成、SSE 实时日志（含思考摘要）、可随时停止、刷新页面自动续接任务
- 🔌 图像模型可插拔：OpenAI `gpt-image-1`（多图参考 edits）、Google Gemini Image、本地 Stable Diffusion WebUI（AUTOMATIC1111 / Forge，可选 IP-Adapter 参考图风格）、离线 Mock

## 快速开始

```bash
npm install
cp .env.example .env   # 填入 ANTHROPIC_API_KEY 以及 OPENAI_API_KEY / GEMINI_API_KEY / SD_WEBUI_URL 之一
npm start              # http://localhost:5173
```

没有任何 key 时可先体验界面：

```bash
AGENT_MODE=demo npm start
```

演示模式不调用 Claude，用脚本跑一遍「风格提取 → 生成 → 入库」，图像用本地 Mock 占位图。

## 部署

### Docker

```bash
cp .env.example .env          # 填入 key
docker compose up -d --build  # http://localhost:5173
```

数据保存在名为 `asset-data` 的卷里（容器内 `/data`）。改端口：`PORT=8080 docker compose up -d`。

不用 compose 时：

```bash
docker build -t game-asset-agent .
docker run -d -p 5173:5173 --env-file .env -v gaa-data:/data game-asset-agent
```

镜像为多阶段构建：先把 TypeScript 编译到 `dist/`，运行层只装生产依赖，以非 root 的 `node` 用户运行，并带 `/api/config` 健康检查。

### 直接用 Node（≥ 22）

```bash
npm ci && npm run build
NODE_ENV=production npm run start:prod
```

### 上线前注意

- 公网部署务必设置 `ACCESS_TOKEN`：开启后打开页面需先输入令牌登录（会话保存在 HttpOnly Cookie，30 天），脚本可用 `Authorization: Bearer <令牌>` 调 API；`/healthz` 始终开放供健康检查。不设置时任何能访问端口的人都能用你的 API 额度。
- 生成任务记录在内存里，同一份数据目录只运行**一个实例**；重启会中断进行中的任务（已生成的素材不受影响）。
- SSE 实时日志需要反向代理关闭缓冲（Nginx：`proxy_buffering off;`）。

## 开发

```bash
npm run typecheck   # tsc（strict + 未使用变量/参数检查，含 test/）
npm run lint        # ESLint，检查无类型检查的前端模块 public/js
npm test            # node:test + tsx：存储、工具校验、图像通道、图像处理、图集、ZIP、计费、鉴权与 HTTP API
npm run check       # 以上全部
```

测试使用临时 `DATA_DIR`，API 测试以演示模式在随机端口启动应用，不需要任何 API key。

## 架构

```
public/
  index.html             单页界面（原生 ES modules，无构建步骤）
  js/                    main（入口）· state · lib（DOM/HTTP 工具）· projects · refs · styleGuide
                         · assets（素材网格）· viewer（查看器）· run（运行与 SSE 日志）· usage（用量）
  css/                   base · layout · style-panel · run · assets · viewer · usage
src/
  server.ts              入口：读取 .env 并监听端口
  app.ts                 createApp()：组装中间件与路由（测试可直接挂载）
  config.ts              环境变量配置
  domain/assetTypes.ts   素材类型定义
  routes/                config · projects · refs · assets · export · jobs（运行/SSE）· usage
  agent/                 Claude 智能体
    tools.ts / schemas.ts  工具定义与 zod 输入校验
    prompts.ts             系统提示词与每轮开场
    loop.ts                手写 tool-use 循环（Anthropic TypeScript SDK）
    runTool.ts / assets.ts 工具执行、生成素材入库、精灵表切帧
    events.ts / jobs.ts    任务注册、事件广播、启动与收尾
    demo.ts                无 key 演示模式
  providers/             图像通道：openai · gemini · mock
  image/                 sharp 图像处理：io · background（抠图）· spriteSheet · tiles · sizes
  export/                ZIP 写入与素材包组装
  usage/                 tokens / 图像调用统计与费用估算
  store/                 文件系统存储（data/projects/<id>/）：projects · conversation · usage
```

Agent 工具：

| 工具 | 作用 |
|---|---|
| `save_style_guide` | 保存从参考图提炼的风格指南（含英文 `prompt_prefix`） |
| `generate_image` | 调用图像模型；自动附带参考图，可额外附带已有素材；结果图片和色板检测回传给 Claude 查看 |
| `review_asset` | 记录通过/驳回、一致性评分和原因 |

默认模型 `claude-opus-5-5`（adaptive thinking，effort 可通过 `CLAUDE_EFFORT` 调整），已开启服务端 refusal fallback（`fallbacks: "default"`）和 prompt caching。

## 配置

见 [.env.example](.env.example)。数据保存在 `data/`（已 gitignore）。

## License

MIT
