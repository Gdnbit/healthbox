# 健康可视化评测

评测使用完全虚构的指标名称、日期和值，覆盖模式选择、单位隔离、参考范围变化、来源追溯、空状态和页面筛选。禁止复制私有暂存中的任何文本或数值。

运行入口：

```powershell
cd frontend
npm test -- --run src/utils/healthVisualization.test.ts src/pages/HealthInsights.test.tsx
```

停止门禁：跨单位合并、少于 8 点渲染趋势线、缺少来源/逐点范围、个人数据进入 Git、构建或翻译检查失败。

