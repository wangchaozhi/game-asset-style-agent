# Roadmap

每次迭代从上往下取**一个**未完成项，实现 → 类型检查 → demo 模式下在浏览器验证 → 勾选 → 提交推送。

- [x] 精灵表切帧：把 sprite_sheet 按帧数切成单帧 PNG，并支持导出 GIF 预览
- [x] 透明背景后处理：Gemini / 白底图自动抠图（基于边缘泛洪的近白色去除），生成透明 PNG
- [x] 一键打包导出：按类型分目录导出已通过素材 ZIP（附 style-guide.json 与 manifest.json）
- [x] 风格指南可编辑：前端直接修改色板 / 字段 / prompt_prefix 并保存
- [x] 素材手动审核：用户可在查看器中手动通过 / 驳回，并填写修改意见触发「按意见重画」
- [x] 多轮对话：同一项目内保留 Agent 对话上下文，支持追加指令（"把剑改成蓝色"）
- [x] 尺寸规格：按素材类型输出常用游戏尺寸（16/32/64 像素图标、像素风最近邻缩放）
- [x] 瓦片无缝检测与平铺预览（3×3 平铺查看接缝）
- [x] 成本与用量面板：记录每次运行的 Claude tokens 与图像调用次数
- [x] 工程模块化：后端按 agent / routes / providers / image / export / usage / store 分目录，前端拆为 ES modules 与分区样式
- [x] 单元测试：store / 工具输入校验 / mock provider（node:test）
- [x] GitHub Actions：typecheck + 测试
- [x] Dockerfile 与一键部署说明

## 第二轮

- [x] 中断任务处理：服务重启后把残留的「进行中」运行标记为已中断；优雅退出时中止进行中的任务
- [x] 可选访问令牌：设置 ACCESS_TOKEN 后所有页面与 API 需要登录
- [x] 色板一致性检测：量化素材颜色与风格色板的偏离，查看器展示，并附在 generate_image 结果里供 Agent 审核参考
- [x] 图集导出：已通过素材打包成 atlas PNG + JSON（Phaser / TexturePacker 格式），精灵表额外导出 Godot SpriteFrames
- [ ] 批量操作：素材库多选，批量通过 / 驳回 / 删除 / 导出
- [ ] 图像通道请求单测：mock fetch 校验 OpenAI / Gemini 请求格式与错误处理
- [ ] ESLint + CI lint
