// workers/education-contribution/src/index.ts
import { getInstallationToken } from './github-app-auth';
import { formatIssueTitle, formatIssueBody } from './issue-formatter';
import type { ContributionPayload } from './issue-formatter';

interface Env {
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
  GITHUB_INSTALLATION_ID: string;
  ALLOWED_ORIGIN: string;
  GITHUB_REPO: string;
}

const VALID_TYPES = new Set(['youtube', 'article', 'external-link', 'edit-article', 'delete-article', 'delete-video']);
const VALID_DOMAINS = new Set([
  'behavior', 'gross_motor', 'fine_motor', 'language',
  'language_comprehension', 'language_expression', 'cognition', 'social_emotional',
]);
const VALID_AGES = new Set([
  '2-6m', '7-12m', '13-24m', '25-36m', '37-48m', '49-60m', '61-72m',
]);

function validate(body: unknown): string | ContributionPayload {
  if (!body || typeof body !== 'object') return '請求格式錯誤';
  const b = body as Record<string, unknown>;
  if (!VALID_TYPES.has(b.type as string)) return `type 無效: ${b.type}`;
  if (!VALID_DOMAINS.has(b.domain as string)) return `domain 無效: ${b.domain}`;
  if (!VALID_AGES.has(b.ageGroup as string)) return `ageGroup 無效: ${b.ageGroup}`;
  // type-specific required fields
  if ((b.type === 'youtube' || b.type === 'external-link') && !(b.url as string | undefined)?.trim()) {
    return 'YouTube / 外部連結類型必須填寫 url';
  }
  if (b.type === 'article' && (!(b.title as string | undefined)?.trim() || !(b.content as string | undefined)?.trim())) {
    return 'article 類型必須填寫 title 與 content';
  }
  if (b.type === 'edit-article') {
    if (!(b.targetSlug as string | undefined)?.trim()) return 'edit-article 必須填寫 targetSlug';
    if (!(b.title as string | undefined)?.trim()) return 'edit-article 必須填寫建議的 title';
  }
  if (b.type === 'delete-article') {
    if (!(b.targetSlug as string | undefined)?.trim()) return 'delete-article 必須填寫 targetSlug';
    if (!(b.notes as string | undefined)?.trim()) return 'delete-article 必須填寫刪除原因 (notes)';
  }
  if (b.type === 'delete-video') {
    if (!(b.targetVideoId as string | undefined)?.trim()) return 'delete-video 必須填寫 targetVideoId';
    if (!(b.notes as string | undefined)?.trim()) return 'delete-video 必須填寫刪除原因 (notes)';
  }
  return b as unknown as ContributionPayload;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    let payload: ContributionPayload;
    try {
      const body = await request.json();
      const result = validate(body);
      if (typeof result === 'string') {
        return new Response(JSON.stringify({ error: result }), {
          status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }
      payload = result;
    } catch {
      return new Response(JSON.stringify({ error: '無效的 JSON' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    try {
      const token = await getInstallationToken(
        env.GITHUB_APP_ID,
        env.GITHUB_APP_PRIVATE_KEY,
        env.GITHUB_INSTALLATION_ID,
      );

      const issueRes = await fetch(
        `https://api.github.com/repos/${env.GITHUB_REPO}/issues`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'yao-care-smart-pedi-cds/1.0',
          },
          body: JSON.stringify({
            title: formatIssueTitle(payload),
            body: formatIssueBody(payload),
            labels: ['education-contribution', payload.type],
          }),
        },
      );

      if (!issueRes.ok) {
        const text = await issueRes.text();
        throw new Error(`GitHub Issues API ${issueRes.status}: ${text}`);
      }

      const issue = await issueRes.json() as { html_url: string };
      return new Response(JSON.stringify({ issueUrl: issue.html_url }), {
        status: 201, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '伺服器錯誤';
      return new Response(JSON.stringify({ error: msg }), {
        status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
  },
} satisfies ExportedHandler<Env>;
