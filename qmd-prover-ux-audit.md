# qmd-prover 首次接触 UX 审计

日期：2026-07-15  
审计项目：`examples/godel-completeness/`  
审计视角：把 qmd-prover 当作第一次接触的工具，仅从 `skills/qmd-prover/SKILL.md` 和 CLI 自身输出探索。

## 审计约束与方法

- 唯一主动读取的项目外文件是 `skills/qmd-prover/SKILL.md`。
- 未主动读取源码、其他文档、测试、项目 `AGENTS.md`、QMD、JSON 或生成文件内容。
- 文件路径、语义 ID 和 submission ID 仅从目录名、CLI help 和 CLI 运行输出中发现。
- 未修复数学项目，未删除、重置、暂存或提交内容。
- 为在系统 PATH 缺少独立 Pandoc 时继续审计，在 `/tmp` 创建了一个将参数转发给 `quarto pandoc` 的临时包装器。
- 审计覆盖默认 JSON、`--print`、有效参数、常见错误参数、dependency 图查询、写入型命令、失败写入门和旧入口探测。

## 总结

SKILL 能识别 24 个叶子命令，CLI 实际公开的叶子命令也正好是这 24 个；全部已运行。项目机械分析成功：1 个主目标、7 个 QMD note、32 个事实、0 个机械错误。由于 verifier 未配置，32 个事实均为 `local=not-run`、`global=unverified`。

最主要的 UX 问题是：查询型命令输出远超查询本身所需，`--print` 仍不简洁；dependency 命令重复解析全项目并刷新状态；doctor 会把 `QMD_PROVER_PANDOC=quarto` 误判为有效 Pandoc；help 对多词子命令显示不完整；JSON usage 错误又额外输出重复纯文本；scope、closure、snapshot 和成功状态不够清楚。

没有发现可工作的退役兼容命令。常见旧入口只返回 `Unknown command`，且不给迁移建议。

## 1. 仅根据 SKILL.md 识别出的命令

```text
doctor [--print]
init [--adopt-existing|--append-contract|--sync-contract]
inspect project [--print]
inspect fact @ID [--print]
inspect path FILE_OR_FOLDER [--print]
dependency dependencies @ID [--print]
dependency reverse dependencies @ID [--print]
dependency impact @ID [--print]
dependency frontier @ID [--print]
dependency path @FROM @TO [--print]
dependency alternative paths @FROM @TO [--limit N] [--max-depth N] [--print]
dependency cycles [--print]
dependency findings [--print]
dependency unused imports [--print]
dependency unused exports [--print]
dependency isolated [--print]
dependency unreachable [--print]
dependency ready for ai [--print]
dependency reused [--limit N] [--print]
dependency search QUERY [--kind KIND] [--status STATUS] [--origin ORIGIN] [--path PATH] [graph filters] [--print]
check staleness [--print]
verification list
verification show SUBMISSION_ID
render [--allow-errors]
```

## 2. 实际发现并测试的 help 命令

以下命令均逐条实际调用并退出 0：

