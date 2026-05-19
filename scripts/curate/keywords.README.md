# scripts/curate/keywords.json

Phase 4 deliverable — Claude Code 依 spec §4.8 設計準則為 123 reachable trigger
產出搜尋關鍵字。執行階段啟動前必填，否則 `pnpm curate:videos` 跑完空集合不做事。

## Schema (per trigger)

```json
{
  "<trigger-key>": {
    "primary": ["array<string>", "繁中關鍵字至少 2 組（家長視角）"],
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
  "cdss.spo2.critical.infant": {
    "primary": ["嬰兒 血氧 過低", "新生兒 缺氧 緊急"],
    "secondary": ["infant low SpO2 emergency"],
    "educationSlug": "respiratory-care",
    "minDuration": 60,
    "maxDuration": 600,
    "timeSensitive": false
  }
}
```

## Design rules (見 spec §4.8)

1. **視角分層**：家長視角 + 衛教/醫療視角
2. **中英並用**：primary 繁中 ≥ 2 組，secondary 英文 1 組
3. **語意涵蓋**：症狀 + 處置詞
4. **年齡限定詞**：嬰兒 / 新生兒 / 幼兒 / 學齡前
5. **禁用詞**：偏方、神奇、秘方、保健品、代購、中醫、DIY 治療
6. **`timeSensitive: true`** 條件：疫苗、生長曲線、感染症指引、飲食指南
7. **跨 trigger keywords 避免完全重複**
