# English Vocab / 英语生词本

English Vocab 是一个 Auton Knowledge 运行时插件，用来把阅读中的英文词汇收进知识库，并用 FSRS 间隔重复安排复习。

English Vocab is an Auton Knowledge runtime plugin for collecting English words from reading and reviewing them with FSRS spaced repetition.

## 0.7.0 修复

- 串行化复习写入，并在 revision 冲突后重放评分、撤销与状态操作。
- 修正词形还原、离线词典释义、笔记例句边界和推荐阅读容错。
- 改善面板输入保持、阅读卡片布局、状态文案与超大生词本降级行为。
- 评分日志采用可恢复待写队列，日志写入失败后会在下次加载时补齐。
- 收紧词性约束与词典建议排序，并补全无效笔记、不可读文章和刷新失败提示。
- 将阅读卡片撤销绑定到知识库与评分结果，避免切换知识库或后续评分后误撤销。
- 无词性笔记会从释义前缀推断词性；规则词形采用保守拼写，不再生成常见假词形。
- 跳过无变化的收词提案，并隔离损坏复习卡与不支持的存储版本。
- 严格校验复习存储结构，并用 generation 与条件撤销隔离切库、并发评分竞态。
- 支持运行时切换界面语言，改进首次使用空态、拼写输入与超大词表提示。
- 词形以随包离线词典为准：词典给出的变形需反向校验，规则只在词典缺该类变形时补充，并过滤与独立词条冲突的形式；`saw/left/rose` 等 17 个同形词经人工审定后不自动归并。
- 知识库切换收敛到单一一致性入口：事件在加载最早处注册并重放，静默切库可自愈，旧库的写入与计算不会落到新库。
- FSRS 卡片完整保存 `learning_steps`（旧卡按间隔推断）；当天新词额度单独记录，日志有数量与字节上限。
- 偏好保存串行化（最后一次操作获胜）；停用插件时会等待在途写入（最多 8 秒）并取消朗读、索引与推荐扫描。

已知限制：宿主的插件数据写入没有条件写入（CAS）或取消能力。如果一次偏好写入耗时超过 8 秒、停用时被迫放弃等待，且这次写入在新实例保存之后才落盘，那么较早的偏好可能覆盖较新的选择。正常存储下写入只需毫秒，这种情况只会在存储严重异常时出现。

Known limitation: host plugin-data writes have no compare-and-swap or cancellation. If a single preference write takes longer than the 8-second unload drain and lands after the re-enabled instance saves, the older preference can win. This only happens when storage is already badly degraded.

## 功能 / Features

- 右侧面板 `English Vocab`：今日复习、生词本搜索、熟悉度标记、忽略与恢复。
- 四种复习形式：语境、翻卡、反向拼写、听音拼写。语境模式优先显示笔记中的例句并整词挖空；听音拼写会先调用 `speechSynthesis.cancel()`，因此会打断正在进行的朗读；没有英语声音时会禁用。
- 选区动作「收为生词」支持 reading 和 web 两个 surface，会把请求追加到 Auton Knowledge 对话框，由 Agent 调用 `vocab_add`。网页里的右键收词需要开启了选区共享的网页面板，例如 Browser Panel 0.7.0 或更新。
- 正文标色与点词卡片：在阅读正文里标出已收的词；点击后显示释义、例句、熟悉度、朗读按钮，并可直接标记「认识 / 不认识」。
- 离线词典：点正文里任意英文词即可查 ECDICT 释义，支持 `ran → run` 这类变形还原，并可通过审阅提案一键收进生词本。
- 生词率与推荐阅读：按设定词汇量估算英文文章生词率，在阅读区显示状态签，并按「适合、偏易、偏难」推荐下一篇文章。
- Agent 工具：
  - `vocab_lookup { word }`
  - `vocab_add { entries }`

## 语境复习 / Context review

语境模式会从生词笔记的 `Examples` 中按复习日志轮换例句，并把目标词及其变形按完整单词替换为固定长度的 `_____`。正面只显示挖空后的句子和可用的文章来源；翻面显示单词、音标、释义、目标词高亮后的完整句子，以及整句朗读和 FSRS 四档评分。没有可用例句时，正面退回到“看义想词”，不会显示答案。

在阅读正文中点击已收录词时，如果当前句子尚未出现在该词的例句里，卡片会显示「加为例句」。插件会即时重读最新笔记，并通过 `knowledge.propose` 提交追加内容供用户审阅；它不会直接写入知识库。相对来源路径只在解析到 `wiki/` 或 `docs/` 下的 Markdown 文档时才可打开。

Context mode rotates usable examples according to the word's review-log count and replaces the target word and its inflections as whole tokens with a fixed `_____`. The front shows only the cloze sentence and an available reading source. The back shows the word, phonetic, definition, the full sentence with highlighted matches, sentence speech, and the same four FSRS ratings. Words without a usable example fall back to a definition prompt without revealing the answer.

For a collected word in reading text, the word card offers “Add as example” when the current sentence is new. The plugin rereads the latest note and submits the appended content through `knowledge.propose` for review; it never writes the note directly. Relative source paths open only after resolving to a Markdown document under `wiki/` or `docs/`.

## 离线词典 / Offline dictionary

