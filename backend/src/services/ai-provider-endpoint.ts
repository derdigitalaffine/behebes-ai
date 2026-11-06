/**
 * K07: static URL/origin gate for a server-approved HTTPS AI provider.
 *
 * Important: this is defense in depth, NOT DNS rebinding protection. The
 * deployment must enforce outbound DNS/IP/port rules or a dedicated pinned
 * egress proxy before runtime traffic is allowed. Local models need a
 * separately reviewed K19 connector, not an exception to this validator.
 */
import { isIP } from 'node:net';

export type EndpointDecision =
  | { allowed: true; endpoint: string; origin: string }
  | { allowed: false; reason: 'invalid_endpoint' | 'unapproved_origin' | 'restricted_host' };

const deny = (reason: Extract<EndpointDecision, { allowed: false }>['reason']): EndpointDecision =>
  ({ allowed: false, reason });

function restrictedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (!host || isIP(host) !== 0 || !host.includes('.')) return true;
  const blockedSuffixes = [
    'localhost', 'localdomain', 'local', 'internal', 'lan', 'home', 'arpa',
  ];
  if (blockedSuffixes.some(s => host === s || host.endsWith('.' + s))) return true;
  return host.includes('..') || host.length > 253;
}

function approvedOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
        url.pathname !== '/' || restrictedHostname(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function assessProviderEndpoint(
  baseUrl: string,
  allowedOrigins: ReadonlyArray<string>
): EndpointDecision {
  if (typeof baseUrl !== 'string' || !Array.isArray(allowedOrigins) ||
      allowedOrigins.length === 0) return deny('invalid_endpoint');
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return deny('invalid_endpoint');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      restrictedHostname(url.hostname)) return deny('restricted_host');
  const basePath = url.pathname.replace(/\/+$/g, '');
  if (basePath.endsWith('/chat/completions') || /%(?:2f|5c)/i.test(basePath) ||
      basePath.includes('\\')) return deny('invalid_endpoint');
  const known = allowedOrigins.map(approvedOrigin).filter((x): x is string => x !== null);
  if (!known.includes(url.origin)) return deny('unapproved_origin');
  url.pathname = (basePath || '') + '/chat/completions';
  return { allowed: true, endpoint: url.toString(), origin: url.origin };
}
