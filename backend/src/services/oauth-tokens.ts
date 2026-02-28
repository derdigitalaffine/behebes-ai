/**
 * © Dominik Tröster, Verbandsgemeinde Otterbach Otterberg
 * Apache License 2.0
 * 
 * OAuth Token Management
 */

import type { AppDatabase } from '../database.js';
import { refreshAccessToken } from './openai.js';

export async function getOAuthToken(db: AppDatabase): Promise<string> {
  const token = await db.get(
    `SELECT * FROM oauth_tokens WHERE provider = 'openai-codex' ORDER BY updated_at DESC LIMIT 1`
  );
  
  if (!token) {
    throw new Error('No OpenAI OAuth token found. Admin must connect OpenAI first.');
  }
  
  // Check if token is expired
  if (token.expires_at && token.expires_at < Date.now()) {
    // Refresh token
    const newTokens = await refreshAccessToken(token.refresh_token);
    
    // Update in database
    await db.run(
      `UPDATE oauth_tokens SET access_token = ?, expires_at = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [newTokens.accessToken, newTokens.expiresAt, token.id]
    );
    
    return newTokens.accessToken;
  }
  
  return token.access_token;
}
