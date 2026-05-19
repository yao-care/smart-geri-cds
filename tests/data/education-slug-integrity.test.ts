import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import fg from 'fast-glob';
import yaml from 'js-yaml';

describe('educationSlug integrity', () => {
  it('every educationSlug in yaml has corresponding markdown', async () => {
    const yamlFiles = await fg('src/data/education-videos/*.yaml');
    const slugs = new Set<string>();
    for (const f of yamlFiles) {
      const arr = (yaml.load(await fs.readFile(f, 'utf8')) as Array<{ educationSlug?: string }>) ?? [];
      for (const t of arr) if (t.educationSlug) slugs.add(t.educationSlug);
    }
    for (const slug of slugs) {
      const mdPath = `src/data/education/${slug}.md`;
      await expect(fs.access(mdPath)).resolves.toBeUndefined();
    }
  });
});
