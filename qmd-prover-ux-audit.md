# qmd-prover 首次接触 UX 审计

审计严格按约束执行：唯一主动读取的文件是 `../../skills/qmd-prover/SKILL.md`。未读取任何 AGENTS.md、QMD、JSON、源码、文档、测试或生成文件内容；项目线索只来自目录名、`git status` 和 CLI 输出。未修复、删除、重置、暂存或提交内容。

运行环境首先暴露了两个前置问题：

- 文档原样调用 `node ...` 失败，退出码 127：`node` 不在 PATH。
- 改用 Codex 自带 Node 后，CLI 可运行，但 Pandoc、Quarto 均不在 PATH，导致所有 QMD 解析失败。

以下用 `qmd-prover` 代表：

```text
/Users/xiaom/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node ../../skills/qmd-prover/scripts/qmd-prover.js
```

## 1. 仅从 SKILL.md 能识别出的命令

SKILL.md 能直接给出的精确命令是：

1. `qmd-prover init`
2. `qmd-prover init --adopt-existing`
3. `qmd-prover init --append-contract`
4. `qmd-prover init --sync-contract`
5. `qmd-prover workspace init @thm-main-ID`
6. `qmd-prover inspect fact @ID`
7. `qmd-prover inspect path PATH`
8. `qmd-prover inspect workspace @thm-main-ID`
9. `qmd-prover workspace inspect @thm-main-ID`
10. `qmd-prover inspect project`
11. `qmd-prover check staleness`
12. `qmd-prover submit proof PROPOSAL_FILE [--to QMD]`
13. `qmd-prover verification show SUBMISSION_ID`
14. `qmd-prover verification revoke @thm-ID --reason "..."`
15. `qmd-prover render`

SKILL.md 还描述了 dependency 的搜索、路径、循环、影响、frontier 等能力，但没有给出精确子命令。它要求另读 `references/cli.md` 才能获得完整清单；本次按限制没有读取。

SKILL.md 也没有告诉首次用户存在：

- `help`、`--help`、`-h`
- 15 个精确 dependency 叶子命令
- 大部分命令支持 `--print`
- `--limit`、`--max-depth` 和 search 过滤参数的有效值
- Node、Pandoc、Quarto 的安装/PATH 前提

`quarto render` 也被提到，但它不是 qmd-prover 命令。

## 2. Help 覆盖

以下 help 路径均实际调用，全部退出 0：

```text
qmd-prover
qmd-prover help
qmd-prover --help
qmd-prover -h
qmd-prover help init
qmd-prover help inspect
qmd-prover help inspect project
qmd-prover help inspect fact
qmd-prover help inspect path
qmd-prover help inspect workspace
qmd-prover help dependency
qmd-prover help dependency dependencies
qmd-prover help dependency reverse
qmd-prover help dependency reverse dependencies
qmd-prover help dependency impact
qmd-prover help dependency frontier
qmd-prover help dependency path
qmd-prover help dependency alternative
qmd-prover help dependency alternative paths
qmd-prover help dependency cycles
qmd-prover help dependency findings
qmd-prover help dependency unused
qmd-prover help dependency unused imports
qmd-prover help dependency unused exports
qmd-prover help dependency isolated
qmd-prover help dependency unreachable
qmd-prover help dependency ready
qmd-prover help dependency ready for
qmd-prover help dependency ready for ai
qmd-prover help dependency reused
qmd-prover help dependency search
qmd-prover help check
qmd-prover help check staleness
qmd-prover help workspace
qmd-prover help workspace init
qmd-prover help workspace inspect
qmd-prover help submit
qmd-prover help submit proof
qmd-prover help verification
qmd-prover help verification show
qmd-prover help verification revoke
qmd-prover help render
```

问题是大多数叶子 help 只有一行 Usage，没有用途、参数语义、枚举值、退出码、输出字段或副作用说明。

## 3. 实际发现的全部叶子命令及结果

