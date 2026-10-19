# HealthBox · 健康档案盒

**把分散的健康资料，整理成自己的长期健康档案。**

开源的个人与家庭健康档案管理工具。[English](README.md)

HealthBox 面向私人服务器上的个人、家人和少量受邀成员。它保存原始报告，
将人工录入或有限解析的结果放入待复核区，经用户明确提交后，形成可追溯的
结构化档案、时间线与趋势，并支持导出给医生或自行复制给 AI。

## 可以做什么

- 保存图片和 PDF 原件；批量上传、进度、失败重试、重复与重叠复核。
- 手工录入或导入 CSV；限定检验项目的本地 PDF/OCR 解析。
- 复核后一次提交，正式纠错保留修订历史，支持受保护的回滚与来源撤回。
- 首页选择一至两项趋势，按真实观测日期展示；详情、比较和导出保留准确数据。
- 独立邀请账号；管理员维护双向共享组，成员只查看获授权的结构化面板。
- 导出 CSV、SVG、打印及本人完整档案；备份、校验并在独立实例演练恢复。

## 当前限制

当前定位为 **实验性源码预览，不是生产就绪版本**。源码公开与功能完善分开验收，
不以覆盖率或功能全部完成作为源码披露前提；已有测试与安全门禁不降低。
已知依赖风险、覆盖率不足和未完成验收见[已知问题](docs/healthbox/KNOWN_ISSUES.md)。
不要直接公开原私人仓库，也不要在未完成生产加固前录入真实健康数据。

公开打包默认将继承医学词库替换为独立编写的13个指标标签、3个分类和3个疫苗
标签，不包含LOINC/WHO标准编码、医学阈值或患者数据。预置匹配明显少于内部版本；
单位需按原报告确认，不能由词库推断。原私有实例及其完整词库不受影响。

解析并不覆盖任意医院版式、手写或低质量照片。站内 AI 默认关闭，只实现范围
受控的“最近有哪些变化？”工程接口，目前没有通过现行质量门禁的真实模型。
dynamic_test 是非模型测试替身。人体/筛查页面仅提供有限教育主题，个性化筛查
周期、疾病概率和“阴性即安全”的结论均未实现。

## 如何试用

需要 Docker Compose v2。复制 .env.example 为 .env，分别生成数据库密码、
会话密钥和强初始化管理员密码，然后执行：

```sh
docker compose -f compose.healthbox.yml config --quiet
docker compose -f compose.healthbox.yml up --build -d
```

打开 http://127.0.0.1:18085。初次登录后改密，再创建虚构成员和邀请。使用
虚构资料验证上传—复核—提交—趋势—导出流程。数据库不发布主机端口，数据
保存在独立命名卷；停止时不要使用会删除卷的 down -v。

完整说明：[启动与开发](docs/healthbox/QUICK_START.md)、
[架构](docs/healthbox/ARCHITECTURE.md)、[备份和更新](docs/healthbox/OPERATIONS.md)、
[隐私和 AI 边界](docs/healthbox/PRIVACY_AND_AI.md)、
[发布核对表](PUBLIC_RELEASE_CHECKLIST.md)。

## 上游归属

本项目基于 [MediKeep](https://github.com/afairgiant/MediKeep)，保留
Copyright 2025 Alex Fair 及 Apache-2.0 许可。家庭双向共享、来源保留与人工
复核、修订链、中文轻量面板和只读 AI 合同属于本项目的改造范围，不代表获得
上游官方背书。详见 [归属说明](ACKNOWLEDGEMENTS.md)、[LICENSE](LICENSE) 和 [NOTICE](NOTICE)。

健康资料归用户掌控，AI 不代替临床判断。贡献代码前请阅读
[贡献指南](CONTRIBUTING.md)，安全问题按 [安全政策](SECURITY.md) 处理。

后续方向见[路线图](ROADMAP.md)，当前变更见[更新日志](CHANGELOG.md)；
求助请先阅读[支持说明](SUPPORT.md)与[社区行为规范](CODE_OF_CONDUCT.md)。
