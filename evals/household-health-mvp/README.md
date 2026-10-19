# 家庭健康档案 MVP 评测说明

评测仅使用虚构健康夹具，不包含当前私有 PDF 的文件名、原文、姓名或健康数值。

## 当前可视化评测

1. 多成员汇总不串线，某成员失败不影响其他成员。
2. 定量值缺单位、缺日期、缺结果、缺参考范围、缺分类和未规范化名称分别命中稳定规则。
3. 重复规则对同日同指标同单位同结果命中，对单位或日期不同的记录不命中。
4. 覆盖矩阵按日期排序，同一日多条记录计数正确，空单元格文案不声称“未检查”。
5. 汇总中的观测数、质量数、待关注数可与明细逐项对账。
6. 无数据不绘图；不同单位不进入同一长期趋势；每个图表保留等价表格。

## 隔离候选工程门禁（不等同于公网发布）

- 定向与全量前端测试没有失败；126 个退役方向性共享 UI 跳过项具有首发隔离说明和替代合同，其余跳过项继续按“未执行覆盖”公开记录，不能自动视为已验收；
- 全量 TypeScript 检查无错误；
- Vite 生产构建通过；
- 中文资源键和占位符门禁通过；
- 全量 ESLint 通过；变更文件 Prettier 通过，全仓历史格式债务单独记录；
- Git 跟踪文件敏感扫描为零；
- 容器健康检查与完整备份校验通过；
- 登录后桌面和 390×844 浏览器视口关键流程通过；Android Chrome 与 iPhone Safari 物理设备流程必须另行验收。

以上是本机隔离候选的工程门禁，不是公网生产发布结论。当前公网门禁整体仍未通过：HTTPS/反向代理、安全头与 Cookie、跨进程限速、`noindex`、服务器外备份、隐私权利与治理、物理 Android/iPhone、稳定 8005 受控升级及回退窗口均待完成。

### 当前证据快照（2026-07-28）

- 候选应用代码基线为 `4d7b8112ee73a5888c327649bda235d5163f3c71`；本地分支与私有远端在其后只增加文档同步提交，当前尖端需实时获取。
- 后端全量：`2567 passed, 23 skipped`；前端全量：`2797 passed, 137 skipped`，194 个文件通过、4 个文件跳过。
- 其中 126 项跳过属于已退出首发路由的方向性共享 UI，并由 `firstReleaseSharingScope.test.ts`、产品路由和导航合同替代；不把过时单向共享行为修回首发。其余 11 个前端跳过和 23 个后端跳过保持显式可见，不计作已执行覆盖，也不被概括为拥有同一替代合同。
- TypeScript、i18n、ESLint、生产构建以及前序 31 项聚焦回归通过；变更文件 Prettier 通过，全仓仍有 525 个历史文件。
- `4d7b8112` 修复合成邀请 `.invalid` 域无法通过 `User` 响应校验的问题，改用保留的 `.example` 域并增加“激活 → 登录 → `/users/me`”回归；相关后端 `80 passed, 1 skipped`，Black/isort 通过。该结果只属于定向增量证据，不替代 `aba2ac3d`/`bcbf9a0e` 的全量基线。
- 隔离候选 `family-health-records:candidate-mvp-4d7b8112-20260728` 的容器 `563392a9a79d` 在 18005 健康，配置已补齐与 Compose 一致的 `PUID/PGID=999`；候选合成数据已迁移，日志卷所有权已修复并恢复持久日志，新鲜日志没有 logging、响应校验或 ASGI 阻断，稳定 8005 未升级。全部评测只使用合成数据。

早期记录的前端 68 项、后端 12 项失败只作为修复前历史基线保留，已被上述证据取代。

### AI 增量证据快照（2026-07-29）

