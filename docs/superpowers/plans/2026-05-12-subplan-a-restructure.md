# Sub-plan A: App Restructure + Dual Entry

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the app from a website-style navigation to a role-based dual-entry application — parents enter the CDSA assessment flow, doctors enter the CDSS monitoring workspace.

**Architecture:** Single Astro project with two main entry paths. `/` shows role selector, `/assess/` is the parent-facing step-by-step assessment flow, `/workspace/` is the doctor-facing single-page monitoring workspace. Shared FHIR connection layer underlies both.

**Tech Stack:** Astro 5, Svelte 5 (runes), existing design tokens, existing FHIR/DB infrastructure

---

## File Structure

### Remove/Repurpose
- `src/pages/index.astro` — Replace hero marketing page with role selector
- `src/pages/dashboard.astro` — Remove (replaced by `/workspace/`)
- `src/pages/patient.astro` — Remove (merged into workspace)
- `src/pages/alerts.astro` — Remove (merged into workspace)
- `src/pages/launch.astro` — Remove (FHIR connection integrated into each role path)
- `src/pages/report.astro` — Move to `/workspace/report/`
- `src/components/blocks/Header.astro` — Replace with role-aware AppBar

### Create
- `src/pages/index.astro` — Role selector (照顧者 / 醫師)
- `src/pages/assess/index.astro` — CDSA assessment shell
- `src/pages/workspace/index.astro` — CDSS workspace shell
- `src/pages/workspace/report.astro` — PDF report (from workspace)
- `src/components/blocks/AppBar.astro` — Minimal top bar (logo + connection status + role badge)
- `src/components/assess/AssessmentShell.svelte` — Assessment flow controller (step navigation)
- `src/components/assess/ChildProfile.svelte` — Child info entry (birth date, gender, nickname)
- `src/components/assess/StepIndicator.svelte` — Step progress bar
- `src/components/workspace/WorkspaceShell.svelte` — Doctor workspace (sidebar patient list + main area)
- `src/layouts/Assess.astro` — Assessment layout (minimal chrome, child-friendly)
- `src/layouts/Workspace.astro` — Workspace layout (sidebar + main)

### Keep (no changes)
- `src/pages/education/` — Education content pages (linked from results)
- `src/pages/settings.astro` — Settings (linked from workspace)
- `src/pages/about.astro` — About page (linked from footer)
- All `src/engine/`, `src/lib/`, `src/styles/` — Unchanged

---

### Task A1: Role Selector Landing Page

**Files:**
- Modify: `src/pages/index.astro`

Replace the marketing hero page with a clean role selector. Two large cards — one for parents (照顧者/照顧者), one for clinicians (醫護人員).

- [ ] **Step 1: Rewrite index.astro**

```astro
---
import Base from '../layouts/Base.astro';
---

<Base title="CDSA 長者發展智慧評估" description="長者衰弱失能智慧分流評估系統">
  <main id="main-content" class="role-selector">
    <div class="selector-container">
      <h1>長者發展智慧評估系統</h1>
      <p class="subtitle">請選擇您的身份</p>

      <div class="role-cards">
        <a href="/smart-geri-cds/assess/" class="role-card role-parent">
          <div class="role-icon" aria-hidden="true">👶</div>
          <h2>照顧者 / 照顧者</h2>
          <p>為您的孩子進行發展評估，了解成長狀態並獲得衛教建議</p>
        </a>

        <a href="/smart-geri-cds/workspace/" class="role-card role-doctor">
          <div class="role-icon" aria-hidden="true">🩺</div>
          <h2>醫護人員</h2>
          <p>查看病患評估結果、監測健康指標、管理預警與追蹤</p>
        </a>
      </div>

      <footer class="selector-footer">
        <a href="/smart-geri-cds/about/">關於本系統</a>
        <span>SMART on FHIR</span>
      </footer>
    </div>
  </main>
</Base>
```

