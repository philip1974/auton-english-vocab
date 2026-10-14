# AGENTS.md

- 所有问答和文档使用中文，代码标识符使用英文。
- 这是 Auton Knowledge 的运行时插件：源码在 `src/*.mjs`，通过 esbuild 打包成单文件 `main.mjs`。
- 所有面向用户的文字必须走 `uiText(locale)`；支持 `en` / `zh` / `ja` / `ko`，缺省 `en`。
- 先写测试再实现（Red → Green → Refactor）；收尾跑 `pnpm check`。