```text
node ../../skills/qmd-prover/scripts/qmd-prover.js
node ../../skills/qmd-prover/scripts/qmd-prover.js help
node ../../skills/qmd-prover/scripts/qmd-prover.js help doctor
node ../../skills/qmd-prover/scripts/qmd-prover.js help init
node ../../skills/qmd-prover/scripts/qmd-prover.js help inspect
node ../../skills/qmd-prover/scripts/qmd-prover.js help inspect project
node ../../skills/qmd-prover/scripts/qmd-prover.js help inspect fact
node ../../skills/qmd-prover/scripts/qmd-prover.js help inspect path
node ../../skills/qmd-prover/scripts/qmd-prover.js help dependency
node ../../skills/qmd-prover/scripts/qmd-prover.js help dependency dependencies
node ../../skills/qmd-prover/scripts/qmd-prover.js help dependency reverse
node ../../skills/qmd-prover/scripts/qmd-prover.js help dependency reverse dependencies
node ../../skills/qmd-prover/scripts/qmd-prover.js help dependency impact
node ../../skills/qmd-prover/scripts/qmd-prover.js help dependency frontier
node ../../skills/qmd-prover/scripts/qmd-prover.js help dependency path
node ../../skills/qmd-prover/scripts/qmd-prover.js help dependency alternative
node ../../skills/qmd-prover/scripts/qmd-prover.js help dependency alternative paths
node ../../skills/qmd-prover/scripts/qmd-prover.js help dependency cycles
node ../../skills/qmd-prover/scripts/qmd-prover.js help dependency findings
node ../../skills/qmd-prover/scripts/qmd-prover.js help dependency unused
node ../../skills/qmd-prover/scripts/qmd-prover.js help dependency unused imports
node ../../skills/qmd-prover/scripts/qmd-prover.js help dependency unused exports
node ../../skills/qmd-prover/scripts/qmd-prover.js help dependency isolated
node ../../skills/qmd-prover/scripts/qmd-prover.js help dependency unreachable
node ../../skills/qmd-prover/scripts/qmd-prover.js help dependency ready
node ../../skills/qmd-prover/scripts/qmd-prover.js help dependency ready for ai
node ../../skills/qmd-prover/scripts/qmd-prover.js help dependency reused
node ../../skills/qmd-prover/scripts/qmd-prover.js help dependency search
node ../../skills/qmd-prover/scripts/qmd-prover.js help check
node ../../skills/qmd-prover/scripts/qmd-prover.js help check staleness
node ../../skills/qmd-prover/scripts/qmd-prover.js help verification
node ../../skills/qmd-prover/scripts/qmd-prover.js help verification list
node ../../skills/qmd-prover/scripts/qmd-prover.js help verification show
node ../../skills/qmd-prover/scripts/qmd-prover.js help render
```

结果摘要：

- 叶子 help 的签名基本与 SKILL 一致。
- `help dependency` 把多词叶子压成 `reverse`、`alternative`、`unused`、`ready` 等中间节点。
- `help dependency ready` 只显示孤立的 `for`，看不到最终命令 `ready for ai` 的语义。
- 根 help 未列退役入口、兼容别名或迁移说明。
- `verification show` 的 help 不说明 submission ID 格式。

## 3. 全部叶子命令及结果摘要

成功解析项目时使用：

```text
env QMD_PROVER_PANDOC=/tmp/qmd-prover-pandoc-wrapper
```

### `doctor [--print]`

- `doctor` 无包装器时退出 2：Node 和 Quarto 可用，Pandoc 缺失，verifier 未配置。
- `doctor --print` 同样退出 2，文本相对简洁。
- 使用临时 Pandoc 包装器后退出 0。
- `QMD_PROVER_PANDOC=quarto doctor --print` 错误地退出 0 并声称 Pandoc 可用；随后 `inspect project` 对全部 7 个 QMD 报 `Unknown option --from`。

### `init [--adopt-existing|--append-contract|--sync-contract]`

- `init` 退出 0，状态为 `already-initialized`。
- CLI 发现 7 个 QMD、已有 qmd-prover state、外部基础模式 `unrestricted`。
- `init --adopt-existing`、`init --append-contract`、`init --sync-contract` 均退出 0，仍报告 `already-initialized`，未产生项目内容差异。
- 同时给出两个 mutation flag 时退出 1，互斥参数提示明确。

### `inspect project [--print]`

- 无 Pandoc 时退出 2，对同一缺失依赖分别产生 7 个 `PARSE_ERROR`；JSON 还带空 graph、空 findings 和空 verification 树。
- 成功时退出 0：1 个主目标、7 个 note、32 个事实、0 个错误。
- 默认 JSON 约 39,968 token，耗时约 2.8 秒。
- `--print` 仍约 7,583 token，耗时约 2.4 秒。
- `--print` 顶部错误显示 `files: 0`、`kinds: none`、`statuses: none`，但后面实际列出 7 个文件和 32 个事实。

### `inspect fact @ID [--print]`

- `inspect fact @thm-main-godel-completeness --print` 退出 0。
- 主目标机械层通过，直接依赖为 4 个；局部/全局统计覆盖 31 个事实的依赖闭包。
- 3 个最低 frontier 为 `@def-consistency`、`@def-fol-signature`、`@def-henkin-theory`。
- 裸 ID 和 `@ID` 均可用，输出规范化为 `@ID`。
- 未知 ID 退出 2，约 2.23 秒后返回 `FACT_UNKNOWN`。

### `inspect path FILE_OR_FOLDER [--print]`

