import { describe, it, expect, vi, afterEach } from 'vitest';
import { speak, cancelSpeech, hasZhTwVoice } from '../../src/lib/tts/speak';

function installMockSynth(voices: { lang: string }[]) {
  const utterances: unknown[] = [];
  const synth = {
    speak: vi.fn((u: unknown) => utterances.push(u)),
    cancel: vi.fn(),
    getVoices: vi.fn(() => voices),
  };
  // @ts-expect-error test shim
  globalThis.speechSynthesis = synth;
  // @ts-expect-error test shim — constructor capturing text
  globalThis.SpeechSynthesisUtterance = class { text: string; lang = ''; rate = 1;
    constructor(t: string) { this.text = t; } };
  return { synth, utterances };
}

describe('tts/speak', () => {
  afterEach(() => {
    // @ts-expect-error cleanup
    delete globalThis.speechSynthesis;
    // @ts-expect-error cleanup
    delete globalThis.SpeechSynthesisUtterance;
    vi.restoreAllMocks();
  });

  it('hasZhTwVoice true when a zh-TW voice exists', () => {
    installMockSynth([{ lang: 'en-US' }, { lang: 'zh-TW' }]);
    expect(hasZhTwVoice()).toBe(true);
  });

  it('hasZhTwVoice false when no zh voice', () => {
    installMockSynth([{ lang: 'en-US' }]);
    expect(hasZhTwVoice()).toBe(false);
  });

  it('hasZhTwVoice false when speechSynthesis missing', () => {
    expect(hasZhTwVoice()).toBe(false);
  });

  it('speak cancels in-flight speech then speaks the text', () => {
    const { synth, utterances } = installMockSynth([{ lang: 'zh-TW' }]);
    speak('過去一年是否跌倒過？');
    expect(synth.cancel).toHaveBeenCalled();
    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect((utterances[0] as { text: string }).text).toBe('過去一年是否跌倒過？');
    expect((utterances[0] as { lang: string }).lang).toBe('zh-TW');
  });

  it('speak is a safe no-op when speechSynthesis missing', () => {
    expect(() => speak('hi')).not.toThrow();
  });

  it('cancelSpeech is a safe no-op when speechSynthesis missing', () => {
    expect(() => cancelSpeech()).not.toThrow();
  });
});
