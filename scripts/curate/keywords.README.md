# scripts/curate/keywords.json

Phase 4 deliverable — Claude Code 依 spec §4.8 設計準則為 123 reachable trigger
產出搜尋關鍵字。執行階段啟動前必填，否則 `pnpm curate:videos` 跑完空集合不做事。

## Schema (per trigger)

```json
{
  "<trigger-key>": {
    "primary": ["array<string>", "繁中關鍵字至少 2 組（長者／照顧者視角）"],
    "secondary": ["array<string> optional", "英文關鍵字（衛教/醫學視角）"],
    "educationSlug": "string optional：對應 src/data/education/<slug>.md",
    "minDuration": "number：秒數下限",
    "maxDuration": "number：秒數上限",
    "timeSensitive": "boolean：true 則 > 8y 影片 hard reject"
  }
}
```

## Example

```json
{
  "cga.domain.functional.falls.anomaly.cfs5": {
    "primary": ["長者 跌倒 預防", "高齡 居家 防跌"],
    "secondary": ["older adults fall prevention"],
    "educationSlug": "fall-prevention",
    "minDuration": 60,
    "maxDuration": 600,
    "timeSensitive": false
  }
}
```

## Design rules (見 spec §4.8)

1. **視角分層**：長者／照顧者視角 + 衛教/醫療視角
2. **中英並用**：primary 繁中 ≥ 2 組，secondary 英文 1 組
3. **語意涵蓋**：症狀 + 處置詞
4. **分層限定詞**：依 CFS 等級或衰弱程度（如 健壯 / 輕度衰弱 / 重度依賴 / 臥床）
5. **禁用詞**：偏方、神奇、秘方、保健品、代購、DIY 治療
6. **`timeSensitive: true`** 條件：時效性指引（如最新照護指南、政策補助）
7. **跨 trigger keywords 避免完全重複**
