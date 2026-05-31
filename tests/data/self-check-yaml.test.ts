import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const DIR = join(process.cwd(), 'src/data/self-check');
const files = readdirSync(DIR).filter(f => f.endsWith('.yaml'));
const docs = files.map(f => ({ f, d: parse(readFileSync(join(DIR, f), 'utf8')) }));

describe('self-check YAML 題庫', () => {
  it('有 18 個題目檔（16 scored + 2 awareness）', () => {
    expect(files).toHaveLength(18);
  });

  it('scored 域 16、awareness 域 2', () => {
    const scored = docs.filter(x => x.d.category === 'scored');
    const aware = docs.filter(x => x.d.category === 'awareness');
    expect(scored).toHaveLength(16);
    expect(aware).toHaveLength(2);
  });

  it('每個 scored 域至少有 green 與 amber 兩段；awareness 域 bands 為空', () => {
    for (const { f, d } of docs) {
      if (d.category === 'scored') {
        const lights = new Set(d.bands.map((b: { light: string }) => b.light));
        expect(lights.has('green'), `${f} 缺 green`).toBe(true);
        expect(lights.has('amber'), `${f} 缺 amber`).toBe(true);
      } else {
        expect(d.bands, `${f} awareness 應無 bands`).toHaveLength(0);
      }
    }
  });

  it('全部 clinicallyReviewed:false（自我檢視非診斷）', () => {
    for (const { f, d } of docs) {
      expect(d.clinicallyReviewed, `${f}`).toBe(false);
    }
  });

  it('mood 含一題 redFlag:self-harm', () => {
    const mood = docs.find(x => x.d.id === 'sc-mood')!.d;
    const flagged = mood.items.filter((it: { redFlag?: string }) => it.redFlag === 'self-harm');
    expect(flagged).toHaveLength(1);
  });

  it('每題每選項 score 為數字、每題至少 2 選項', () => {
    for (const { f, d } of docs) {
      for (const it of d.items) {
        expect(it.options.length, `${f}/${it.id}`).toBeGreaterThanOrEqual(2);
        for (const o of it.options) expect(typeof o.score).toBe('number');
      }
    }
  });
});
