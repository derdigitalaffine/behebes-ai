/**
 * © Dominik Tröster, Verbandsgemeinde Otterbach Otterberg
 * Apache License 2.0
 * 
 * Tool Execution for AI Function Calling
 */

import axios from 'axios';
import { AIToolInput } from '../models/types.js';
import { queueEmail } from './email.js';

export async function executeToolCall(
  toolName: string,
  toolInput: AIToolInput
): Promise<any> {
  switch (toolName) {
    case 'curl':
      return executeCurl(toolInput);
    case 'send_email':
      return sendEmailTool(toolInput);
    case 'create_ticket':
      return createTicket(toolInput);
    case 'log_decision':
      return logDecision(toolInput);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

async function executeCurl(input: AIToolInput): Promise<any> {
  try {
    const response = await axios({
      method: (input.method || 'GET') as any,
      url: input.url,
      headers: input.headers,
      data: input.body,
    });
    return { success: true, status: response.status, data: response.data };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error),
      status: (error as any)?.response?.status
    };
  }
}

async function sendEmailTool(input: AIToolInput): Promise<any> {
  const to = typeof input.to === 'string' ? input.to.trim() : '';
  const subject = typeof input.subject === 'string' ? input.subject.trim() : '';
  const html =
    typeof input.body?.html === 'string'
      ? input.body.html
      : typeof input.text === 'string'
      ? input.text
      : '';
  const text = typeof input.text === 'string' ? input.text : undefined;

  if (!to || !subject || !html) {
    return {
      success: false,
      error: 'send_email requires to, subject and html/text content',
    };
  }

  const queued = await queueEmail({ to, subject, html, text });
  if (!queued) {
    return { success: false, error: 'Email could not be queued' };
  }

  return {
    success: true,
    message: `Email queued for ${to}`,
    queueId: queued.id,
  };
}

async function createTicket(input: AIToolInput): Promise<any> {
  // TODO: Implement via database
  return { success: true, ticketId: 'TKT-123' };
}

async function logDecision(input: AIToolInput): Promise<any> {
  // TODO: Implement via database
  return { success: true };
}