| # | 完整叶子命令 | 实测结果摘要 | 是否符合预期；合理预期是什么 |
|---:|---|---|---|
| 1 | `qmd-prover init` | 退出 0，`already-initialized`；报告 contract v16、workspace root、1 个 QMD、无 Quarto 配置、external policy 为 unrestricted。未写入。 | **符合。** 对已初始化且契约当前的项目，应幂等退出 0、清楚报告现状，并且不写入。 |
| 2 | `qmd-prover inspect project [--print]` | 退出 2，7 个错误：workspace 未初始化、6 个 Pandoc 解析错误。默认 JSON 6,523 字节/181 行；`--print` 1,697 字节/28 行。 | **部分符合。** 缺 Pandoc 且 workspace 未初始化时应非零退出并列出根因；但合理输出应去重、减少空结构，并让 `--print` 保留受影响文件路径。 |
| 3 | `qmd-prover inspect fact @ID [--print]` | 退出 2；目标显示 `missing/unknown`，但 `mechanical.status` 却是 `pass`；附带 6 条 Pandoc 错误。实际也接受不带 `@` 的 ID。 | **不符合。** 无法解析或定位事实时，mechanical 应是 `blocked`/`not-run`，而不是 `pass`；ID 语法也应与 help 一致。 |
| 4 | `qmd-prover inspect path FILE_OR_FOLDER [--print]` | 对 `completeness.qmd` 退出 2、1 条 Pandoc 错误；对 workspace 目录退出 2、6 条错误；不存在路径得到结构化 `PATH_NOT_FOUND`。 | **大体符合。** 不存在路径应得到结构化错误，解析依赖缺失应非零退出；偏差是 `--print` 不应丢失诊断文件路径。 |
| 5 | `qmd-prover inspect workspace @thm-main-ID [--print]` | 退出 2；workspace `uninitialized`、target `missing`、files/facts 均为 0，6 条错误。非法非 `thm-main-*` ID 却抛原始堆栈。 | **部分符合。** 无法检查未初始化 workspace 时应失败；但非法 ID 应得到稳定的结构化参数错误，不能泄露堆栈。 |
| 6 | `qmd-prover dependency dependencies @ID [--print]` | 退出 2；聚合图为空，返回简短 `FACT_UNKNOWN`。 | **符合当前失败前提。** 空图中查询未知事实应返回 `FACT_UNKNOWN`；更理想的是同时指出图为空的上游原因。 |
| 7 | `qmd-prover dependency reverse dependencies @ID [--print]` | 退出 2；同样返回 `FACT_UNKNOWN`。 | **符合当前失败前提。** 未知事实无法计算反向依赖，应非零并返回明确的 `FACT_UNKNOWN`。 |
| 8 | `qmd-prover dependency impact @ID [--print]` | 退出 2；返回 `FACT_UNKNOWN`。 | **符合当前失败前提。** 未知事实没有可计算的影响范围；应避免把结果误报为空影响。 |
| 9 | `qmd-prover dependency frontier @ID [--print]` | 退出 2；返回 `FACT_UNKNOWN`。 | **符合当前失败前提。** 未知事实无法形成 frontier，非零退出合理。 |
| 10 | `qmd-prover dependency path @FROM @TO [--print]` | 退出 2；FROM、TO 相同时重复返回两条相同 `FACT_UNKNOWN`。 | **不符合。** 两端相同且未知时应只返回一条去重后的未知事实诊断；若事实存在，FROM=TO 的路径语义也应被明确说明。 |
| 11 | `qmd-prover dependency alternative paths @FROM @TO [--limit N] [--max-depth N] [--print]` | 退出 2；有效 limit/depth 可接受，但事实未知。非法 `--limit nope` 被事实未知错误抢先掩盖。 | **不符合。** CLI 应先校验参数类型和范围，再访问图；非法 limit 应稳定报告参数错误，不应被 `FACT_UNKNOWN` 掩盖。 |
| 12 | `qmd-prover dependency cycles [--print]` | 退出 2；返回空 graph/cycles，另附全部 7 条项目错误。 | **部分符合。** 聚合图无法可靠构建时应失败；但合理结果应突出“图不可用”，不应同时返回看似有效的空 cycles 和大量重复上下文。 |
| 13 | `qmd-prover dependency findings [--print]` | 退出 2；所有 findings 为空，同时附全部项目错误。默认 3,242 字节/77 行。 | **部分符合。** 分析失败时非零退出合理；findings 应标记 `not-computed`，而不是与“已计算但没有发现”相同的空数组。 |
| 14 | `qmd-prover dependency unused imports [--print]` | 退出 2；空结果，但带完整空 graph 和 7 条错误。 | **部分符合。** 图不可用时应失败；结果应是 `not-computed`，不应暗示确实不存在 unused imports。 |
| 15 | `qmd-prover dependency unused exports [--print]` | 退出 2；空结果，但带完整空 graph 和 7 条错误。 | **部分符合。** 图不可用时应失败；结果应区分“没有 unused exports”和“无法计算”。 |
| 16 | `qmd-prover dependency isolated [--print]` | 退出 2；空结果，带定义文本、空 graph 和 7 条错误。 | **部分符合。** 非零退出合理；空 facts 不应在失败态被理解为“没有 isolated facts”，且无需重复返回完整空 graph。 |
| 17 | `qmd-prover dependency unreachable [--print]` | 退出 2；`applicable:false`，同时带空 graph 和 7 条错误。 | **大体符合。** 没有可用 goal root 时 `applicable:false` 合理；应进一步区分“项目本来没有 root”和“解析失败导致 root 不可见”。 |
| 18 | `qmd-prover dependency ready for ai [--print]` | 退出 2；候选为空，带定义文本和 7 条错误。 | **部分符合。** 图/声明不可用时不能产生 AI 候选；应报告 `not-computed` 或 blocker，而不是普通空候选列表。 |
| 19 | `qmd-prover dependency reused [--limit N] [--print]` | 退出 2；默认 limit 20、结果为空。`--limit -1` 能正确报范围 1–1000，但使用原始堆栈。 | **部分符合。** limit 范围校验正确；但参数错误应结构化且无堆栈，图失败时空结果也应标记为不可计算。 |
| 20 | `qmd-prover dependency search QUERY [...] [--print]` | 退出 2；无法搜索空图。`--kind nonsense` 未被拒绝，直接作为过滤值进入输出。 | **不符合。** 未知枚举必须在扫描前拒绝并列出合法值；图不可用时应明确说明搜索未执行。 |
| 21 | `qmd-prover check staleness [--print]` | 退出 2；目标因 `main-goal-snapshot-changed`、`workspace-parse-incomplete`、`workspace-uninitialized` stale，并被 invalidated。只读。 | **符合。** 只读审计应准确列出 stale 原因和受影响事实；将检测到的不可用状态映射为非零退出也合理。 |
| 22 | `qmd-prover workspace init @thm-main-ID` | 有效 ID 退出 1，只给出 `Project has structural errors` 和堆栈，没有列出具体阻塞项；未创建 `workspace.json`。不带 `@` 也进入相同逻辑。 | **不符合。** 安全门阻止写入是合理的，但命令应返回具体 blocker 和下一步；尤其 inspect 已建议运行该命令，不能再以泛化错误形成恢复断链。 |
| 23 | `qmd-prover workspace inspect @thm-main-ID [--print]` | 退出 2；与 `inspect workspace` 基本相同，但 operation 名分别为 `workspace-inspect` 和 `inspect-workspace`。 | **部分符合。** 兼容别名应产生等价结果；稳定 JSON 中应使用同一个 canonical operation，可另设 `invoked_as` 标记入口。 |
| 24 | `qmd-prover submit proof PROPOSAL_FILE [--to QMD]` | 退出 2，稳定结构化 `retired`；真实文件和不存在文件结果完全相同，未读写参数目标。 | **符合。** 退役兼容命令应拒绝操作、写入为零，并提供迁移路径；不读取旧参数目标也符合 rejection safety。 |
| 25 | `qmd-prover verification show SUBMISSION_ID` | 无 CLI 可发现的 submission ID；使用未知 ID 时退出 1，直接抛 ENOENT 和内部源码堆栈，不是稳定 JSON。 | **不符合。** 未知 submission 应返回结构化 `SUBMISSION_NOT_FOUND`；还应有 `verification list` 或其他自然发现 ID 的入口。 |
| 26 | `qmd-prover verification revoke @thm-ID --reason "..."` | 退出 2，稳定结构化 `retired`。缺少必填 `--reason` 时也返回相同 retired 结果，没有参数校验。 | **部分符合。** 退役命令不写入且给 remediation 符合预期；但 help 与实现应一致，要么不再声明 reason 必填，要么仍校验旧语法。 |
| 27 | `qmd-prover render` | 退出 0，但状态是 `prepared-with-errors`，summary 有 7 个 errors；仍写入 3 个生成文件，并建议当前环境中不存在的 `quarto render`。 | **不符合。** 默认情况下存在 7 个错误应返回非零和 `ok:false`；若设计上允许错误产物，应要求显式 `--allow-errors`，并先检查建议的 Quarto 命令是否可用。 |

