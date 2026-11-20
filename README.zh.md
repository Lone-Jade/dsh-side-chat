# 侧边聊天（Side chat）— DeepSeek Harness 插件

在右侧栏开一个与主对话**并行**的独立会话：围绕当前任务提问、解释报错、讨论方案、了解主对话在做什么——不打断主对话，也不给侧边聊天任何改动工作区的能力。

![侧边聊天图标](assets/icon-180.png)

> **已收录于 DSH 插件市场：** [Lone-Jade/dsh-side-chat](https://awesome-dsh-plugin.com/p/Lone-Jade/dsh-side-chat/)。

## 特性

- **真正的对话，不是弹窗。** 侧边聊天是右侧栏标签页里的一条普通 Session，直接复用原生输入框、流式输出、Markdown、停止、模型选择与复制。
- **理解主对话。** 每一步都携带主对话最近的用户/助手文本摘录（不含工具调用与工具结果，最多 12 条 / 约 6000 字符）。
- **只读由能力组合保证。** 侧边会话运行 `side-chat` 预设，只组合 `read`、`read_image`、`glob`、`grep`、`web_search`、`web_fetch`；没有 shell、没有 `write`/`edit`、没有 patch 工具。
- **引用选中文本。** 在主对话选中文字后，可插入侧边聊天草稿为引用块；过长时控件只显示「开头…结尾」，插入的仍是完整内容。
- **线程持久化。** 每个主对话保留一条当前侧边线程；重开标签页或刷新页面后恢复。
- **两个入口。** 主对话标题栏的气泡按钮，以及右侧栏指南页的「侧边聊天」卡片。

## 安装

### 从插件市场

插件 → **发现（Discover）** → 搜索 **Side chat**，点击安装。已收录于 [DSH 插件市场](https://awesome-dsh-plugin.com/p/Lone-Jade/dsh-side-chat/)。

### 从本目录

插件 → **添加插件** → 选择本目录，或在会话中执行：

```text
plugin_manager install_bundle <本目录绝对路径>
```

### 从 npm

包发布后：

```sh
dsh plugin --profile <profile> add @lonejade/dsh-side-chat
```

## 使用

1. 打开一个会话。
2. 点击主对话标题栏的气泡按钮，或右侧栏指南页的「侧边聊天」卡片。
3. 提问。侧边聊天以主对话为背景回答，主对话继续运行、不受影响。
4. 在主对话选中文字，侧边聊天输入框会出现引用控件，点击即可把引用块插入草稿。
5. 「新对话」为同一主对话开一条新线程。

## 工作原理

两半共享同一个契约：侧边 Session 的 id。

```text
sidechat__<主会话id>__<代数>
```

- 浏览器半用 `ctx.sessions.create` 以 `agentPreset: 'side-chat'` 和主会话的 `cwd` 创建该 Session，保留引用，并在右侧栏标签页中渲染共享的 `conversation.content`（`variant: 'embedded'`）。
- Host 半在 `agent/created` 中解析出主会话 id，在该 Agent 的上下文注册一个 **complete** 系统提示段：每步从主会话实时读取最近的 `user/message` 与 `assistant/message` 文本，按日志长度缓存。
- 预设只组合只读工具，因此「不写工作区」是能力事实，不是提示词承诺。

没有新增 Host Remote、事件类型或工具；其余全部使用现有公开接缝：`ctx.sidebarRightTabs`、`sidebar.right.pane.tab`、`conversation.session.header.utilities`、`conversation.input.left`、`ctx.sessions`、`ctx.systemPrompt`。

## 要求

- DeepSeek Harness `0.2.1` – `0.2.x`（`engines.dsh`）。
- profile 中已配置可用的模型路由（侧边聊天使用 profile 默认模型，可在内嵌输入框的模型选择器中单独切换）。

## 已知限制

- `side-chat` 预设会出现在「新建会话」的预设选择器中（自定义分组、最后一位、标注只读），因为预设没有隐藏标志。
- 侧边 Session 不属于任何工作区，因此不会出现在左侧会话树中。
- 「新对话」后旧线程留在磁盘，暂未提供清理入口。
- 不提供「回写主对话」按钮——那会改动主对话，本插件刻意不做。

## 开发

纯 JavaScript，无构建步骤。

| 文件 | 作用 |
|---|---|
| `index.js` | Host 半：按 Agent 注册系统提示段与主对话摘录。 |
| `client.js` | 浏览器半：标签页类型、主体、指南卡片、标题栏按钮、引用控件、侧边会话 store。 |
| `cordis.patch.yml` | 插入 Host 行与 `side-chat` 预设。 |
| `locale/*.json` | 插件标题、描述、详情页路径。 |
| `docs/DETAIL.md` | 插件详情页。 |
| `icon.svg` | 插件与指南图标。 |
| `assets/icon-180.png` | 市场目录图标（180×180 PNG）。 |

把本目录作为 bundle 安装即可试用；刷新页面加载新的浏览器半。

## 发布

见 [docs/PUBLISH.md](docs/PUBLISH.md)。

## 许可证

MIT — 见 [LICENSE](LICENSE)。
