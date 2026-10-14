# English Vocab / 英语生词本

English Vocab 是一个 Auton Knowledge 运行时插件，用来把阅读中的英文词汇收进知识库，并用 FSRS 间隔重复安排复习。

English Vocab is an Auton Knowledge runtime plugin for collecting English words from reading and reviewing them with FSRS spaced repetition.

## 功能 / Features

- 右侧面板 `English Vocab`：今日复习、生词本搜索、熟悉度标记、忽略与恢复。
- 三种复习形式：翻卡、反向拼写、听音拼写。听音拼写会先调用 `speechSynthesis.cancel()`，因此会打断正在进行的朗读；没有英语声音时会禁用。
- 选区动作「收为生词」支持 reading 和 web 两个 surface，会把请求追加到 Auton Knowledge 对话框，由 Agent 调用 `vocab_add`。网页里的右键收词需要开启了选区共享的网页面板，例如 Browser Panel 0.7.0 或更新。
- 正文标色与点词卡片：在阅读正文里标出已收的词；点击后显示释义、例句、熟悉度、朗读按钮，并可直接标记「认识 / 不认识」。
- 生词率与推荐阅读：按设定词汇量估算英文文章生词率，在阅读区显示状态签，并按「适合、偏易、偏难」推荐下一篇文章。
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

## 生词率与推荐阅读 / New-word rate and reading recommendations

推荐阅读页会扫描 `wiki/**/*.md` 与 `docs/**/*.md` 中可导航的英文文章，跳过 `wiki/vocab/**`、`README.md`、`index.md` 和维护页。插件先判断文章是否以英文为主，再按词频排名、已收词状态和已掌握标记估算生词率；默认「适合」区间是 2–5%，参考 Nation 95%–98% 覆盖率。词汇量可设为 1000 / 2000 / 3000 / 5000 / 8000 / 12000 / 20000。

在支持 `readingStatus` 的宿主里，打开英文文章时，阅读区顶栏会显示类似「生词 4%·适合学习」的状态签；状态签的动作是纯数据 `{ kind: "open-panel", panelId: "english-vocab" }`，由宿主打开插件面板。插件不会让阅读区或学习页执行插件回调。

在支持 `learningSuggestions` 的宿主里，插件会把最多 3 篇推荐阅读交给学习页。点击建议需要宿主提供 `workspace.openDocument(path)`；旧宿主缺少 `readingStatus`、`learningSuggestions` 或 `workspace` 时，对应入口会隐藏或返回 false，收词、复习、正文标色和 Agent 工具仍照常工作。

已知限制：缓存为了控制体积，只为每篇文章保存 rank > 1000 或不在词频表中的词次，rank ≤ 1000 的 token 计入基础计数。因此如果用户把一个 rank ≤ 1000 的常用词收进生词本但尚未掌握，它不会被计入该文章的生词数。

The recommendations tab scans navigable English Markdown documents under `wiki/` and `docs/`, skips vocabulary and maintenance pages, estimates the new-word rate from the bundled wordfreq rank list plus your notebook state, and orders articles as suitable, easy, then hard. The default suitable range is 2–5%, based on Nation's 95%–98% coverage threshold.

Hosts that expose `readingStatus` can show a pure-data reading badge such as “New 4%·good for study”. Hosts that expose `learningSuggestions` can show up to three suggested readings on the learning page. `workspace.openDocument(path)` is used only when the host accepts the user gesture; older hosts simply hide or disable the corresponding affordance.

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
- 可选：`readingDecorations`、`readingStatus`、`learningSuggestions`、`workspace.scope()`、`workspace.openDocument(path)`

如果这些能力缺失，插件只显示「需要 Auton Knowledge 0.3.0 或更新」，不会抛错，也不会注册依赖这些能力的入口。

Requires Auton Knowledge 0.3.0 or newer. Older hosts show a compatibility message without crashing.

正文标色是可选增强能力：需要支持 `readingDecorations` 的 Auton Knowledge。旧版宿主不会显示「在正文里标出已收的词」开关，也不会在正文里标色；收词、复习、Agent 工具和生词本列表仍照常工作。

Reading highlights are optional. Older Auton Knowledge builds that do not expose `readingDecorations` simply omit highlights and the highlight toggle; the rest of the plugin continues to work.

## 许可证 / License

代码按 MIT 许可证发布，见 `LICENSE`。`package.json` 的 `license` 字段仅描述代码许可证。

`data/` 下的词频派生数据按 CC BY-SA 4.0 发布，署名与上游来源见 `data/LICENSE.md`。构建产物 `main.mjs` 内嵌了同一份词表，该内嵌部分同样按 CC BY-SA 4.0。该数据来自 `wordfreq` 3.1.1（Robyn Speer）并经过过滤、截取与只保留顺序的改编。

The plugin code is MIT licensed. Derived word frequency data under `data/` is licensed separately under CC BY-SA 4.0; see `data/LICENSE.md` for attribution and source notes. The word list embedded in the built `main.mjs` is covered by the same CC BY-SA 4.0 terms.

## 开发 / Development

```bash
pnpm install
pnpm check
```

源码位于 `src/*.mjs`。`build.mjs` 使用固定版本 esbuild 打包为单文件 `main.mjs`，该产物需要提交，因为知识库 clone 插件后直接加载 `main.mjs`。
