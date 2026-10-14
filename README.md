# English Vocab / 英语生词本

English Vocab 是一个 Auton Knowledge 运行时插件，用来把阅读中的英文词汇收进知识库，并用 FSRS 间隔重复安排复习。

English Vocab is an Auton Knowledge runtime plugin for collecting English words from reading and reviewing them with FSRS spaced repetition.

## 功能 / Features

- 右侧面板 `English Vocab`：今日复习、生词本搜索、熟悉度标记、忽略与恢复。
- 三种复习形式：翻卡、反向拼写、听音拼写。听音拼写会先调用 `speechSynthesis.cancel()`，因此会打断正在进行的朗读；没有英语声音时会禁用。
- 选区动作「收为生词」支持 reading 和 web 两个 surface，会把请求追加到 Auton Knowledge 对话框，由 Agent 调用 `vocab_add`。网页里的右键收词需要开启了选区共享的网页面板，例如 Browser Panel 0.7.0 或更新。
- 正文标色与点词卡片：在阅读正文里标出已收的词；点击后显示释义、例句、熟悉度、朗读按钮，并可直接标记「认识 / 不认识」。
- Agent 工具：
  - `vocab_lookup { word }`
  - `vocab_add { entries }`

## 正文标色与点词卡片 / Reading highlights and word cards

插件会把生词本里的词条和常见变形提交给宿主的 `readingDecorations` API。宿主负责正文匹配和高亮颜色；插件只提供词表，并在用户点击已标出的词时渲染卡片。

面板顶部的「在正文里标出已收的词」开关默认开启，偏好保存在插件数据中，不随知识库根目录切换。关闭后会释放已注册的正文标色；再次开启会按当前生词本和复习状态重建词表。

点词卡片会显示：

- 原词与词条，例如 `running → run`。
- 熟悉度徽标、释义和前两条例句。
- 「Good / Again」评分按钮；评分后会更新复习进度、重建正文词表，并显示「撤销」。
- 朗读按钮，使用浏览器的 `speechSynthesis` 读词条。

Reading highlights require an Auton Knowledge host that supports `readingDecorations`. On supported hosts, collected words and common inflections are highlighted in reading text, and clicking a highlighted word opens a compact vocabulary card with the definition, examples, familiarity, speech, rating actions, and undo.

## 权限 / Permissions

插件声明：

- `knowledge.read`：读取 `wiki/vocab/*.md` 和核实 `wiki/` 出处。
- `knowledge.propose`：以提案方式创建或更新生词笔记。
- `agent.tools`：注册 `vocab_lookup` 与 `vocab_add`。

The plugin does not send proposals automatically from the panel. `vocab_add` submits one review proposal and returns before the host finishes review.

## 数据位置 / Data

生词笔记保存在知识库内：

```text
wiki/vocab/<slug>.md
```

每篇笔记通过 frontmatter 的 `word` 字段识别词条；文件名或 H1 改动不会影响复习进度。

复习进度保存在宿主的插件存储里：

```text
~/.auton/apps/auton-knowledge/plugin-files/dev.auton.english-vocab/<rootKey>/review.json
~/.auton/apps/auton-knowledge/plugin-files/dev.auton.english-vocab/<rootKey>/log.json
```

进度按知识库文件夹的物理路径分开保存（移动或改名知识库文件夹后，进度不会跟着走），插件卸载时由宿主删除。

## 版本要求 / Requirements

需要 Auton Knowledge 0.3.0 或更新版本，因为插件依赖：

- `this.app.storage`
- `this.app.selectionActions`
- `this.app.chat`
- `knowledge.root-changed`

如果这些能力缺失，插件只显示「需要 Auton Knowledge 0.3.0 或更新」，不会抛错，也不会注册依赖这些能力的入口。

Requires Auton Knowledge 0.3.0 or newer. Older hosts show a compatibility message without crashing.

正文标色是可选增强能力：需要支持 `readingDecorations` 的 Auton Knowledge。旧版宿主不会显示「在正文里标出已收的词」开关，也不会在正文里标色；收词、复习、Agent 工具和生词本列表仍照常工作。

Reading highlights are optional. Older Auton Knowledge builds that do not expose `readingDecorations` simply omit highlights and the highlight toggle; the rest of the plugin continues to work.

## 已知未做 / Known limitation

宿主目前没有向运行时插件开放“打开知识库文档”API，因此生词本不提供“打开笔记”按钮。笔记仍可在知识库文件树中打开。

The runtime host does not currently expose an API for opening a knowledge document, so the notebook does not show an “Open note” button. Notes remain available from the knowledge file tree.

## 开发 / Development

```bash
pnpm install
pnpm check
```

源码位于 `src/*.mjs`。`build.mjs` 使用固定版本 esbuild 打包为单文件 `main.mjs`，该产物需要提交，因为知识库 clone 插件后直接加载 `main.mjs`。
