/**
 * © Dominik Tröster, Verbandsgemeinde Otterbach Otterberg
 * Apache License 2.0
 * 
 * OpenAI OAuth & Token Management
 */

import axios from 'axios';
import { loadAiCredentials } from './settings.js';

interface OpenAITokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  accountId?: string;
}

export async function exchangeCodeForToken(code: string, codeVerifier: string): Promise<OpenAITokens> {
  const { values: creds } = await loadAiCredentials(false);
  
  const response = await axios.post('https://auth.openai.com/oauth/token', {
    client_id: creds.openaiClientId,
    client_secret: creds.openaiClientSecret,
    code,
    redirect_uri: `${process.env.ADMIN_URL || 'http://localhost:5174'}/auth/openai/callback`,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
  });
  
  const { access_token, refresh_token, expires_in } = response.data;
  
  return {
    accessToken: access_token,
    refreshToken: refresh_token,
    expiresAt: Date.now() + (expires_in * 1000),
    accountId: extractAccountIdFromToken(access_token),
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<OpenAITokens> {
  const { values: creds } = await loadAiCredentials(false);
  
  const response = await axios.post('https://auth.openai.com/oauth/token', {
    client_id: creds.openaiClientId,
    client_secret: creds.openaiClientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  
  const { access_token, expires_in, refresh_token: newRefreshToken } = response.data;
  
  return {
    accessToken: access_token,
    refreshToken: newRefreshToken || refreshToken,
    expiresAt: Date.now() + (expires_in * 1000),
  };
}

/**
 * Extract account ID from OpenAI JWT token (without verification)
 * Format: header.payload.signature - wir brauchen nur payload
 */
function extractAccountIdFromToken(token: string): string | undefined {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return undefined;
    
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    return payload.sub || payload.account_id;
  } catch {
    return undefined;
  }
}
