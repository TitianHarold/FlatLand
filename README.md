# FlatLand · 平面国场景工作台

用同一套镜头、发光、视野与行为配置，调试房屋、色彩检阅场、星野和同心圆场景。

## 目录

```text
web/                       网页工程
  index.html               网站首页，进入场景工作台
  studio.html              场景工作台
  world.html               共用 3D 场景
  character-lab.html        角色实验室
  study-000.html           光线实验室
  src/                     渲染、交互、光学和样式
  public/                  静态素材
  tests/                   模型、光学和浏览器检查
  package.json             启动、测试与构建命令
  vite.config.js           多页面构建配置
  dist/                    构建后生成的部署文件，不提交
doc/                       实验记录与历史原型
.github/workflows/pages.yml GitHub 检查与 Pages 部署
```

之前的设计记录、光学规则和技术决策完整保存在 [doc/README.md](doc/README.md)。独立的[四维几何原型](doc/four-dimensional-lab.html)随文档保留，不包含在网页部署产物中。

## 本地运行

使用 Node.js 24 LTS，在仓库根目录执行：

```sh
cd web
npm ci
npm run dev -- --port 5173 --strictPort
```

打开 [场景工作台](http://127.0.0.1:5173/studio.html)。浏览器配置仍使用原来的保存键；同一域名下已有配置会继续恢复。

镜头选项使用「画面未矫正」与「画面矫正」：前者按直线接收面投影，匀速转头时边缘移动更快；后者按角度均匀展开，匀速转头时画面匀速移动。两者内部参数仍为 `perspective` 与 `equidistant`，兼容已保存的选择。

区分度增益为 0～+3：0 完全关闭几何明暗增强，正值逐档增强；可选“柔和”（默认）、“绒面”和“锐利”，染色与灰度都可使用。旧配置中的负区分度会迁移为 0，其他参数保持不变。

“光线衰减”和“散射模糊”分为两个面板，各有独立开关与距离，也可同时启用。视野范围控制亮度归零的边界；散射范围只控制到多远达到最大模糊，超过后保持，不截断物体。两项跨场景自动保存。俯视画布支持滚轮和按钮缩放，每次切场景自动适配实际建筑与角色的边界；左上角统一显示画布宽 × 高，随缩放更新。基础实验室采用与工作台相同的导航栏，可直接返回并恢复之前的场景和参数。小地图朝向设置也随配置保存。

## 验证与构建

以下命令在 `web/` 中运行：

```sh
npm test
npm run build
npm run preview
```

启动开发服务后，打开 [浏览器渲染检查](http://127.0.0.1:5173/tests/verify-render.html) 验证实际 WebGL 画面与四场景通用参数。检查会修改当前域名下的测试配置，使用独立端口可与日常调试隔离。

`npm run build` 只输出网页到 `web/dist/`；文档、测试页和开发依赖不进入发布内容。页面与资源使用相对路径，支持 GitHub Pages 的 `/FlatLand/` 子路径。

## GitHub Pages

仓库：[TitianHarold/FlatLand](https://github.com/TitianHarold/FlatLand)。

推送 `main` 会运行测试和构建；发布网站由你手动触发：

1. 仓库 **Settings → Pages → Source** 选择 **GitHub Actions**。
2. 在 **Actions → GitHub Pages → Run workflow** 选择 `main` 运行。
3. 工作流发布 `web/dist/`，网站入口为 `https://titianharold.github.io/FlatLand/`；最终地址以部署任务输出为准。

当前仓库为私有，GitHub Pages 需要账号套餐支持私有仓库发布；仓库可见性不因本工作流改变。配置方式参考 [GitHub Pages 官方文档](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) 和 [Vite 相对路径构建说明](https://vite.dev/guide/build.html#relative-base)。
