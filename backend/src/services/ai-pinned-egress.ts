/**
 * K07: fail-closed DNS/address policy and DNS-pinned HTTPS transport.
 *
 * Do not replace this transport with generic fetch() on the configured URL:
 * that would resolve the hostname again after the address safety check.
 * This module is still isolated from the live LLM Hub / queue. Production
 * enablement additionally needs trusted RBAC/privacy policy, secret storage,
 * deployment egress firewall and an independently reviewed network setup.
 */
import { lookup } from 'node:dns/promises';
import https, { type RequestOptions } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { Readable } from 'node:stream';
import { assessProviderEndpoint } from './ai-provider-endpoint.js';

export type AiEgressTransportFailure =
  | 'endpoint_rejected'
  | 'dns_unavailable'
  | 'address_rejected'
  | 'transport_rejected';

export class AiEgressTransportError extends Error {
  constructor(readonly code: AiEgressTransportFailure) {
    super('AI egress ' + code);
    this.name = 'AiEgressTransportError';
  }
}

export interface ResolvedAddress {
  address: string;
  family: number;
}

export interface PinnedAiDestination {
  /** Canonical endpoint created by the server-side origin policy. */
  endpoint: string;
  /** Hostname used for HTTPS certificate verification and SNI. */
  hostname: string;
  /** IP explicitly checked before opening the TLS connection. */
  address: string;
  family: 4 | 6;
}

export type AiDnsResolver = (hostname: string) => Promise<ReadonlyArray<ResolvedAddress>>;

const ipv4Blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10],
  ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) ipv4Blocked.addSubnet(network, prefix, 'ipv4');

const ipv6Global = new BlockList();
ipv6Global.addSubnet('2000::', 3, 'ipv6');
const ipv6Blocked = new BlockList();
// Special-use, documentation, 6to4 tunneling and non-globally reachable IPs.
for (const [network, prefix] of [
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16],
  ['3ffe::', 16],
] as const) ipv6Blocked.addSubnet(network, prefix, 'ipv6');

/** Conservative global-unicast allow policy; unknown/special-purpose IPs fail closed. */
export function isPublicAiEgressAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !ipv4Blocked.check(address, 'ipv4');
  if (family === 6) {
    return ipv6Global.check(address, 'ipv6') &&
      !ipv6Blocked.check(address, 'ipv6');
  }
  return false;
}

const defaultResolver: AiDnsResolver = hostname =>
  lookup(hostname, { all: true, verbatim: true });

/**
 * Validate every returned A/AAAA address (not just the first). Then pin one
 * validated IP for the upcoming HTTPS request. No second DNS lookup occurs.
 * DNS resolver injection is for deterministic offline tests ONLY.
 */
export async function resolvePinnedAiDestination(
  baseUrl: string,
  allowedOrigins: ReadonlyArray<string>,
  resolver: AiDnsResolver = defaultResolver,
  dnsTimeoutMs = 3000
): Promise<PinnedAiDestination> {
  const decision = assessProviderEndpoint(baseUrl, allowedOrigins);
  if (!decision.allowed) throw new AiEgressTransportError('endpoint_rejected');
  const url = new URL(decision.endpoint);
  if (url.protocol !== 'https:' || url.port !== '' || isIP(url.hostname) !== 0) {
    throw new AiEgressTransportError('endpoint_rejected');
  }
  if (!Number.isSafeInteger(dnsTimeoutMs) || dnsTimeoutMs < 100 || dnsTimeoutMs > 10000) {
    throw new AiEgressTransportError('dns_unavailable');
  }
  let records: ReadonlyArray<ResolvedAddress>;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    records = await Promise.race([
      Promise.resolve().then(() => resolver(url.hostname)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new AiEgressTransportError('dns_unavailable')), dnsTimeoutMs);
      }),
    ]);
  } catch {
    throw new AiEgressTransportError('dns_unavailable');
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!Array.isArray(records) || records.length === 0 || records.length > 32 ||
      records.some(record =>
        !record || (record.family !== 4 && record.family !== 6) ||
        isIP(record.address) !== record.family ||
        !isPublicAiEgressAddress(record.address))) {
    throw new AiEgressTransportError('address_rejected');
  }
  const selected = records.find(record => record.family === 4) ?? records[0];
  return Object.freeze({
    endpoint: url.toString(),
    hostname: url.hostname,
    address: selected.address,
    family: selected.family as 4 | 6,
  });
}

