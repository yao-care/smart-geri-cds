// workers/education-contribution/src/github-app-auth.ts
import githubAppJwt from 'universal-github-app-jwt';

export async function getInstallationToken(
  appId: string,
  privateKey: string,
  installationId: string,
): Promise<string> {
  const { token: jwt } = await githubAppJwt({ id: appId, privateKey });

  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'yao-care-smart-pedi-cds/1.0',
      },
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub App auth failed ${res.status}: ${body}`);
  }

  const data = await res.json() as { token: string };
  return data.token;
}