With `<style>` block:
- `.role-selector`: full viewport height, centered flex
- `.selector-container`: max-width 720px, centered
- `.role-cards`: grid 2 columns (stack on mobile)
- `.role-card`: large card (min-height 240px), hover effect, border-radius, design tokens
- `.role-parent`: left border `var(--color-accent)`
- `.role-doctor`: left border `var(--color-risk-advisory)`
- Child-friendly: large text (--text-lg), generous padding (--space-8)

- [ ] **Step 2: Build and verify**

Run: `pnpm build`

- [ ] **Step 3: Commit**

```
feat(A1): replace landing page with role selector
```

---

### Task A2: Assessment Layout + Shell Page

**Files:**
- Create: `src/layouts/Assess.astro`
- Create: `src/pages/assess/index.astro`
- Create: `src/components/assess/StepIndicator.svelte`

- [ ] **Step 1: Create Assess layout**

`src/layouts/Assess.astro` — Minimal layout for assessment flow. No complex navigation. Just a top bar with logo + back button + step indicator.

```astro
---
import Base from './Base.astro';

interface Props {
  title: string;
  description?: string;
}

const { title, description = '長者發展智慧評估' } = Astro.props;
---

<Base title={title} description={description}>
  <div class="assess-layout">
    <header class="assess-header">
      <a href="/smart-geri-cds/" class="back-link" aria-label="返回首頁">← 返回</a>
      <span class="assess-title">長者發展評估</span>
    </header>
    <main id="main-content" class="assess-main">
      <slot />
    </main>
  </div>
</Base>
```

Style: assess-header sticky top, assess-main full height minus header, centered container.

- [ ] **Step 2: Create StepIndicator.svelte**

`src/components/assess/StepIndicator.svelte` — Shows assessment progress steps.

```svelte
<script lang="ts">
  interface Props {
    steps: string[];
    currentStep: number;
  }

  let { steps, currentStep }: Props = $props();
</script>

<nav class="step-indicator" aria-label="評估進度">
  <ol>
    {#each steps as step, i}
      <li
        class:completed={i < currentStep}
        class:active={i === currentStep}
        class:pending={i > currentStep}
        aria-current={i === currentStep ? 'step' : undefined}
      >
        <span class="step-number">{i + 1}</span>
        <span class="step-label">{step}</span>
      </li>
    {/each}
  </ol>
</nav>
```

Style: horizontal step bar, circles connected by lines, completed=green, active=blue, pending=gray. Responsive: labels hidden on mobile, only circles shown.

- [ ] **Step 3: Create assess/index.astro**

`src/pages/assess/index.astro` — The assessment shell page that hosts the Svelte assessment flow controller.

```astro
---
import Assess from '../../layouts/Assess.astro';
import AssessmentShell from '../../components/assess/AssessmentShell.svelte';
---

<Assess title="開始評估">
  <AssessmentShell client:load />
</Assess>
```

- [ ] **Step 4: Create AssessmentShell.svelte stub**

`src/components/assess/AssessmentShell.svelte` — Stub that will be fleshed out in Sub-plan B.

```svelte
<script lang="ts">
  import StepIndicator from './StepIndicator.svelte';

  const STEPS = ['基本資料', '問卷', '互動遊戲', '語音互動', '影片錄製', '繪圖測試', '分析中', '評估結果'];
  let currentStep = $state(0);
</script>

<div class="assessment-shell">
  <StepIndicator steps={STEPS} {currentStep} />

  <div class="step-content">
    {#if currentStep === 0}
      <div class="placeholder-step">
        <h2>基本資料</h2>
        <p>請輸入長者的基本資料以開始評估。</p>
        <button class="btn-primary" onclick={() => currentStep++}>下一步</button>
      </div>
    {:else}
      <div class="placeholder-step">
        <h2>{STEPS[currentStep]}</h2>
        <p>此步驟即將實作。</p>
        <div class="step-nav">
          <button onclick={() => currentStep--}>上一步</button>
          <button class="btn-primary" onclick={() => currentStep++}>下一步</button>
        </div>
      </div>
    {/if}
  </div>
</div>
```

