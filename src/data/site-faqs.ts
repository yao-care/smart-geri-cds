export interface Faq {
  question: string;
  answer: string;
}

export const siteFaqs: Faq[] = [
  {
    question: '這個工具需要安裝什麼軟體嗎？',
    answer: '不需要。本系統為純瀏覽器端應用程式，只需現代瀏覽器（Chrome、Firefox、Safari、Edge）即可使用。所有評估運算在瀏覽器本機執行，無需安裝額外軟體或維護後端伺服器。',
  },
  {
    question: '評估結果是醫療診斷嗎？',
    answer: '否。本工具為篩檢與臨床決策輔助工具，評估結果僅供臨床照護參考，不構成醫療診斷。若您或家中長輩的健康狀況有疑慮，請諮詢醫師或醫療專業人員。',
  },
  {
    question: '如何連接醫院的 FHIR Server？',
    answer: '系統支援兩種連線模式：Standalone Launch 與 EHR Launch。Standalone 模式下，可在醫師工作台設定中輸入 FHIR Server 位址進行連線；EHR Launch 模式下，醫院 EHR 系統會自動透過 SMART on FHIR 協議啟動本系統並傳入病患資料。',
  },
  {
    question: '個案資料會被傳送到外部伺服器嗎？',
    answer: '不會。本系統採用「隱私優先」設計，所有資料僅在您的瀏覽器與醫院 FHIR Server 之間流動。我們不收集、不儲存、不轉傳任何個案資料。系統本身為靜態網頁，部署後不需要任何後端伺服器。',
  },
  {
    question: 'CFS（臨床衰弱量表）分數如何取得？',
    answer: 'CFS 1–9 分由臨床人員依據整體臨床觀察評定（體能活動、功能依賴、疾病狀況等）。本工具以 CFS 分層作為評估起點，建議由具備臨床評估能力的醫護人員操作。',
  },
];

export const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: siteFaqs.map((faq) => ({
    '@type': 'Question',
    name: faq.question,
    acceptedAnswer: { '@type': 'Answer', text: faq.answer },
  })),
};