- `inspect path workspace/semantics.qmd --print` 退出 0，scope 选中 1 个文件、11 个事实，但 verification 统计覆盖 20 个闭包事实。
- `inspect path workspace --print` 退出 0，选中 6 个 workspace 文件，但输出仍列出 workspace 外的 `completeness.qmd`；约 9,014 token。
- 不存在路径退出 2，返回 `PATH_NOT_FOUND`，速度较快。

### `dependency dependencies @ID [--print]`

- 对主目标返回 4 个直接依赖、30 个传递依赖。
- 默认 JSON 约 20,287 token。
- `--print` 已补充实测：退出 0，耗时约 2.31 秒，仍约 3,588 token。
- `--print` 不仅输出 target、direct 和 transitive，还输出全部 32 个事实及文件分组、项目全部依赖边、全部跨文件依赖。
- 未知 ID 退出 2，返回 `FACT_UNKNOWN`。

### `dependency reverse dependencies @ID [--print]`

- `@def-fol-signature` 有 3 个直接 dependents、29 个传递 dependents。
- `--print` 仍附带大范围图上下文，而非只显示 reverse dependencies。

### `dependency impact @ID [--print]`

- `@def-fol-signature` 影响 29 个事实，包括主目标。
- JSON 中每个 affected fact 都带完整身份、hash 和验证状态，结果远大于所需 ID 列表。

### `dependency frontier @ID [--print]`

- 主目标 frontier 为 3 个定义：`@def-consistency`、`@def-fol-signature`、`@def-henkin-theory`。
- 每个 frontier 节点都返回一条代表路径。

### `dependency path @FROM @TO [--print]`

- 主目标到 `@def-fol-signature` 的最短路径为四节点路径。
- 无路径时退出 0、`status: ok`、`path: none`，但仍输出约 3,366 token 的全图。
- FROM=TO 时正确返回单节点路径，但仍输出约 3,370 token 的全图。

### `dependency alternative paths @FROM @TO [options] [--print]`

- `--limit 3 --max-depth 8` 返回 3 条路径，`truncated=true`，`explored=9`。
- `--limit 0` 退出 1，正确说明合法范围为 1–25。

### `dependency cycles [--print]`

- 项目无环。
- 已有成功 published snapshot 后，移除 Pandoc 包装器再运行仍退出 2 并重新解析 7 个 QMD，说明它没有直接复用已发布图。

### `dependency findings [--print]`

- 0 个 unused imports。
- 0 个 unused exports。
- 0 个 isolated facts。
- 1 个 unreachable fact：`@lem-semantic-substitution`。
- 32 个 ready-for-AI candidates。
- 30 个 heavily reused facts。
- 即使显示端去掉顶层 graph，结果仍约 16,774 token，因为每个 fact 重复完整身份和状态。

### `dependency unused imports [--print]`

- 退出 0，空列表。

### `dependency unused exports [--print]`

- 退出 0，空列表。

### `dependency isolated [--print]`

- 退出 0，空列表。

### `dependency unreachable [--print]`

- 退出 0，1 个结果：`@lem-semantic-substitution`。

### `dependency ready for ai [--print]`

- 退出 0，32 个候选。
- 去掉顶层 graph 后仍约 7,461 token。

### `dependency reused [--limit N] [--print]`

- `--limit 5` 的前五名依次为 signature、terms、formulas、substitution、Hilbert calculus。
- `--limit nope` 退出 1，正确说明合法范围为 1–1000。

### `dependency search QUERY [filters] [--print]`

- `search model` 返回 6 个匹配。
- `search model --kind theorem --status candidate --origin fact --path workspace --used-by @thm-main-godel-completeness --direct` 精确返回 `@thm-consistent-model`。
- `search '' --related-to @def-fol-signature --reverse --direct` 返回 3 个直接 dependents。
- `search '' --frontier-of @thm-main-godel-completeness` 返回上述 3 个 frontier 定义。
- `search '' --cycle-participant --print` 返回 0 matches，输出较简洁。
- 非法 kind `proof` 退出 1，并列出合法 kind。

### `check staleness [--print]`

- 默认 JSON 退出 0，无 changed 或 invalidated，耗时约 2.24 秒。
- `--print` 退出 0，文本简洁。
- 它返回的 snapshot ID 为 `07fc…`，而 inspect/dependency 使用 `a2da…`；help 未解释两类 snapshot 的关系。