- 当前 AI 聚焦后端为 `101 passed`，相关前端五个文件为 `76 passed`；它们是定向增量证据，不替代上方明确标注提交的全量基线。
- 隔离 `127.0.0.1:28005` 候选当前选择 `test`，有效提供方为 `dynamic_test`。它是只在双门禁全虚构实例运行的确定性非模型 oracle，不是大模型或医学能力证据。
- `household-ai-answer@1.1.0` 要求每条所选记录都以 `R#=<主值><单位>` 显式绑定；双值记录使用 `R#=<主值>/<辅助值><单位>`。仅出现引用 ID、无单位数字、日期/计数巧合，或其他记录恰好具有相同数值都不能替代逐记录绑定。
- 本机实测的 Qwen3 0.6B 与 1.7B 均未通过上述 1.1.0 门禁；4B 在无 GPU 的 Docker CPU 路径十分钟未完成预热，因此当前没有获准用于成员问答的本机模型。旧 `18.23s` 结果只属于已被 1.1.0 取代的历史弱门禁，不能作为当前通过证据。
- 当前候选镜像为 `sha256:1e1aae38fd30f5b9354687d7b798e7d48b97bf0fbb1808ff1a53aa07a2f60282`；28005 容器健康，迁移头为 `health_ai_request_guard_v1`，稳定 8005 未变。

## 规则与用例追踪

