import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import SubjectProfile from '../../src/components/assess/SubjectProfile.svelte';

describe('SubjectProfile', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-14T12:00:00Z'));
  });

  it('renders the form heading and the CFS selector', () => {
    render(SubjectProfile);
    expect(screen.getByRole('heading', { name: '受測者基本資料' })).toBeInTheDocument();
    expect(screen.getByLabelText(/出生日期/)).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: /臨床衰弱量表/ })).toBeInTheDocument();
  });

  it('renders all nine CFS levels with descriptions', () => {
    render(SubjectProfile);
    expect(screen.getByText('非常健壯')).toBeInTheDocument();
    expect(screen.getByText('末期')).toBeInTheDocument();
    expect(screen.getByText(/規律運動/)).toBeInTheDocument();
  });

  it('keeps the submit button disabled until a CFS level is selected (gate)', async () => {
    render(SubjectProfile);
    const submit = screen.getByRole('button', { name: /開始評估/ }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    const cfs5 = screen.getByDisplayValue('cfs5') as HTMLInputElement;
    await fireEvent.click(cfs5);
    expect(submit.disabled).toBe(false);
  });

  it('treats DOB as optional (no required attribute, no age block)', () => {
    render(SubjectProfile);
    const dateInput = screen.getByLabelText(/出生日期/) as HTMLInputElement;
    expect(dateInput.required).toBe(false);
  });

  it('shows an under-65 notice (not a block) for young DOB', async () => {
    render(SubjectProfile);
    const dateInput = screen.getByLabelText(/出生日期/) as HTMLInputElement;
    await fireEvent.input(dateInput, { target: { value: '2000-01-01' } });
    expect(await screen.findByText(/未滿 65 歲仍可進行/)).toBeInTheDocument();
  });

  it('does not show an age badge when DOB is empty', () => {
    render(SubjectProfile);
    expect(screen.queryByText(/約 .* 歲/)).not.toBeInTheDocument();
  });
});
