# 故事目录

每部故事放在独立的 `<story-id>/` 目录中：`script.md` 保存剧本，`story.json` 保存播放器数据，`assets/` 保存需要的素材。Story ID 由 Agent 首次创建时自动生成，格式为 `story-<UUID>`；后续迭代沿用，不让用户填写。

故事列表自动读取 `*/story.json` 的 `title`、`description`，技术示例使用 `example: true` 并留在列表之外。无需修改 `src/` 中的登记文件。未提交的本地故事同样可以通过 `storyboard.html?story=<story-id>` 播放。

先阅读仓库根目录的 [AGENTS.md](../../AGENTS.md)。创作和本地预览可以反复迭代；使用者从本地播放器点击“上传故事”、把 Prompt 交给 Agent 后，先检查登录、Fork、预览与改动范围，再创建 PR。PR 只能包含该故事自己的目录，不能包括本说明或其他故事。

可选的 `settings.json` 保存场景工作台“导出配置”得到的 JSON。可只写需要覆盖的字段；播放器逐字段合并，明确提供的字段覆盖工作台，省略的字段沿用浏览器已保存的工作台配置，再回退到默认值。脚本角色或动作的显式颜色优先，其他角色沿用配色方案；关闭显示染色时最终画面仍然无色。

例如，仅覆盖 FOV，其余配色、光学和窗口设置继续继承：

```json
{"version":1,"state":{"view":{"fieldAngle":100}}}
```
