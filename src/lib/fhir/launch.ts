import { initStandalone, initEhrLaunch, completeAuth, getAccessToken, getFhirUser, getScopes } from './client';
import type Client from 'fhirclient/lib/Client';

export type LaunchMode = 'standalone' | 'ehr' | 'callback';

/**
 * Detect current launch mode from URL parameters.
 */
export function detectLaunchMode(): LaunchMode {
  const params = new URLSearchParams(window.location.search);

  // If we have a 'code' param, we're in the OAuth callback
  if (params.has('code')) return 'callback';

  // If we have 'launch' and 'iss' params, it's an EHR launch
  if (params.has('launch') && params.has('iss')) return 'ehr';

  // Otherwise, standalone
  return 'standalone';
}

/**
 * Handle the full standalone launch flow.
 * This will redirect the browser to the authorization server.
 */
export async function handleStandaloneLaunch(
  fhirBaseUrl: string,
  clientId: string,
  scopes: string,
): Promise<void> {
  await initStandalone(fhirBaseUrl, clientId, scopes);
  // Browser will redirect — this function doesn't return in practice
}

/**
 * Handle EHR launch.
 * This will redirect the browser to the authorization server.
 */
export async function handleEhrLaunch(): Promise<void> {
  await initEhrLaunch();
  // Browser will redirect — this function doesn't return in practice
}

/**
 * Handle the OAuth callback after authorization.
 * Returns the authorized client and auth details.
 */
export async function handleCallback(): Promise<{
  client: Client;
  accessToken: string;
  fhirUser: string;
  scopes: string[];
  serverUrl: string;
}> {
  const client = await completeAuth();
  return {
    client,
    accessToken: getAccessToken(),
    fhirUser: getFhirUser(),
    scopes: getScopes(),
    serverUrl: client.state.serverUrl ?? '',
  };
}
