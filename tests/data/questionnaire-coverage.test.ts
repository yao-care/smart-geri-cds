import { describe, it, expect } from 'vitest';
import questionsData from '../../src/data/questionnaire/questions.json';
import expectedDomainsMap from '../../src/lib/data/expected-questionnaire-domains.generated.json';

interface Question {
  id: string;
  domain: string;
  ageGroups: string[];
  clinicallyReviewed?: boolean;
  source?: string;
}

describe('questionnaire coverage per ageGroup × applicable domain', () => {
  const questions = (questionsData.questions as Question[]);
  for (const [ageGroup, applicableDomains] of Object.entries(expectedDomainsMap)) {
    for (const domain of applicableDomains as string[]) {
      it(`${ageGroup} × ${domain} has >= 2 questions`, () => {
        const count = questions.filter(q =>
          q.ageGroups.includes(ageGroup) && q.domain === domain
        ).length;
        expect(count).toBeGreaterThanOrEqual(2);
      });
    }
  }

  it('all questions have clinicallyReviewed and source fields', () => {
    expect(questions.length).toBe(44);
    for (const item of questions) {
      expect(item).toHaveProperty('clinicallyReviewed');
      expect(item).toHaveProperty('source');
    }
  });
});
