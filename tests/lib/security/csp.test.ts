import { describe, it, expect } from 'vitest';
import { CSP_DIRECTIVES, CONTENT_SECURITY_POLICY, buildCsp } from '../../../src/lib/security/csp';

describe('Content-Security-Policy', () => {
  it('鎖定高價值指令以降低注入/外洩面', () => {
    expect(CSP_DIRECTIVES['default-src']).toEqual(["'self'"]);
    expect(CSP_DIRECTIVES['object-src']).toEqual(["'none'"]);
    expect(CSP_DIRECTIVES['base-uri']).toEqual(["'self'"]);
    expect(CSP_DIRECTIVES['form-action']).toEqual(["'self'"]);
  });

  it('connect-src 允許任意 HTTPS（保 SMART launch）但不開放明文/ws/data', () => {
    const connect = CSP_DIRECTIVES['connect-src'];
    expect(connect).toContain('https:');
    expect(connect).toContain("'self'");
    expect(connect).not.toContain('http:');
    expect(connect).not.toContain('ws:');
    expect(connect.some((s) => s.startsWith('data:'))).toBe(false);
  });

  it('保留 YouTube 影片與縮圖來源', () => {
    expect(CSP_DIRECTIVES['frame-src']).toContain('https://www.youtube-nocookie.com');
    expect(CSP_DIRECTIVES['img-src']).toContain('https://i.ytimg.com');
  });

  it('涵蓋 PWA 資源（worker/manifest/media）', () => {
    expect(CSP_DIRECTIVES['worker-src']).toEqual(["'self'"]);
    expect(CSP_DIRECTIVES['manifest-src']).toEqual(["'self'"]);
    expect(CSP_DIRECTIVES['media-src']).toEqual(["'self'"]);
  });

  it('不得出現 unsafe-eval（僅 inline 為已知必要殘餘）', () => {
    expect(CONTENT_SECURITY_POLICY).not.toContain('unsafe-eval');
  });

  it('不於 meta 宣告會被忽略的指令（frame-ancestors/report/sandbox）', () => {
    expect(CONTENT_SECURITY_POLICY).not.toContain('frame-ancestors');
    expect(CONTENT_SECURITY_POLICY).not.toContain('report-uri');
    expect(CONTENT_SECURITY_POLICY).not.toContain('sandbox');
  });

  it('輸出為合法的單行 meta content', () => {
    const csp = buildCsp();
    expect(csp).toContain('default-src');
    expect(csp).toContain('upgrade-insecure-requests');
    expect(csp).not.toContain('\n');
    expect(csp.endsWith(';')).toBe(false);
  });
});
