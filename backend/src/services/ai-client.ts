/**
 * AI Client Factory - Unified interface for OpenAI and AskCodi
 * © Dominik Tröster, Verbandsgemeinde Otterbach Otterberg
 * Apache License 2.0
 */

import OpenAI from 'openai';
import { AiRuntimeConfig } from './settings.js';

/**
 * Creates an OpenAI-compatible client based on configured provider
 * Both OpenAI and AskCodi expose compatible ChatCompletion APIs
 */
export function createAIClient(config: AiRuntimeConfig): OpenAI {
  if (config.aiProvider === 'askcodi') {
    if (!config.askcodi.apiKey) {
      throw new Error('ASKCODI_API_KEY environment variable is required for AskCodi provider');
    }

    // Normalize baseUrl: remove trailing slashes and optional /v1 suffix
    let base = config.askcodi.baseUrl || '';
    base = base.replace(/\/+$/g, '');
    base = base.replace(/\/v1$/g, '');

    return new OpenAI({
      apiKey: config.askcodi.apiKey,
      baseURL: base,
      defaultHeaders: {
        'User-Agent': 'behebes.AI/1.0.0 (AskCodi Provider)',
      },
    });
  }

  // Default: OpenAI
  if (!config.openaiClientId || !config.openaiClientSecret) {
    throw new Error('OPENAI_CLIENT_ID and OPENAI_CLIENT_SECRET required for OpenAI provider');
  }

  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || '',
    defaultHeaders: {
      'User-Agent': 'behebes.AI/1.0.0 (OpenAI Provider)',
    },
  });
}

/**
 * Get provider info for logging/monitoring
 */
export function getProviderInfo(config: AiRuntimeConfig): {
  provider: string;
  model: string;
  baseUrl?: string;
} {
  if (config.aiProvider === 'askcodi') {
    return {
      provider: 'AskCodi Gateway',
      model: config.aiModel,
      baseUrl: config.askcodi.baseUrl,
    };
  }

  return {
    provider: 'OpenAI API',
    model: config.aiModel,
  };
}