0.5.0 随插件目录提交 `dict/a.mjs` 到 `dict/z.mjs`，运行时按首字母用 `import(new URL("./dict/<letter>.mjs", import.meta.url).href)` 懒加载，不联网，也不把词典打进 `main.mjs`。`dict/manifest.json` 只用于测试和审阅，运行时不读取。当前 `dict/` 约 11 MB；安装插件时需要宿主把 `dict/` 文件夹连同 `main.mjs` 一起复制。

阅读宿主若支持 `ReadingDecorationHandle.setLookupAnyWord(enabled)`，面板里的「点任意词查词典」默认开启。首次启用时会提示：现在点正文里任意英文词即可查词典，可在生词本面板关闭。旧宿主没有这个 API 时会自动降级：不会接管未装饰词点击，但已收录词卡片下方的词典区和面板查词框仍可用。

未收录词卡片显示音标、中文/英文释义、朗读与「收词」。卡片和面板里的「收词」都会发起 `knowledge.propose` 审阅提案，生成 `wiki/vocab/<slug>.md`；不会绕过审阅直接写知识库。目标词已由 frontmatter `word` 收录，或同 slug 路径已存在时，会显示「已在生词本」并跳过提案。词典没有命中时会显示「词典中没有这个词」，并可把解释请求追加到 Agent 对话框。

The offline dictionary is shipped as separate lazy-loaded `dict/*.mjs` chunks. Clicking any English word in reading text works on hosts that implement `setLookupAnyWord`; older hosts degrade gracefully to collected-word cards and the panel lookup box. The card/panel “Add word” action always submits a `knowledge.propose` review proposal and never writes notes directly.

## 浏览器面板里查词 / Look up words in the browser panel

在 Browser Panel 0.7 或更新版本中，右键网页上的英文词并选择「查词」，即可打开与阅读正文相同的离线词典卡片。卡片支持释义、朗读、收词和加为例句；收词或加例句通过 `knowledge.propose` 审阅，网页例句的来源写成 `<https://…>`。此功能还需要支持网页查词的 Auton Knowledge；旧宿主没有 `ReadingDecorationHandle.setWebLookup(enabled)` 时，插件会通过能力检测自动跳过，不影响正文查词和其他功能。

With Browser Panel 0.7 or newer, right-click an English word on a web page and choose “Look up” to open the same offline dictionary card used in reading text. The card supports definitions, speech, collecting the word, and adding the sentence as an example. Collection and example changes go through `knowledge.propose`, and web examples store their source as `<https://…>`. This also requires an Auton Knowledge host that supports web lookup; older hosts without `ReadingDecorationHandle.setWebLookup(enabled)` are detected and skipped without affecting reading-text lookup or other features.

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
- 可选：`ReadingDecorationHandle.setLookupAnyWord(enabled)`，用于点未装饰英文词查离线词典。
- 可选：`ReadingDecorationHandle.setWebLookup(enabled)`，用于在 Browser Panel 0.7+ 里右键网页英文词查词。

如果这些能力缺失，插件只显示「需要 Auton Knowledge 0.3.0 或更新」，不会抛错，也不会注册依赖这些能力的入口。

Requires Auton Knowledge 0.3.0 or newer. Older hosts show a compatibility message without crashing.

正文标色是可选增强能力：需要支持 `readingDecorations` 的 Auton Knowledge。旧版宿主不会显示「在正文里标出已收的词」开关，也不会在正文里标色；收词、复习、Agent 工具和生词本列表仍照常工作。

Reading highlights are optional. Older Auton Knowledge builds that do not expose `readingDecorations` simply omit highlights and the highlight toggle; the rest of the plugin continues to work.

## 许可证 / License

代码按 MIT 许可证发布，见 `LICENSE`。`package.json` 的 `license` 字段仅描述代码许可证。

`data/` 下的词频派生数据按 CC BY-SA 4.0 发布，署名与上游来源见 `data/LICENSE.md`。构建产物 `main.mjs` 内嵌了同一份词表，该内嵌部分同样按 CC BY-SA 4.0。该数据来自 `wordfreq` 3.1.1（Robyn Speer）并经过过滤、截取与只保留顺序的改编。

`dict/` 下的离线词典数据来自 ECDICT（MIT），来源为 <https://github.com/skywind3000/ECDICT>，固定提交 `bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b`。随包附带 `dict/LICENSE-ECDICT.md`，其中包含 MIT 原文、来源 URL、提交 SHA 和筛选改动说明。中文释义来自 ECDICT 汇编（早期词表、整理与贡献），插件仅做离线查词用途，不额外保证释义完整性或准确性。

The plugin code is MIT licensed. Derived word frequency data under `data/` is licensed separately under CC BY-SA 4.0; see `data/LICENSE.md` for attribution and source notes. The word list embedded in the built `main.mjs` is covered by the same CC BY-SA 4.0 terms.

Offline dictionary chunks under `dict/` are derived from ECDICT under the MIT License. See `dict/LICENSE-ECDICT.md` for the original license text, source URL, pinned commit, and filtering notes.

## 开发 / Development

```bash
pnpm install
pnpm check
```

源码位于 `src/*.mjs`。`build.mjs` 使用固定版本 esbuild 打包为单文件 `main.mjs`，该产物需要提交，因为知识库 clone 插件后直接加载 `main.mjs`。
