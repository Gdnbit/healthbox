# 本地解析工作器与黄金集评测

## 范围

本评测只使用完全虚构的机构名称、日期和检验值，验证：

- 数字 PDF 原生文本进入 `local-core-lab@1.0.0` 后得到稳定候选；
- 两种机构式排版的候选代码、数值、单位、状态和摘要与 golden 一致；
- 解析阶段 `formal_write_count` 始终为 0；
- 服务重启后遗留的 `running` 任务自动回到队列；
- 单进程工作器按稳定顺序处理持久化队列，重复回调不能重复领取；
- 依赖探针分别表达数字 PDF、普通图片 OCR、扫描 PDF OCR 和 HEIC 解码能力，不把部分可用误报为全部就绪。

不使用真实报告、真实机构名称、个人身份字段或外部模型。

## 文件

- `cases/institution-digital-pdf-cases.json`：生成虚构数字 PDF 的文本布局。
- `golden/institution-digital-pdf-output.json`：字段级稳定输出。
- `golden/runtime-smoke-contract.json`：容器运行时必须具备的解析路径、语言与虚构候选契约。
- `golden/synthetic-ocr-quality-contract.json`：多版式合成 OCR 的字段精确率、召回率、安全拒识、高置信错误和提取失败门槛。

## 门禁

```powershell
python -m pytest -q tests/services/test_health_source_parse_worker.py tests/services/test_health_source_parser_readiness.py tests/services/test_health_source_parse_golden.py tests/services/test_health_source_parser_runtime.py tests/services/test_health_source_parser_quality.py
```
