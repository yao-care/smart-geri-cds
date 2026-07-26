import { SITE } from './site';

const CONTEXT = 'https://schema.org';
const abs = (site: URL, path: string) => new URL(path, site).href;

const ORG = SITE.organization;

/**
 * 公司節點的完整定義。每頁只由 Base.astro 輸出一次，其他節點一律以 orgRef 參照，
 * 不再內嵌整包 Organization——同一份資料重複多份會讓抓取器認不出是同一個實體。
 */
function organizationNode() {
  return {
    '@type': ['Organization', 'MedicalOrganization'],
    '@id': ORG.id,
    name: ORG.name,
    legalName: ORG.legalName,
    alternateName: ORG.alternateName,
    url: ORG.url,
    taxID: ORG.taxID,
    email: ORG.email,
    logo: { '@type': 'ImageObject', url: ORG.logoUrl },
    address: { '@type': 'PostalAddress', ...ORG.address },
    sameAs: [...ORG.sameAs],
  };
}

/** 對公司節點的參照，供 publisher / author / creator / copyrightHolder 使用。 */
const orgRef = { '@id': ORG.id };

export function organizationSchema() {
  return { '@context': CONTEXT, ...organizationNode() };
}

export function webSiteSchema(site: URL) {
  return {
    '@context': CONTEXT,
    '@type': 'WebSite',
    name: SITE.name,
    url: abs(site, '/'),
    inLanguage: SITE.inLanguage,
    publisher: orgRef,
  };
}

export function softwareApplicationSchema(site: URL) {
  return {
    '@context': CONTEXT,
    '@type': 'SoftwareApplication',
    '@id': SITE.softwareId,
    name: SITE.name,
    description: SITE.description,
    applicationCategory: 'HealthApplication',
    operatingSystem: 'Web',
    url: abs(site, '/'),
    inLanguage: SITE.inLanguage,
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'TWD' },
    sameAs: SITE.sameAs,
    publisher: orgRef,
    author: orgRef,
    creator: orgRef,
    copyrightHolder: orgRef,
  };
}

export function faqPageSchema(faqs: { question: string; answer: string }[]) {
  return {
    '@context': CONTEXT,
    '@type': 'FAQPage',
    publisher: orgRef,
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: f.answer },
    })),
  };
}
