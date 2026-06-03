import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import ContributionForm from '../../src/components/education/ContributionForm.svelte';

afterEach(() => cleanup());

const base = { top: 'physical', sub: 'nutrition', cfsLevel: 'cfs5', onback: () => {} };

describe('ContributionForm', () => {
  it('always shows the "submission is a suggestion, not live" warning', () => {
    render(ContributionForm, { ...base, action: 'add', prefill: {} });
    expect(screen.getByText(/送出＝提交建議/)).toBeTruthy();
  });

  it('add mode shows the resource-type fieldset', () => {
    render(ContributionForm, { ...base, action: 'add', prefill: {} });
    expect(screen.getByText('資源類型')).toBeTruthy();
    expect(screen.getByText('YouTube 影片')).toBeTruthy();
  });

  it('delete-article mode shows the target slug and requires a reason', () => {
    render(ContributionForm, { ...base, action: 'delete-article', prefill: { slug: 'mood-care' } });
    expect(screen.getByText('mood-care')).toBeTruthy();
    expect(screen.getByText('刪除原因 *')).toBeTruthy();
  });

  it('edit-article mode pre-fills the title', () => {
    render(ContributionForm, { ...base, action: 'edit-article', prefill: { slug: 'mood-care', title: '情緒照護', summary: 's', content: 'c' } });
    expect((screen.getByDisplayValue('情緒照護') as HTMLInputElement).value).toBe('情緒照護');
  });

  it('delete-video mode shows the video title', () => {
    render(ContributionForm, { ...base, action: 'delete-video', prefill: { videoId: 'v', videoTitle: '用藥安全' } });
    expect(screen.getByText('用藥安全')).toBeTruthy();
  });
});