### `verification list`

- 退出 0，`submissions: []`。
- 空列表没有说明为何为空或如何产生 submission，因此无法自然继续有效的 `verification show` 链路。
- `verification list --print` 退出 1，只返回泛化的 `Invalid verification command`。

### `verification show SUBMISSION_ID`

- 因 list 为空，没有可用的有效 submission ID。
- 伪造 ID 退出 2，返回 `SUBMISSION_NOT_FOUND`，并正确建议先运行 `verification list`。
- 缺少 ID 时退出 1，但只返回 `Invalid verification command`，未指出缺少 submission ID。

### `render [--allow-errors]`

- 有效项目上退出 0，写入 status QMD、dependency SVG 和 status JSON，报告 `artifacts_trustworthy=true`。
- 无 Pandoc 且不带 `--allow-errors` 时退出 2，`artifacts_written=false`；文件大小和 mtime 均未变化。
- 无 Pandoc且带 `--allow-errors` 时退出 0，写入 `prepared-with-errors` 制品，明确报告 `artifacts_trustworthy=false`。
- 最后使用有效 Pandoc 包装器重新 render，恢复为可信制品。
- 重复 render 即使最终内容相同也刷新三个制品的 mtime。

## 4. 退役兼容命令探测

以下直接调用均退出 1、`Unknown command`，没有迁移建议：

```text
node ../../skills/qmd-prover/scripts/qmd-prover.js status
node ../../skills/qmd-prover/scripts/qmd-prover.js prepare
node ../../skills/qmd-prover/scripts/qmd-prover.js verify
node ../../skills/qmd-prover/scripts/qmd-prover.js submit
node ../../skills/qmd-prover/scripts/qmd-prover.js register
node ../../skills/qmd-prover/scripts/qmd-prover.js revoke
node ../../skills/qmd-prover/scripts/qmd-prover.js accept
node ../../skills/qmd-prover/scripts/qmd-prover.js reject
```

还探测了对应 help、连字符 operation 名、`verification submit/accept/reject/revoke` 等候选，也全部 unknown。因此本版本没有可从 CLI 自然发现的退役兼容层。

## 5. 痛点、复现与期望表现

| 来源 | 痛点与复现 | 实际表现 | 期望表现 |
|---|---|---|---|
| CLI | `QMD_PROVER_PANDOC=quarto doctor --print` | 退出 0，误报 Pandoc 可用；inspect 随后全部失败。 | doctor 应执行最小 Pandoc 兼容性检查。 |
| 环境 + CLI | 普通 `doctor` | Quarto 自带 Pandoc 3.8.3，但 PATH 无独立 pandoc，只建议安装。 | 自动发现 Quarto Pandoc，或提供可复制配置方式。 |
| CLI | 缺 Pandoc 时 `inspect project` | 同一根因重复 7 次，并返回大量空结构。 | 聚合一个根因和文件列表；失败时省略空结构。 |
| CLI | 成功 `inspect project` | 默认约 39,968 token，深层重复 facts、graph、findings、状态和 hash。 | 默认返回操作摘要；完整图显式请求。 |
| CLI + SKILL | `inspect project --print` | 仍约 7,583 token，不符合“concise”。 | 只显示总数、目标状态、关键 blockers 和诊断。 |
| CLI | `inspect project --print` | `files: 0 / kinds: none / statuses: none` 与后文矛盾。 | 统计字段与实际结果一致。 |
| CLI | `inspect path` | selected facts 与 closure verification 数量混在一起。 | 明确输出 `selected_facts` 和 `closure_facts`。 |
| CLI | `dependency dependencies --print` | 约 3,588 token，返回全部 32 facts、全边和跨文件边。 | 只返回 target、direct、transitive；全图由 `--include-graph` 开启。 |
| CLI | 任一 dependency 查询 | 每次约 2–4 秒，重新要求 Pandoc并刷新状态。 | 默认只读 published graph；`--refresh` 才重编译。 |
| CLI | path 无结果或 FROM=TO | 查询结果极小，但仍附全图；无路径仍 `ok:true`。 | 返回明确 `found`，并省略无关图。 |
| CLI | findings/ready/reused | 每个 fact 重复 hash、验证状态和相同 reason。 | 默认返回计数和精简 fact refs；详细对象分页展开。 |
| CLI | `help dependency` | 多词命令显示为半截；`help dependency ready` 只显示 `for`。 | 分组 help 直接列完整叶子命令。 |
| CLI | usage 错误 | 同时输出 JSON 和重复纯文本；合并流时顺序不稳定。 | JSON 模式只输出 JSON；文本仅用于 `--print`。 |
| CLI | verification 缺参数 | 只说 `Invalid verification command`。 | 精确指出缺少 submission ID 或不支持 `--print`。 |
| CLI | snapshot ID | staleness 与 project graph 使用不同 ID，关系未解释。 | 区分 source/cache/graph snapshot 字段。 |
| CLI/SKILL | inspect/dependency 副作用 | help 未说明会刷新 manifest、graph 和 snapshot 元数据。 | 每个命令明确标注 read-only、cache-write 或 canonical-write。 |
| CLI | 重复 render | 最终内容相同仍刷新 mtime。 | 内容无变化时返回 `changed:false`，不替换文件。 |
| CLI/SKILL | 旧入口 | 全部 unknown，无替代建议。 | 保留机器可读的退役迁移诊断。 |
| 项目数据 | verifier 未配置 | 32 个事实机械通过但全局均未验证，submission 为空。 | 摘要突出“机器有效、AI 未运行”，避免被理解成证明失败。 |
| 项目数据 | graph finding | 1 个 unreachable fact。 | 作为图卫生发现展示，不与错误混淆。 |
| Agent | 初次配置 | 很容易设置 `QMD_PROVER_PANDOC=quarto`，且 doctor 会误导为成功。 | CLI 应阻断错误配置，无需 agent 临时 wrapper。 |