- `CASE-MVP-REQUIREMENTS`：需求、实现状态、未来选项和待确认决策分开记录。
- `CASE-MVP-IA`：一级导航固定为首页、健康档案、AI、导出和更多/我的；资料与趋势合并到健康档案，可查看档案由主体切换器进入，不按临床机构工作流或数据库表平铺。
- `CASE-MVP-ACCESS`：来源、导入、预警和后续健康背景接口的跨成员拒绝。
- `CASE-MVP-RECIPROCAL` / `CASE-MVP-CIRCLE-ISOLATION`：同一有效档案共享组内全员双向结构化面板可见；重叠成员不形成跨组传递，暂停、移动或移除后立即收窄。
- `CASE-MVP-INTERNAL-GROUP-ADMIN` / `CASE-MVP-SCOPE`：只有唯一管理员可以管理内部组；普通成员只取得去重后的“可查看的档案”，且共享范围固定为不含原件、来源、导出、编辑、AI 和提醒的 `structured_dashboard`。
- `CASE-MVP-OWNER-GLOBAL-READ`：唯一管理员显式读取全部主体、访问审计和普通账号防提权。
- `CASE-MVP-OWNER-CROSS-SUBJECT-ACTION`：唯一管理员以精确能力和逐次原因修订/作废健康背景或检查覆盖，并在依赖检查后撤回/恢复报告原件；本人路径、全局读取、代上传和其他写入保持分离。
- `CASE-MVP-OWNER-MAINTENANCE`：管理 API、本地恢复命令和原始 SQL 应急分层，覆盖密码哈希、第二因素、会话撤销、备份、事务、完整性与维护记录。
- `CASE-MVP-PUBLIC-SECURITY`：公网唯一管理员强制 TOTP/Passkey 与离线恢复码；普通成员首版只使用密码且没有第二因素设置入口。
- `CASE-MVP-ADMIN-DELEGATED-UPLOAD`：普通成员只上传自己，管理员代上传默认关闭且保留真实操作者和目标主体。
- `CASE-MVP-SOURCE`：原件身份、哈希、成员、元数据和正式来源可往返追溯。
- `CASE-MVP-UPLOAD-BATCH-LIFECYCLE`：20/50 MB 单文件和 30 文件/300 MB 批次限额、多文件进度/重试、单文件移除、整批取消、回收站和依赖保护；中断恢复按 `golden/source-upload-interruption-recovery-contract.json` 以服务器清单为事实源，允许重选全部原件但只补传未完成项。
- `CASE-MVP-UPLOAD-AUTO-PARSE-HANDOFF`：档案本人上传体检/检验报告时，原件成功保存后按 `golden/upload-auto-parse-handoff-contract.json` 默认创建既有本地解析任务；失败只重试解析、不重新上传，代上传和其他资料类型不自动解析，候选不自动进入正式指标或趋势。
- `CASE-MVP-DUPLICATE-OVERLAP`：完全重复自动过滤；近似/部分重叠按 `golden/source-similarity-review-contract.json` 建立版本化、本人可复核的持久关系，本阶段不自动裁剪、合并或丢弃。
- `CASE-MVP-ONE-CLICK-COMMIT`：批次汇总后一次提交有效候选，不逐页强制确认，主体疑似不匹配仅增加一次批次级确认。
- `CASE-MVP-ONE-CLICK-COMMIT` 的主体保护细节见 `golden/subject-mismatch-confirmation-contract.json`：只使用显式姓名标签和精确规范化匹配；疑似不一致必须由档案本人确认，不能自动转移主体或提前写正式记录。
- `CASE-MVP-PARSE-WORKER-READINESS`：单进程数据库工作器稳定领取、重启恢复、分路径依赖状态和两种虚构机构式数字 PDF 字段级黄金输出；对应夹具位于 `../local-parse-worker/`。
- `CASE-MVP-IMPORT`：待复核、重复、幂等提交、正式来源和受保护回滚。
- `CASE-MVP-LIFECYCLE`：原件、候选、复核、独立确认、正式记录、修订/作废、导出和备份状态不混淆。
- `CASE-MVP-REVISION-BOUNDARY`：候选纠错不生成正式历史；正式提交创建初始版本，之后只允许档案本人按 `golden/formal-metric-revision-contract.json` 追加不可变修订，并发、幂等、通用改删、回滚、审计和完整归档均失败关闭或保留历史。
- `CASE-MVP-VIZ`：汇总、趋势资格、覆盖矩阵、质量问题和等价表格。
- `CASE-MVP-DYNAMIC-TREND`：1—2 个可选择趋势、自动/可调窗口，以及详情和交接载荷中的单位/方法/范围/来源保真。
- `CASE-MVP-LIGHTWEIGHT-DASHBOARD`：上传是概览最明显主操作；页面不形成专业任务墙，不铺开精确值、单位和术语，最多显示 1—2 条趋势。
- `CASE-MVP-SMOOTH-TREND`：曲线可平滑，但真实点集合不变且全部可见，不生成插值、预测或计算观测。
- `CASE-MVP-COPY-HANDOFF`：首页只有一个复制/分享；通用数据与适合发给 AI 的文本在预览中选择，剪贴板默认无直接身份/原件，不自动调用外部模型。
- `CASE-MVP-MOBILE-FIRST-DASHBOARD`：390×844 首屏突出上传，完成主体、1 条主趋势、指标切换、复制/分享和导出/打印，无关键横向溢出。
- `CASE-MVP-HEALTH-ARCHIVE-MERGE`：资料和趋势合并为健康档案，统一进入原件、指标、趋势、体检对比、覆盖和质量。
- `CASE-MVP-REPORT-ARCHIVE-FILTER`：在当前已授权报告快照内按标题、原始文件名、日期、机构、类型和状态搜索，组合状态/类型/年份筛选；持续显示命中数/总数并可一键清除，筛选不改变原件或跨主体权限。
- `CASE-MVP-UI-FOUNDATION-METRIC-DETAIL`：家庭健康页使用作用域统一字号/间距/圆角/阴影与 44px 移动触控目标；指标选择必须联动趋势并提供日期、精确值、状态和来源的等价表格。
- `CASE-MVP-AI-ASSISTANT-SCOPE`：AI 助手持续显示本人主体、数据范围、截止时间和家庭服务器处理位置；共享档案禁止生成、复制和站内调用，所有路径都只读正式档案。
- `CASE-MVP-AI-HANDOFF`：就医前问题、术语和自定义问题只在本人页面生成并主动复制带稳定记录引用的最小资料包；请求最多保留 200 条记录并披露省略数，直接身份、原件、文件名、报告正文、服务器路径、指南和未发布筛查状态不得进入资料包。
- `CASE-MVP-LOCAL-AI-QA`：当前站内服务只接受固定 `recent_changes` / “最近有哪些变化？”，请求仅含固定问题 ID/文本、范围和记录 ID；文本不匹配时 422 且 provider 零调用、历史零新增。提供方载荷与历史使用服务器固定文本。成员 capability 的 `model` 恒为 `null`，回答/历史只见通用处理器标签，成员成功/删除审计不含实际模型 ID。本地 OpenAI-compatible 提供方的严格结构化回答只有通过引用白名单、`household-ai-answer@1.1.0` 逐记录显式绑定、只读和已知安全门禁后才可展示并进入独立 AI 历史；服务器固定追加范围、非诊断/不保证安全和跨机构可比性说明。未校验响应不展示、不保存；回答不写正式健康事实且没有工具。这不证明医学正确性。
- `CASE-MVP-AI-GROUNDING`：回答项引用并集必须覆盖本次送入提供方的全部记录；每条记录须在引用它的回答项中以 `R#=<主值><单位>` 显式绑定，双值读数使用 `R#=<主值>/<辅助值><单位>`。遗漏记录/数值/单位、只列 citation、用日期或计数误命中、用另一记录的相同数值冒充、只重复问题、只说“有变化”，或把记录/数据/结果称为“不可信、不可靠”均不能通过；以 502 / `health_ai_ungrounded_model_output` 或安全错误失败关闭且不展示、不保存。该门禁只证明覆盖与定量引用一致，不证明医学解释或语言质量。
- `CASE-MVP-AI-PROVIDER-ADMIN`：唯一管理员网页只配置 `off/test/local`、家庭服务器 endpoint 和模型 ID，API key 只在服务器 Secret。“填入本机地址”仅填写未保存的 Ollama-compatible endpoint，不推荐或预填模型，不下载/启动/保存/启用，也不证明已安装或连通。每个 local 修订先通过固定虚构数据连接测试；修订绑定 endpoint/model，不可逆服务器指纹绑定 verification contract version、AI template version 与 API key，任一变化或并发新修订都使旧验证失效。成功/失败审计只含脱敏元数据。切换 `off` 立即阻止新请求，但已经进入本地 provider 的在途请求可能完成。
- `CASE-MVP-AI-DYNAMIC-TEST`：提供方名固定为 `dynamic_test`，仅在 `HEALTH_AI_TEST_PROVIDER_ALLOWED=true` 与 `INSTANCE_DATA_CLASS=synthetic` 双门禁下运行；它的动态结果直接成为明确标识的测试回答。它是非模型测试实现，不能作为真实 AI 或医学能力证据。
- `CASE-MVP-AI-LIMITS`：站内请求最多 200 条记录、24,000 输入字符、256,000 响应字节和 800 输出 tokens；记录裁剪披露省略数，字符或响应超限失败关闭。
- `CASE-MVP-AI-ANSWER-HISTORY`：经校验的提供方回答与服务器固定说明同正式事实分表保存，仅创建者可在本人主体读取；提供方关闭后历史仍可用，引用按当前权限、日期、值、辅助值、单位和状态重新判定，失效引用不可打开；历史列表保留提供方与测试模式标记。
- `CASE-MVP-AI-REQUEST-GUARD`：本人问答要求用户绑定的幂等键、规范请求摘要、持久预算/在途租期和终态重放；顺序合同不能替代真实 PostgreSQL 两会话并发。当前隔离 PostgreSQL 已通过同键串行化、单在途、额度耗尽和迁移升—降—再升；这仍不授权稳定实例或公网启用。
- `CASE-MVP-DATAFLOW-INTEGRITY`：家庭模式关闭旧方向性共享授权，跨主体写入使用显式能力，生命体征数值与显示单位成对转换；Vite 开发代理从 `VITE_DEV_PROXY_TARGET` 读取目标，旧 4173 进程重启并指向当前后端前不算联通证据。
- `CASE-MVP-ALERT`：状态复述、用户阈值、记录间隔、证据、版本和静音。
- `CASE-MVP-BODY-GUIDANCE`：人体/全身导航只进入有限审核主题，不编码个人患病概率。
- `CASE-MVP-GUIDANCE-EDUCATION-NAV`：医学复核责任未确认时，只显示版本化 `education_only` 主题、无风险含义的人体/等价列表和官方原链接；不输出资格、周期、到期、概率或模型筛查状态。
- `CASE-MVP-GUIDANCE-*`：指南版本、替代/撤回和跨地区冲突不静默合并。
- `CASE-MVP-SCREENING-*`：方法匹配证据、4/5 年边界、症状/异常退出、一次性/共同决策/证据不足状态。
- `CASE-MVP-LLM-*`：结构化候选、动态字段、提示注入、固定问题和最小化材料包。
- `CASE-MVP-EXPORT`：可携带 JSON 不暴露服务器路径或私有暂存内容。
- `CASE-MVP-COMPLETE-ARCHIVE`：本人专属持久任务生成结构化 JSON、全部留存原件、版本化清单及逐项 SHA-256 的开放 ZIP；缺失/篡改原件、跨主体访问、ZIP CRC/最终 SHA-256 不一致和过期下载均失败关闭，派生 ZIP 失效不删除正式数据或原件。
- `CASE-MVP-PRIVACY-RIGHTS`：本人专属查阅/复制/更正/停止共享/停用/删除/停止处理请求具有状态、内部目标期限、结果和处理证据；请求本身不执行数据变更，无证据不得宣称删除或停止处理完成。
- `CASE-MVP-RESTORE`：完整性校验后，在无网络临时 PostgreSQL 中实际恢复关键表。
- `CASE-MVP-REAL-DATA-GATE`：虚构端到端和人工视觉验收前，正式个人导入保持关闭。

