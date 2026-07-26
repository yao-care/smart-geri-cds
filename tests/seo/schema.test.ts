import { describe, it, expect } from 'vitest';
import {
  organizationSchema,
  webSiteSchema,
  softwareApplicationSchema,
  faqPageSchema,
} from '../../src/lib/seo/schema';
import { SITE } from '../../src/lib/seo/site';

const site = new URL('https://smart-geri-cds.yao.care/');
const ORG_ID = 'https://www.yao.care/#organization';

describe('organizationSchema', () => {
  it('公司節點帶官網的 @id 與法律登記名稱', () => {
    const s = organizationSchema();
    expect(s['@context']).toBe('https://schema.org');
    expect(s['@type']).toEqual(['Organization', 'MedicalOrganization']);
    expect(s['@id']).toBe(ORG_ID);
    expect(s.name).toBe('yao.care');
    expect(s.legalName).toBe('藥提醒科技有限公司');
    expect(s.url).toBe('https://www.yao.care');
    expect(s.taxID).toBe('83620786');
  });
  it('@id 用官網網域，不用本站網域', () => {
    // 各站若用自己的 #organization，實體圖會裂成多個不相干的公司。
    expect(organizationSchema()['@id']).not.toContain('smart-geri-cds');
  });
  it('sameAs 每筆為 https URL', () => {
    const s = organizationSchema() as Record<string, unknown> & { sameAs?: string[] };
    expect(Array.isArray(s.sameAs)).toBe(true);
    for (const url of s.sameAs!) expect(url).toMatch(/^https:\/\//);
  });
});

describe('公司只定義一次、其餘節點以 @id 參照', () => {
  it('WebSite / SoftwareApplication / FAQPage 的 publisher 是純參照', () => {
    const nodes = [
      webSiteSchema(site),
      softwareApplicationSchema(site),
      faqPageSchema([{ question: 'Q', answer: 'A' }]),
    ] as Array<Record<string, any>>;
    for (const n of nodes) {
      expect(n.publisher).toEqual({ '@id': ORG_ID });
      expect(JSON.stringify(n)).not.toContain('藥提醒科技有限公司');
    }
  });
});

describe('webSiteSchema', () => {
  it('WebSite，url 為站台根路徑', () => {
    const s = webSiteSchema(site);
    expect(s['@type']).toBe('WebSite');
    expect(s.name).toBe(SITE.name);
    expect(s.url).toBe('https://smart-geri-cds.yao.care/');
  });
});

describe('softwareApplicationSchema', () => {
  it('免費 HealthApplication', () => {
    const s = softwareApplicationSchema(site);
    expect(s['@type']).toBe('SoftwareApplication');
    expect(s.applicationCategory).toBe('HealthApplication');
    expect(s.offers.price).toBe('0');
    expect(s.isAccessibleForFree).toBe(true);
  });
  it('帶自己的 @id 與官網產品頁 sameAs', () => {
    const s = softwareApplicationSchema(site);
    expect(s['@id']).toBe('https://smart-geri-cds.yao.care/#software');
    expect(s.sameAs).toContain('https://www.yao.care/medical/geri/');
    expect(s.sameAs).toContain('https://github.com/yao-care/smart-geri-cds');
  });
});

describe('faqPageSchema', () => {
  it('FAQPage，每題轉 Question/Answer', () => {
    const s = faqPageSchema([{ question: 'Q1', answer: 'A1' }]);
    expect(s['@type']).toBe('FAQPage');
    expect(s.mainEntity[0]['@type']).toBe('Question');
    expect(s.mainEntity[0].acceptedAnswer.text).toBe('A1');
  });
});

describe('序列化', () => {
  it('所有工廠輸出可 JSON.stringify', () => {
    expect(() =>
      JSON.stringify([organizationSchema(), webSiteSchema(site), softwareApplicationSchema(site)]),
    ).not.toThrow();
  });
});
