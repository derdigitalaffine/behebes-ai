/**
 * K03: server-only, tenant-/connection-scoped AI secret resolution.
 *
 * Binding descriptors must be created by a trusted backend configuration
 * process. They may not be submitted by clients or inferred from a provider
 * URL. Never log binding values or resolved credentials.
 */
import type {
  AiCredentialAccessContext,
  AiCredentialResolver,
} from './ai-governed-gateway.js';

export interface AiCredentialBinding {
  /** Stable opaque credential key stored with a reviewed connection. */
  ref: string;
  tenantId: string;
  providerId: string;
  connectionId: string;
  /** Exact provider secret name in the server's approved secret source. */
  secretKey: string;
}

export interface AiSecretReader {
  read(key: string): Promise<string | null | undefined> | string | null | undefined;
}

export class AiCredentialConfigurationError extends Error {
  constructor() {
    super('AI credential binding invalid');
    this.name = 'AiCredentialConfigurationError';
  }
}

const safeIdentity = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value);
const safeReference = (value: unknown): value is string =>
  typeof value === 'string' && /^ai-provider\/[a-z0-9][a-z0-9-]{1,63}$/.test(value);
const safeSecretName = (value: unknown): value is string =>
  typeof value === 'string' && /^AI_PROVIDER_[A-Z0-9_]{1,80}$/.test(value);
const safeSecret = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 1 && value.length <= 4096 &&
  /^[\x21-\x7e]+$/.test(value);

/**
 * Fail closed for malformed/duplicate bindings before reading any secret.
 * Resolve with an exact tenant + provider + connection identity on every call.
 *
 * The reader may be backed by an approved managed secret service; its access,
 * encryption, rotation, audit and availability must be configured separately.
 * No caching: a reader can supply a rotated value on the next request.
 */
export function createBoundAiCredentialResolver(
  bindings: ReadonlyArray<AiCredentialBinding>,
  reader: AiSecretReader
): AiCredentialResolver {
  if (!Array.isArray(bindings) || !reader || typeof reader.read !== 'function') {
    throw new AiCredentialConfigurationError();
  }
  const indexed = new Map<string, Readonly<AiCredentialBinding>>();
  for (const entry of bindings) {
    if (!entry || !safeReference(entry.ref) || !safeIdentity(entry.tenantId) ||
        !safeIdentity(entry.providerId) || !safeIdentity(entry.connectionId) ||
        !safeSecretName(entry.secretKey) || indexed.has(entry.ref)) {
      throw new AiCredentialConfigurationError();
    }
    indexed.set(entry.ref, Object.freeze({ ...entry }));
  }
  return {
    async resolve(ref: string, identity: AiCredentialAccessContext): Promise<string | null> {
      if (!safeReference(ref) || !identity ||
          !safeIdentity(identity.tenantId) || !safeIdentity(identity.providerId) ||
          !safeIdentity(identity.connectionId)) return null;
      const entry = indexed.get(ref);
      if (!entry || entry.tenantId !== identity.tenantId ||
          entry.providerId !== identity.providerId ||
          entry.connectionId !== identity.connectionId) return null;
      try {
        const value = await reader.read(entry.secretKey);
        return safeSecret(value) ? value : null;
      } catch {
        // Never propagate secret-service exceptions with URLs, tokens or PII.
        return null;
      }
    },
  };
}

/**
 * Conservative deployment adapter. Secrets come from explicitly allowlisted
 * AI_PROVIDER_* environment keys; never derive variable names from a tenant
 * or user-provided model name. Container env rotation normally needs a
 * supervised service restart. Prefer a managed secret reader when available.
 */
export function createEnvironmentAiCredentialResolver(
  bindings: ReadonlyArray<AiCredentialBinding>
): AiCredentialResolver {
  return createBoundAiCredentialResolver(bindings, {
    read: secretKey => process.env[secretKey],
  });
}
