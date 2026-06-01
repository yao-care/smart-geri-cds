# CDSA Integration Master Plan

## System Overview

```
┌─────────────────────────────────────────────────────┐
│                   smart-geri-cds                     │
│                   (Astro 5 SSG)                      │
│                                                      │
│  ┌─────────────────┐    ┌─────────────────────────┐ │
│  │   照顧者端 (CDSA)  │    │    醫師端 (CDSS)         │ │
│  │                  │    │                          │ │
│  │ 1. 問卷          │    │ 病患列表                  │ │
│  │ 2. 互動遊戲      │    │ ├─ 指標趨勢圖 (D3)       │ │
│  │ 3. 語音互動      │    │ ├─ 預警管理              │ │
│  │ 4. 影片錄製      │    │ ├─ AI 分流結果           │ │
│  │ 5. 繪圖測試      │    │ └─ PDF 報告              │ │
│  │ 6. AI 分析       │    │                          │ │
│  │ 7. 結果 + 衛教   │    │ 設定                     │ │
│  │                  │    │ ├─ FHIR Server           │ │
│  │  全部瀏覽器端     │    │ ├─ 規則 / 模型           │ │
│  │  Web Workers     │    │ └─ Webhook / 通知        │ │
│  └────────┬─────────┘    └────────────┬─────────────┘ │
│           │                           │               │
│           └───── SMART on FHIR ───────┘               │
│                 (Observation /                         │
│                  DiagnosticReport)                     │
└─────────────────────────────────────────────────────┘
```

## Sub-plans

### A: App Restructure + Dual Entry (Foundation)
- Remove website-style nav, replace with role-based entry
- `/` → Role selector (照顧者 / 醫師)
- `/assess/` → CDSA assessment flow (step-by-step)
- `/workspace/` → CDSS monitoring workspace (single-page)
- Shared FHIR connection layer

### B: Assessment Core
- Assessment state machine (STARTED → PAUSED → RESUMED → COMPLETED)
- IndexedDB schema extensions (Assessment, AssessmentEvent, MediaFile, NormThreshold)
- Assessment flow controller (step sequencing)
- Child profile management
- Age-based module adaptation (0-72 months, 7 age groups)

### C: Questionnaire Module
- Question renderer (text + image cards)
- Answer capture + event recording
- Radar chart preview (6 domains)
- Auto-advance logic

### D: Interactive Game (PixiJS)
- PixiJS canvas integration in Svelte
- Card display (6 domains × image cards)
- Event capture (click coords, drag path, hover time, latency)
- Child-friendly UX (48dp touch targets, no error feedback, positive reinforcement)
- 3-minute attention limit per block

### E: Voice Interaction
- TTS playback (Web Speech API, zh-TW)
- MediaRecorder recording (WAV/WebM)
- VAD detection (energy-based, Web Audio API)
- Auto-advance on 2s silence
- Retry/skip controls

### F: Video Recording
- Camera selection (front/external)
- MediaRecorder with 15s segments
- IndexedDB blob storage
- File import fallback

### G: Drawing Module
- Canvas drawing (5 shapes: circle → cross → square → triangle → diamond)
- Stroke capture (coordinates + timestamps)
- Canvas → Blob export
- Clear/redo controls

### H: Browser AI Engine
- **Behavior analysis**: JS feature engineering (7 metrics from events)
- **Gross motor**: MediaPipe Pose → joint coordinates → feature extraction → ONNX classifier
- **Fine motor**: Drawing images → ONNX CNN → shape classification + 23 features
- **Voice acoustics**: Web Audio API → Meyda.js MFCC/pitch → 7 metrics
- **Triage**: Z-score vs age-group norms → normal/monitor/refer
- All in Web Workers

### I: Results + Template Education + FHIR Write-back
- Radar chart (D3) with percentiles
- Triage result display (with "僅供參考" disclaimer)
- Template-based health education matching (Content Collections)
- FHIR Observation + DiagnosticReport write-back
- PDF report generation