机器可读的预导入用例见 `cases/pre-real-data.json`。真实资料的字段映射尚未逐项确认，因此不得把私有暂存输出复制为黄金答案；黄金目录只接收虚构夹具。

档案互见的机器可读状态、范围和审计字段合同见 `golden/archive-circle-contract.json`。

默认关闭的管理员代上传能力、逐次原因、对象范围及审计排除项见 `golden/admin-delegated-upload-contract.json`。

管理员跨主体修订、作废、原件撤回/恢复的精确能力、失败关闭和审计排除项见 `golden/admin-cross-subject-action-contract.json`。

本人本地 AI 提问资料包的版本、范围、引用、隐私排除项和失败关闭合同见 `golden/ai-handoff-contract.json`。

本人站内最近变化、请求上限、经校验回答展示/历史、服务器固定说明、未校验响应拒绝、地址边界、服务端记录解析、引用、无工具、审计和失败关闭合同见 `golden/local-ai-qa-contract.json`。

唯一管理员非秘密配置、版本化验证指纹、固定虚构连接测试、endpoint-only 起步入口、`dynamic_test` 双门禁和 API key 服务器 Secret 边界见 `golden/ai-provider-admin-contract.json`。

本人 AI 回答历史的独立存储、当前权限重验、精确引用定位、删除和备份边界见 `golden/ai-answer-history-contract.json`。

本人 AI 问答幂等键、持久预算、在途租期、终态重放、隐私最小化和 PostgreSQL 并发证据边界见 `golden/ai-request-guard-contract.json`。

旧共享授权关闭、跨主体写权限、生命体征单位保真和开发 API 代理联动见 `golden/dataflow-integrity-contract.json`。

医学复核前的人体与筛查教育导航、官方来源字段和禁止个性化输出合同见 `golden/screening-education-nav-contract.json`。

30 文件中断恢复的清单事实源、精确重新匹配、已保存正向跳过、服务器结果校准和响应式界面合同见 `golden/source-upload-interruption-recovery-contract.json`。

本人报告原件保存后的本地解析交接顺序、支持资料类型、失败恢复、代上传隔离和正式写入禁令见 `golden/upload-auto-parse-handoff-contract.json`。

本人数据权利请求的类型、本人范围、幂等、状态机、30 个自然日内部目标、非自动执行、处理证据、删除/停止处理限制和审计排除项见 `golden/privacy-rights-request-contract.json`。
