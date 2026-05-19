import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import fg from 'fast-glob';
import yaml from 'js-yaml';

describe('trigger key uniqueness across yaml files', () => {
  it('no duplicate trigger across cdsa-triage / cdsa-domains / cdss-vital-signs', async () => {
    const files = await fg('src/data/education-videos/*.yaml');
    const all = new Map<string, string>();
    for (const f of files) {
      const arr = (yaml.load(await fs.readFile(f, 'utf8')) as Array<{ trigger: string }>) ?? [];
      for (const t of arr) {
        if (all.has(t.trigger)) {
          throw new Error(`Duplicate trigger ${t.trigger} in ${all.get(t.trigger)} and ${f}`);
        }
        all.set(t.trigger, f);
      }
    }
    expect(all.size).toBeGreaterThanOrEqual(0);
  });
});
