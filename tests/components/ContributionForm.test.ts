import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import ContributionForm from '../../src/components/education/ContributionForm.svelte';

afterEach(() => cleanup());
afterEach(() => {
  vi.unstubAllEnvs?.();
  vi.unstubAllGlobals?.();
  vi.restoreAllMocks();
});

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

  it('on success shows the GitHub issue link', async () => {
    vi.stubEnv('PUBLIC_CONTRIBUTION_WORKER_URL', 'https://worker.example/contribute');
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ issueUrl: 'https://github.com/org/repo/issues/42' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    render(ContributionForm, { ...base, action: 'delete-video', prefill: { videoId: 'v', videoTitle: '用藥安全' } });
    await fireEvent.input(screen.getByPlaceholderText(/請說明為何需要刪除此影片/), { target: { value: '連結失效' } });
    await fireEvent.submit(screen.getByRole('button', { name: /送出建議/ }).closest('form')!);

    expect(fetchMock).toHaveBeenCalledOnce();
    const issueLink = await screen.findByText('在 GitHub 查看 Issue →');
    expect(issueLink.getAttribute('href')).toBe('https://github.com/org/repo/issues/42');
    expect(screen.getByText('已成功送出！')).toBeTruthy();
  });

  it('on worker error shows the error message', async () => {
    vi.stubEnv('PUBLIC_CONTRIBUTION_WORKER_URL', 'https://worker.example/contribute');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: '伺服器忙線' }), { status: 500, headers: { 'Content-Type': 'application/json' } },
    )));

    render(ContributionForm, { ...base, action: 'delete-video', prefill: { videoId: 'v', videoTitle: '用藥安全' } });
    await fireEvent.input(screen.getByPlaceholderText(/請說明為何需要刪除此影片/), { target: { value: '連結失效' } });
    await fireEvent.submit(screen.getByRole('button', { name: /送出建議/ }).closest('form')!);

    expect(await screen.findByText('伺服器忙線')).toBeTruthy();
  });

  it('without a configured worker URL shows a config error and does not fetch', async () => {
    vi.stubEnv('PUBLIC_CONTRIBUTION_WORKER_URL', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(ContributionForm, { ...base, action: 'delete-video', prefill: { videoId: 'v', videoTitle: '用藥安全' } });
    await fireEvent.input(screen.getByPlaceholderText(/請說明為何需要刪除此影片/), { target: { value: '連結失效' } });
    await fireEvent.submit(screen.getByRole('button', { name: /送出建議/ }).closest('form')!);

    expect(await screen.findByText(/Worker URL 未設定/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