另外测试了未知命令、一级组缺参、叶子缺参、额外位置参数、冲突 init 选项、未知 ID/路径、非法 limit、非法枚举和不支持的 `--print`。大部分参数错误退出 1，但直接输出 Node 堆栈。

## 4. 痛点、复现与期望

| 来源 | 痛点 | 复现 | 期望 |
|---|---|---|---|
| 环境/技能 | 文档原样命令不可运行，Node 不在 PATH；随后 Pandoc/Quarto 也缺失。 | `node ../../skills/.../qmd-prover.js`；`inspect project` | SKILL 开头给出依赖预检；CLI 提供 `doctor` 或在根 help 显示缺失依赖及安装/配置方式。 |
| CLI | 用户输入错误泄露完整堆栈、内部源码绝对路径，破坏稳定 JSON。 | `qmd-prover frobnicate`、`inspect workspace @does-not-exist`、`verification show not-a-submission` | stderr 给简洁消息；stdout 始终为稳定 JSON，除非显式 `--print`。堆栈只在 `--debug` 下显示。 |
| CLI | `verification show` 对不存在记录抛原始 ENOENT。 | `verification show not-a-submission` | 结构化 `SUBMISSION_NOT_FOUND`，退出 2，并给发现 submission ID 的下一步。 |
| CLI/技能 | 没有 submission 列表或搜索命令，`show` 无法自然衔接。 | 检查所有 help 后只有 `show SUBMISSION_ID` | 提供 `verification list`，并在 inspect 结果中稳定返回可复制的 submission ID。 |
| CLI | `render` 在 7 个错误下仍退出 0，并写文件。 | `qmd-prover render` | 默认退出非零并返回 `ok:false`；若允许错误产物，应要求 `--allow-errors`，且清楚标记生成物不可信。 |
| CLI | 人类可读 `--print` 丢失诊断文件路径。 | `inspect project --print` | 每条诊断保留 `file[:line]`；相同 Pandoc 错误可按原因聚合并列出受影响文件。 |
| CLI | 默认失败 JSON 过大且重复。 | `inspect project` | 顶层只保留一次 diagnostics；空 graph/findings/verification 可用摘要或 `--verbose` 展开。 |
| CLI | 同类 dependency 命令失败体积不一致。 | 比较 `dependency dependencies @ID` 与 `dependency findings` | 统一 envelope；先给“聚合图不可用”的根因，再按需附详情。 |
| CLI | `inspect fact` 在事实 missing、解析失败时仍显示 `mechanical: pass`。 | `inspect fact @thm-main-godel-completeness` | 使用 `not-run`/`blocked`，并明确 blocked by parse failure；不能出现表面“机械通过”。 |
| CLI | workspace 修复指引不能自然闭环。 | `inspect project` 建议运行 `workspace init`，随后 `workspace init` 只报泛化 structural errors | init 应直接返回阻塞诊断，特别区分 Pandoc 缺失、主目标不可解析和 workspace 已有文件。 |
| CLI | help 要求 `@ID`，实现却接受不带 `@`。 | `inspect fact thm-main-godel-completeness`、`workspace init thm-main-godel-completeness` | 要么严格拒绝，要么 help 明确两种形式并统一规范化。 |
| CLI | 非法枚举被静默接受。 | `dependency search godel --kind nonsense` | 在构图前校验枚举，列出合法 `kind/status/origin` 值。 |
| CLI | 参数校验顺序不稳定。 | `alternative paths ... --limit nope` | 先完成所有语法与类型校验，再读取图或检查事实存在性。 |
| CLI | 同一个别名使用不同 operation 名。 | `inspect workspace` vs `workspace inspect` | alias 输出同一 canonical operation，并另加 `invoked_as`。 |
| CLI | `init extra`、`init --print` 的错误消息误称“只能选一个 mutation option”。 | 相应命令 | 区分未知参数、位置参数和互斥选项。 |
| CLI | 退役 `revoke` 的 help 仍声明必填 reason，但实现完全忽略。 | `verification revoke @thm-main-godel-completeness` | 退役命令 help 应只说明 retired；或者仍严格校验旧语法，二者选一。 |
| 技能/help | SKILL 只用自然语言提到 dependency 能力；help 多数叶子只有 Usage。 | 从 SKILL 建表，再递归 help | SKILL 至少给完整可复制清单；leaf help 增加描述、参数语义、枚举、退出码、输出模式和副作用。 |
| 项目数据 | 已有活跃 QMD 的 workspace 缺少 `workspace.json`，snapshot stale。 | `inspect project`、`check staleness` | 给出单一、可执行且不会被同一状态再次阻塞的恢复路径。 |
| 性能/验证 | 每个全图 dependency 命令都会再次遇到相同 7 条解析错误。 | 连续调用 cycles/findings/unused/isolated/search | 缓存“依赖缺失/解析不可用”的预检结果，避免重复工作和重复上下文。 |

