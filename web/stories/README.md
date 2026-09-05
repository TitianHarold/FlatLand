# 故事目录

每部故事放在独立的 `<story-id>/` 目录中：`script.md` 保存剧本，`story.json` 保存播放器数据，`assets/` 保存需要的素材。Story ID 由 Agent 首次创建时自动生成，格式为 `story-<UUID>`；后续迭代沿用，不让用户填写。

故事列表自动读取 `*/story.json` 的 `title`、`description`，技术示例使用 `example: true` 并留在列表之外。无需修改 `src/` 中的登记文件。未提交的本地故事同样可以通过 `storyboard.html?story=<story-id>` 播放。

先阅读仓库根目录的 [AGENTS.md](../../AGENTS.md)。创作和本地预览可以反复迭代；使用者从本地播放器点击“上传故事”、把 Prompt 交给 Agent 后，先检查登录、Fork、预览与改动范围，再创建 PR。PR 只能包含该故事自己的目录，不能包括本说明或其他故事。

每部正式故事用自己的 `settings.json` 完整保存画面参数，格式为 `{version: 1, state: {shared: {...}, view: {...}}}`。故事不读取或改写游乐场保存的配置；游乐场导出值只能作为显式选用的创作参考。旧故事省略的字段使用程序内置默认值。

配色、光学与镜头参数属于故事配置；演员、动作和各幕是否染色属于 `story.json`。角色或动作指定的颜色优先于故事基础配色，`coloring: false` 保留无色时期。

大量同类角色可用 `groups` 生成实例，并使用 `scatter`、`fan`、`wander` 等规则编排。`face` 可持续朝向任意主角，`sway` 控制原地摆动；固定 `seed` 让重播保持一致，关键剧情仍可逐人指定动作。