Style: step-content centered, max-width 800px, generous padding. btn-primary uses --color-accent. Child-friendly: large buttons (min-height 56px), --text-lg.

- [ ] **Step 5: Build and verify**
- [ ] **Step 6: Commit**

```
feat(A2): add assessment layout, step indicator, and shell page
```

---

### Task A3: Workspace Layout + Shell Page

**Files:**
- Create: `src/layouts/Workspace.astro`
- Create: `src/pages/workspace/index.astro`
- Create: `src/components/workspace/WorkspaceShell.svelte`
- Move: `src/pages/report.astro` → `src/pages/workspace/report.astro`

- [ ] **Step 1: Create Workspace layout**

`src/layouts/Workspace.astro` — Workspace layout with a top bar (connection status, settings gear, notifications).

```astro
---
import Base from './Base.astro';
import ConnectionStatus from '../components/fhir/ConnectionStatus.svelte';

interface Props {
  title: string;
  description?: string;
}

const { title, description = 'CDSS 臨床監測工作台' } = Astro.props;
---

<Base title={title} description={description}>
  <div class="workspace-layout">
    <header class="workspace-header">
      <a href="/smart-geri-cds/" class="back-link" aria-label="返回首頁">← 返回</a>
      <span class="workspace-title">臨床監測工作台</span>
      <div class="header-actions">
        <ConnectionStatus client:load isConnected={false} isSyncing={false} lastSyncTime={null} />
        <a href="/smart-geri-cds/settings/" class="icon-link" aria-label="設定">⚙</a>
      </div>
    </header>
    <div class="workspace-body">
      <slot />
    </div>
  </div>
</Base>
```

Style: workspace-header sticky, workspace-body fills remaining viewport.

- [ ] **Step 2: Create WorkspaceShell.svelte**

`src/components/workspace/WorkspaceShell.svelte` — Single-page workspace combining patient list sidebar + main content area.

```svelte
<script lang="ts">
  import PatientList from '../dashboard/PatientList.svelte';
  import RiskSummary from '../dashboard/RiskSummary.svelte';
  import PatientView from '../patient/PatientView.svelte';
  import AlertFeed from '../dashboard/AlertFeed.svelte';
  import { patientStore } from '../../lib/stores/patients.svelte';

  let activeTab = $state<'overview' | 'patient' | 'alerts'>('overview');

  const hasSelectedPatient = $derived(patientStore.selectedPatientId !== null);

  // Auto-switch to patient tab when a patient is selected
  $effect(() => {
    if (hasSelectedPatient) {
      activeTab = 'patient';
    }
  });
</script>

<div class="workspace">
  <aside class="workspace-sidebar">
    <RiskSummary />
    <PatientList />
  </aside>

  <main class="workspace-main">
    <nav class="workspace-tabs" aria-label="工作區域切換">
      <button class:active={activeTab === 'overview'} onclick={() => activeTab = 'overview'}>總覽</button>
      <button class:active={activeTab === 'patient'} onclick={() => activeTab = 'patient'} disabled={!hasSelectedPatient}>個案</button>
      <button class:active={activeTab === 'alerts'} onclick={() => activeTab = 'alerts'}>預警</button>
    </nav>

    <div class="workspace-content">
      {#if activeTab === 'overview'}
        <AlertFeed />
      {:else if activeTab === 'patient' && hasSelectedPatient}
        <PatientView />
      {:else if activeTab === 'alerts'}
        <!-- AlertManager will be imported here -->
        <p>預警管理</p>
      {/if}
    </div>
  </main>
</div>
```

Style: CSS Grid — sidebar 320px fixed, main fluid. Sidebar scrollable independently. Responsive: sidebar collapses to top on mobile (<768px).

- [ ] **Step 3: Create workspace/index.astro**

