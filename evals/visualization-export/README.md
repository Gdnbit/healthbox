# Visualization export evals

全部数据为合成输入。评测覆盖规范模型、来源完整性、模式继承、SVG 可访问性与转义、CSV BOM/公式防护、隐私文件名和零写入。

计划运行：

```powershell
cd frontend
npm test -- --run src/utils/healthMetricExport.test.ts src/components/health/HealthMetricExportActions.test.tsx src/components/health/HealthMetricDetail.test.tsx
```

停止门禁：任一点缺来源/范围、SVG 可执行内容、CSV 公式未中和、文件名含成员/路径、少于 8 点折线、导出触发 API 或正式表变化。

