import { describe, it, expect } from 'vitest';
import { decideSwUpdateAction } from '../../../src/lib/sw/update-policy';

describe('decideSwUpdateAction', () => {
  it('auto-reloads when a new version activates and user is not editing', () => {
    expect(decideSwUpdateAction({ version: 'v2', alreadyReloadedVersion: null, isEditing: false })).toBe('reload');
  });

  it('falls back to banner if this version was already auto-reloaded (loop guard)', () => {
    expect(decideSwUpdateAction({ version: 'v2', alreadyReloadedVersion: 'v2', isEditing: false })).toBe('banner');
  });

  it('still reloads for a different new version than the last auto-reloaded one', () => {
    expect(decideSwUpdateAction({ version: 'v3', alreadyReloadedVersion: 'v2', isEditing: false })).toBe('reload');
  });

  it('does not interrupt the user mid-typing → banner', () => {
    expect(decideSwUpdateAction({ version: 'v2', alreadyReloadedVersion: null, isEditing: true })).toBe('banner');
  });

  it('treats an empty version as "unknown" and guards against re-reload', () => {
    expect(decideSwUpdateAction({ version: '', alreadyReloadedVersion: null, isEditing: false })).toBe('reload');
    expect(decideSwUpdateAction({ version: '', alreadyReloadedVersion: 'unknown', isEditing: false })).toBe('banner');
  });
});