```astro
---
import Workspace from '../../layouts/Workspace.astro';
import WorkspaceShell from '../../components/workspace/WorkspaceShell.svelte';
---

<Workspace title="臨床監測工作台">
  <WorkspaceShell client:load />
</Workspace>
```

- [ ] **Step 4: Move report page**

Move `src/pages/report.astro` to `src/pages/workspace/report.astro`. Update the layout import path.

- [ ] **Step 5: Build and verify**
- [ ] **Step 6: Commit**

```
feat(A3): add workspace layout and single-page monitoring workspace
```

---

### Task A4: Clean Up Old Pages + Update Navigation

**Files:**
- Delete: `src/pages/dashboard.astro`
- Delete: `src/pages/patient.astro`
- Delete: `src/pages/alerts.astro`
- Delete: `src/pages/launch.astro`
- Modify: `src/components/blocks/Header.astro` → Simplify or keep for about/education/settings pages
- Modify: `src/layouts/App.astro` → Remove ConnectionStatus (moved to Workspace layout)
- Modify: `src/pages/settings.astro` — Add back link to workspace
- Modify: `src/pages/about.astro` — Update links

- [ ] **Step 1: Delete old pages**

Remove `dashboard.astro`, `patient.astro`, `alerts.astro`, `launch.astro`.

- [ ] **Step 2: Update Header.astro**

Simplify nav links to: 首頁(/smart-geri-cds/), 衛教(/smart-geri-cds/education/), 關於(/smart-geri-cds/about/). Remove dashboard/alerts/settings links (these are now within workspace).

- [ ] **Step 3: Update App.astro**

Remove ConnectionStatus import and `.connection-bar`. The workspace has its own connection bar.

- [ ] **Step 4: Update settings.astro**

Add a back link to workspace: `<a href="/smart-geri-cds/workspace/">← 返回工作台</a>`.

- [ ] **Step 5: Update about.astro**

Update feature descriptions to reflect dual-role system. Update internal links.

- [ ] **Step 6: Build and verify**

All pages should build. Old routes should no longer exist. Verify with `pnpm build`.

- [ ] **Step 7: Commit**

```
refactor(A4): remove old pages, update navigation for dual-role app
```

---

### Task A5: FHIR Connection Integration

**Files:**
- Create: `src/components/assess/FhirSetup.svelte` — Optional FHIR connection for parents (to send results to hospital)
- Modify: `src/components/workspace/WorkspaceShell.svelte` — Add FHIR connection prompt if not connected

- [ ] **Step 1: Create FhirSetup.svelte**

A simple component for the assessment flow that optionally connects to a FHIR server to submit results. Not required — parents can use the system without FHIR.

```svelte
<script lang="ts">
  import { authStore } from '../../lib/stores/auth.svelte';
  import StandaloneLaunch from '../fhir/StandaloneLaunch.svelte';

  let showSetup = $state(false);
  let skipFhir = $state(false);
</script>

<div class="fhir-setup">
  {#if authStore.isAuthenticated || skipFhir}
    <slot />
  {:else}
    <div class="fhir-prompt">
      <h3>連線醫院系統（選填）</h3>
      <p>連線後評估結果將自動傳送至醫院。您也可以跳過此步驟，評估結果將僅保存在本機。</p>
      <div class="fhir-actions">
        <button class="btn-primary" onclick={() => showSetup = true}>連線 FHIR Server</button>
        <button class="btn-secondary" onclick={() => skipFhir = true}>跳過，稍後再連</button>
      </div>
      {#if showSetup}
        <StandaloneLaunch />
      {/if}
    </div>
  {/if}
</div>
```

- [ ] **Step 2: Update WorkspaceShell to show FHIR prompt**

If not authenticated, show a FHIR connection prompt at the top of the workspace before patient data.

- [ ] **Step 3: Build and verify**
- [ ] **Step 4: Commit**

```
feat(A5): integrate FHIR connection into assessment and workspace flows
```
