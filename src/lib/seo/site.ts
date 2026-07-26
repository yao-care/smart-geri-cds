/**
 * 公司實體（藥提醒科技有限公司）——跨站共用，欄位勿改。
 *
 * `id` 一律指向官網的 https://www.yao.care/#organization：官網與 6 個產品站
 * 共指同一個節點，抓取器才能從產品走回公司。若改成各自網域的 #organization，
 * 會裂成 6 個彼此無關的公司實體，比沒有還糟。
 *
 * legalName 是「法律登記名稱」，只有中文一種寫法；英文一律用 yao.care，
 * 不要自創譯名。
 */
export const ORGANIZATION = {
  id: 'https://www.yao.care/#organization',
  name: 'yao.care',
  legalName: '藥提醒科技有限公司',
  alternateName: '藥提醒',
  url: 'https://www.yao.care',
  taxID: '83620786',
  email: 'service@yao.care',
  logoUrl: 'https://www.yao.care/assets/images/logo.png',
  address: {
    streetAddress: '台灣大道二段220號12樓',
    addressLocality: '台中市西區',
    addressCountry: 'TW',
  },
  sameAs: [
    'https://www.wikidata.org/wiki/Q140265007',
    'https://github.com/yao-care',
    'https://www.google.com/maps?cid=12025785010180313919',
  ],
  /** 本產品在官網的介紹頁，供正文與 sameAs 使用。 */
  productPage: 'https://www.yao.care/medical/geri/',
} as const;

export const SITE = {
  // 與 scripts/templates/manifest.template.json 的 name / short_name 保持一致
  name: '高齡周全性評估',
  shortName: '高齡CGA',
  description:
    '高齡周全性評估（CGA）臨床決策輔助工具：以 CFS 衰弱分層為起點，涵蓋認知、功能、情緒、營養等多領域篩檢，提供分級建議與衛教。資料僅在瀏覽器端運算，免登入、保護隱私。',
  inLanguage: 'zh-TW',
  logoPath: '/icons/icon-512.png',
  organization: ORGANIZATION,
  repo: 'https://github.com/yao-care/smart-geri-cds',
  /** 本站 SoftwareApplication 節點的 @id。 */
  softwareId: 'https://smart-geri-cds.yao.care/#software',
  /** 本站（非公司）的官方據點；勿填未經營的社群帳號。 */
  sameAs: [ORGANIZATION.productPage, 'https://github.com/yao-care/smart-geri-cds'] as string[],
} as const;