/**
 * Expose the connection options for review and unit tests. The TLS peer is the
 * pinned IP, while SNI, Host and certificate validation use the original name.
 * No proxy, redirect or alternate DNS resolution is allowed.
 */
export function pinnedHttpsRequestOptions(
  destination: PinnedAiDestination,
  authHeader?: string
): RequestOptions {
  const url = new URL(destination.endpoint);
  if (url.protocol !== 'https:' || url.port !== '' || url.hostname !== destination.hostname ||
      isIP(destination.address) !== destination.family ||
      !isPublicAiEgressAddress(destination.address)) {
    throw new AiEgressTransportError('transport_rejected');
  }
  return {
    protocol: 'https:',
    hostname: destination.address,
    port: 443,
    method: 'POST',
    path: url.pathname,
    servername: destination.hostname,
    rejectUnauthorized: true,
    agent: false,
    headers: {
      host: destination.hostname,
      'content-type': 'application/json',
      ...(authHeader ? { authorization: authHeader } : {}),
    },
  };
}

/**
 * Single-destination Fetch-compatible transport used by the existing K02
 * adapter. The destination was resolved once and has a pinned literal IP.
 * Only its exact POST URL is accepted. The adapter owns response body limits.
 */
export function createPinnedHttpsFetcher(destination: PinnedAiDestination): typeof fetch {
  const target = pinnedHttpsRequestOptions(destination);
  return (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (String(input) !== destination.endpoint ||
        init?.method !== 'POST' || init.redirect !== 'error' ||
        typeof init.body !== 'string' || Buffer.byteLength(init.body, 'utf8') > 320_000 ||
        init.signal?.aborted) {
      throw new AiEgressTransportError('transport_rejected');
    }
    const headers = new Headers(init.headers);
    if (headers.get('content-type') !== 'application/json' ||
        [...headers.keys()].some(key => key !== 'content-type' && key !== 'authorization')) {
      throw new AiEgressTransportError('transport_rejected');
    }
    const authorization = headers.get('authorization') ?? undefined;
    const opts = pinnedHttpsRequestOptions(destination, authorization);

    return new Promise<Response>((resolve, reject) => {
      const req = https.request(opts, incoming => {
        const status = incoming.statusCode ?? 502;
        if (status < 200 || status >= 600 || (status >= 300 && status < 400)) {
          incoming.destroy();
          reject(new AiEgressTransportError('transport_rejected'));
          return;
        }
        if (status < 200 || status >= 300 || status === 204 || status === 205) {
          // Do not download, buffer or log untrusted provider error bodies.
          incoming.destroy();
          resolve(new Response(null, { status }));
          return;
        }
        // Never forward untrusted provider headers. The outer adapter also
        // bounds the streamed body and rejects malformed response JSON.
        const length = incoming.headers['content-length'];
        const safeLength = typeof length === 'string' && /^\d+$/.test(length)
          ? { 'content-length': length } : {};
        resolve(new Response(Readable.toWeb(incoming) as ReadableStream<Uint8Array>, {
          status,
          headers: safeLength,
        }));
      });
      const abort = () => req.destroy(new AiEgressTransportError('transport_rejected'));
      init.signal?.addEventListener('abort', abort, { once: true });
      req.once('close', () => init.signal?.removeEventListener('abort', abort));
      req.once('error', reject);
      req.end(init.body);
    });
  }) as typeof fetch;
}