本次没有配置 verifier，所有结果均显示 `available:false`、`verifier_calls:0`，因此无法评估重复 AI 验证、cache hit 或 verifier 性能。

## 5. 按优先级排序的修改建议

### P0

未观察到 canonical QMD 被改写、用户内容被删除、失败提交被提升或其他数据破坏，所以本次没有确认的 P0。

### P1

1. 所有错误统一为稳定结构化输出，默认隐藏堆栈；修复 `verification show` 的 ENOENT。
2. 修正 `render` 的成功语义：有错误时非零退出，或要求显式 `--allow-errors`。
3. 解决 workspace 初始化断链：`workspace init` 必须返回具体 blocker，并能处理“已有 QMD、缺 workspace.json”的预期恢复场景。
4. `--print` 保留诊断文件路径，同时聚合重复 Pandoc 错误。
5. 在执行项目扫描前校验所有参数、枚举和数值；拒绝 `--kind nonsense`。
6. missing/parse-failed 事实不得显示 `mechanical: pass`。
7. 增加 `doctor`/依赖预检，并在 SKILL 主页面明确 Node、Pandoc、Quarto 前提。
8. 增加 `verification list`，让 submission ID 可被自然发现。

### P2

1. SKILL 增加完整 dependency 命令清单；leaf help 增加描述、示例、合法枚举和副作用。
2. 减少失败 JSON 的空结构、嵌套和重复 diagnostics。
3. 统一 `@ID` 是否必需，以及 alias 的 operation 名。
4. 改进 init 的未知参数/互斥选项错误消息。
5. 明确 retired 命令是否还校验旧参数；保持 help 与实现一致。
6. FROM 与 TO 相同时避免重复两条相同 `FACT_UNKNOWN`。
7. 在 `render` 输出中检查 Quarto 是否存在，不要仅给一个当前不可执行的命令。

## 6. 本次运行产生的文件变化

运行前已经存在：

- `todo` 的已修改状态；
- 14 个未跟踪的 qmd-prover 配置、图、验证索引和 workspace QMD 文件。

这些不是本次产生。

本次可确证由 `qmd-prover render` 新增了 3 个未跟踪文件：

- `.qmd-prover/generated/dependencies.svg`
- `.qmd-prover/generated/proof-status.qmd`
- `.qmd-prover/reports/status.json`

未创建 `workspace.json`。未删除、重置、暂存或提交任何内容。因为基线中的 qmd-prover 状态文件本来就未跟踪，且本次禁止读取或预先哈希它们，无法证明 `render`/inspect 是否重写了其中某些既有文件内容；只能确认上述 3 个路径是运行后新增的。
