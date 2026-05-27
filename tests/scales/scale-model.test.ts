import { describe, it, expectTypeOf } from 'vitest';
import type {
  ItemMode,
  ScaleItem,
  ScaleDef,
} from '$lib/scales/scale';

describe('ScaleItem extended fields', () => {
  it('accepts optional text, prompt, mode, subquestions, redFlag', () => {
    const item: ScaleItem = {
      id: 'q1',
      text: '您最近兩週是否感到憂鬱？',
      prompt: '請直接問受測者並記錄回答',
      mode: 'patient',
      subquestions: ['子題A', '子題B'],
      options: [{ label: '是', score: 1 }, { label: '否', score: 0 }],
      redFlag: 'self-harm',
    };
    expectTypeOf(item.mode).toEqualTypeOf<ItemMode | undefined>();
    expectTypeOf(item.redFlag).toEqualTypeOf<'self-harm' | undefined>();
    // Ensure text is optional (no error when omitted)
    const minimal: ScaleItem = {
      id: 'q2',
      options: [],
    };
    expectTypeOf(minimal.text).toEqualTypeOf<string | undefined>();
  });
});

describe('ScaleDef extended fields', () => {
  it('accepts tier, expandsTo, requiresPatient, requiresInformant', () => {
    const def: ScaleDef = {
      id: 'gds-15',
      domain: { top: 'psychological', sub: 'mood' },
      tier: 'screen',
      expandsTo: 'gds-15-full',
      applicableCfs: ['cfs3', 'cfs4'],
      scoring: 'sum',
      inputType: 'option',
      requiresPatient: true,
      requiresInformant: false,
      maxScore: 15,
      items: [],
      bands: [],
      clinicallyReviewed: false,
    };
    expectTypeOf(def.tier).toEqualTypeOf<'screen' | 'full'>();
    expectTypeOf(def.expandsTo).toEqualTypeOf<string | undefined>();
    expectTypeOf(def.requiresPatient).toEqualTypeOf<boolean | undefined>();
    expectTypeOf(def.requiresInformant).toEqualTypeOf<boolean | undefined>();
  });

  it('accepts timed-task in scoring union', () => {
    const def: ScaleDef = {
      id: 'ftsts',
      domain: { top: 'functional', sub: 'mobility' },
      tier: 'full',
      applicableCfs: ['cfs3'],
      scoring: 'timed-task',
      inputType: 'timed-task',
      maxScore: 60,
      items: [],
      bands: [],
      clinicallyReviewed: false,
    };
    expectTypeOf(def.scoring).toEqualTypeOf<'sum' | 'weighted' | 'error-count' | 'measured-value' | 'timed-task'>();
  });
});

describe('ItemMode taxonomy (SOP answer-source roles)', () => {
  it('accepts patient, observe, ask-either, ask-informant, measure', () => {
    const modes: ItemMode[] = ['patient', 'observe', 'ask-either', 'ask-informant', 'measure'];
    modes.forEach(m => expectTypeOf(m).toEqualTypeOf<ItemMode>());
  });

  it('ask-either is part of the union (new SOP role)', () => {
    const m: ItemMode = 'ask-either';
    expectTypeOf(m).toEqualTypeOf<ItemMode>();
  });
});