## 6. P0/P1/P2 修改建议

### P0

未发现已证实的数据破坏、保护声明绕过或错误发布为“已验证”的问题，因此没有已证实 P0。

### P1

1. 修复 doctor 的 Pandoc 假阳性：执行最小 Pandoc JSON 兼容性检查，并支持 Quarto bundled Pandoc 或 command+arguments 配置。
2. dependency 查询默认只读 published snapshot，不重新解析全项目或刷新 canonical state；增加显式 `--refresh`。
3. 查询命令默认只返回查询结果；完整图改为 `--include-graph`，大列表增加 limit/pagination。
4. 修复 `--print` 的统计错误和 scope/closure 混淆，并保证真正简洁。
5. JSON 模式消除重复纯文本 stderr；所有 usage/domain 错误保持单一、稳定、可解析输出。
6. 分组 help 显示完整多词叶子命令，并为已退役旧入口提供替代命令。

### P2

1. 明确 `ok`、`found`、`complete`、`snapshot_published` 与数学验证状态的区别。
2. 为不同 snapshot 类型采用不同字段名，并在 help 中解释生命周期。
3. 聚合共同根因诊断；失败输出默认不携带空 graph/findings/verification 树。
4. `verification list` 为空时给下一步；`show` 缺参数时显示精确 usage。
5. 所有可能写状态的命令在 help 中列出具体路径和写入语义。
6. render 和 snapshot 写入先比较内容；无变化时保持 mtime 并返回 `changed:false`。

## 7. 本次运行产生的文件变化

项目内最终内容差异为无：运行前后 `git status --porcelain=v1` 均为空；没有修改 AGENTS.md、QMD、配置或数学内容。

以下状态/制品路径在审计中被重新写入或刷新 mtime，最终恢复到成功解析、`artifacts_trustworthy=true` 的状态：

- `.qmd-prover/diagnostics.json`
- `.qmd-prover/manifest.json`
- `.qmd-prover/graph.json`
- `.qmd-prover/graphs/latest.json`
- `.qmd-prover/graphs/a2da6c96cbb82831b775a3bf820896eac4c6ba7b19f5f3b01c39ef7449fb4588.json`
- `.qmd-prover/generated/proof-status.qmd`
- `.qmd-prover/generated/dependencies.svg`
- `.qmd-prover/reports/status.json`

项目外新增并保留了临时包装器：

- `/tmp/qmd-prover-pandoc-wrapper`

没有删除、重置、暂存或提交任何项目内容。
