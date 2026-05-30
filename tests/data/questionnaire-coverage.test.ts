import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import expectedDomainsMap from '../../src/lib/data/expected-questionnaire-domains.generated.json';
import { CFS_LEVELS } from '../../src/lib/utils/cfs-levels';
import { DOMAIN_SUBS, isValidDomain } from '../../src/lib/domain/domain-tree';

interface ScaleYaml {
  id: string;
  tier?: 'triage' | 'screen' | 'full';
  alwaysRun?: boolean;
  expandsTo?: string;
  domain?: { top: string; sub: string };
  applicableCfs?: string[];
}

/** Load every scale YAML once (used by the screen-coverage gate below). */
const SCALES_DIR = 'src/data/scales';
const SCALE_DEFS: ScaleYaml[] = fs
  .readdirSync(SCALES_DIR)
  .filter(f => f.endsWith('.yaml'))
  .map(f => yaml.load(fs.readFileSync(path.join(SCALES_DIR, f), 'utf8')) as ScaleYaml);

/**
 * CGA axis coverage: the generated applicability map (build-questionnaire-
 * applicability.ts) is keyed by CFS level → applicable `top.sub` domain list.
 *
 * Phase 1 ships a MINIMAL content set (empty `inapplicable`), so every cell is
 * applicable/contributable. The real per-CFS scale curation + cutoffs are
 * Plan 2; this test therefore asserts STRUCTURAL correctness (valid keys, valid
 * domains, no garbage) rather than "≥ N questions per cell".
 */
describe('questionnaire applicability map (CGA axis)', () => {
  const map = expectedDomainsMap as Record<string, string[]>;

  it('is keyed by the nine CFS levels', () => {
    expect(Object.keys(map).sort()).toEqual([...CFS_LEVELS].sort());
  });

  it('every applicable domain is a valid two-level top.sub', () => {
    for (const [cfs, domains] of Object.entries(map)) {
      expect(CFS_LEVELS).toContain(cfs);
      for (const d of domains) {
        const [top, sub] = d.split('.');
        expect(isValidDomain(top, sub), `${cfs}: ${d} should be a valid domain`).toBe(true);
      }
    }
  });

  it('lists no domain outside the canonical DOMAIN_SUBS set', () => {
    const valid = new Set(DOMAIN_SUBS as string[]);
    for (const domains of Object.values(map)) {
      for (const d of domains) {
        const sub = d.split('.')[1];
        expect(valid.has(sub), `${d} sub should be in DOMAIN_SUBS`).toBe(true);
      }
    }
  });

  it('has no duplicate domains within a CFS column', () => {
    for (const [cfs, domains] of Object.entries(map)) {
      const dupes = domains.filter((d, i) => domains.indexOf(d) !== i);
      expect(dupes, `${cfs} should have no duplicate domains`).toEqual([]);
    }
  });

  it('lists physical.pain as applicable in every CFS level (D1 pain domain)', () => {
    for (const cfs of CFS_LEVELS) {
      expect(map[cfs], `${cfs}: physical.pain should be applicable`).toContain('physical.pain');
    }
  });
});

/**
 * Tiered-screen coverage gate (Phase D): the redesign runs Tier-1 `screen`
 * scales first, so EVERY clinical frailty level must have at least one
 * `tier: screen` scale applicable to it — otherwise that CFS cohort would see
 * an empty questionnaire. Reads the scale YAMLs directly (single source).
 */
describe('tiered screen coverage (CGA axis)', () => {
  const screens = SCALE_DEFS.filter(s => s.tier === 'screen');

  it('has at least one tier:screen scale defined', () => {
    expect(screens.length).toBeGreaterThan(0);
  });

  it('every cfs1–cfs9 has ≥1 applicable screen scale', () => {
    for (const cfs of CFS_LEVELS) {
      const applicable = screens.filter(s => (s.applicableCfs ?? []).includes(cfs));
      expect(applicable.length, `${cfs} must have ≥1 screen scale`).toBeGreaterThan(0);
    }
  });

  it('pain-screen covers every CFS level (D1: physical.pain applies broadly)', () => {
    const pain = SCALE_DEFS.find(s => s.id === 'pain-screen');
    expect(pain, 'pain-screen should exist').toBeDefined();
    for (const cfs of CFS_LEVELS) {
      expect(pain?.applicableCfs, `pain-screen should apply to ${cfs}`).toContain(cfs);
    }
  });
});

/**
 * Triage-layer coverage gate (Phase 2 Task 3): every CFS level must have ≥1
 * tier:triage scale, triage scales must expandsTo a valid screen, patient-safety
 * domains (delirium/cognition) are alwaysRun with no triage gate, and the
 * mini-cog fallback covers all cognition-screen CFS levels (C-S6).
 */
describe('triage layer coverage (Phase 2 Task 3)', () => {
  const scales = SCALE_DEFS;

  it('every CFS level has at least one tier:triage scale', () => {
    for (const cfs of CFS_LEVELS) {
      const triage = scales.filter(s => s.tier === 'triage' && s.applicableCfs?.includes(cfs));
      expect(triage.length, `${cfs} has no triage scale`).toBeGreaterThan(0);
    }
  });

  it('every triage scale expandsTo an existing screen scale', () => {
    const screenIds = new Set(scales.filter(s => s.tier === 'screen').map(s => s.id));
    for (const t of scales.filter(s => s.tier === 'triage')) {
      expect(t.expandsTo, `${t.id} missing expandsTo`).toBeTruthy();
      expect(screenIds.has(t.expandsTo!), `${t.id}.expandsTo=${t.expandsTo} not a screen`).toBe(true);
    }
  });

  it('delirium and cognition are alwaysRun screens (no triage gate; C-M1/C-S6)', () => {
    expect(scales.find(s => s.id === '4at')?.alwaysRun).toBe(true);
    expect(scales.find(s => s.id === 'cognition-screen')?.alwaysRun).toBe(true);
    expect(scales.some(s => s.tier === 'triage' && s.domain?.sub === 'delirium')).toBe(false);
    expect(scales.some(s => s.tier === 'triage' && s.domain?.sub === 'cognition')).toBe(false);
  });

  it('mini-cog applicableCfs ⊇ cognition-screen (C-M2 fallback never drops cognition)', () => {
    const cog = scales.find(s => s.id === 'cognition-screen');
    const mini = scales.find(s => s.id === 'mini-cog');
    expect(cog && mini).toBeTruthy();
    for (const cfs of cog!.applicableCfs ?? []) {
      expect((mini!.applicableCfs ?? []).includes(cfs), `mini-cog missing ${cfs}`).toBe(true);
    }
  });
});
