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

  it('renders the SOP availability inputs (informantAvailable + patientAble), not an operator role selector', () => {
    render(SubjectProfile);
    expect(screen.getByRole('radiogroup', { name: /是否有可提供資訊的家屬或照顧者/ })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: /受測者本人能否參與作答或受測/ })).toBeInTheDocument();
    // The old operator role selector is gone.
    expect(screen.queryByRole('radiogroup', { name: /本次由誰協助填寫/ })).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('nurse')).not.toBeInTheDocument();
  });

  it('keeps submit disabled until BOTH a CFS level AND informantAvailable are answered (gate)', async () => {
    render(SubjectProfile);
    const submit = screen.getByRole('button', { name: /開始評估/ }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    // CFS alone is not enough — informantAvailable must be answered too.
    const cfs5 = screen.getByDisplayValue('cfs5') as HTMLInputElement;
    await fireEvent.click(cfs5);
    expect(submit.disabled).toBe(true);

    // Answer informantAvailable → gate opens (patientAble defaults to 是).
    const informantGroup = screen.getByRole('radiogroup', { name: /是否有可提供資訊的家屬或照顧者/ });
    const yes = informantGroup.querySelector('input[value="yes"]') as HTMLInputElement;
    await fireEvent.click(yes);
    expect(submit.disabled).toBe(false);
  });

  it('keeps submit disabled when only informantAvailable (not CFS) is answered', async () => {
    render(SubjectProfile);
    const submit = screen.getByRole('button', { name: /開始評估/ }) as HTMLButtonElement;
    const informantGroup = screen.getByRole('radiogroup', { name: /是否有可提供資訊的家屬或照顧者/ });
    const no = informantGroup.querySelector('input[value="no"]') as HTMLInputElement;
    await fireEvent.click(no);
    expect(submit.disabled).toBe(true);
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
