/**
 * © Dominik Tröster, Verbandsgemeinde Otterbach Otterberg
 * Apache License 2.0
 *
 * System Prompts API
 */

import express, { Request, Response } from 'express';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import { loadSystemPrompts, setSetting } from '../services/settings.js';

const router = express.Router();

router.use(authMiddleware, adminOnly);

/**
 * GET /api/admin/config/prompts
 * List system prompts with sources
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const { values, sources } = await loadSystemPrompts();
    res.json({ prompts: values, sources });
  } catch (error) {
    res.status(500).json({ message: 'Fehler beim Laden der Prompts' });
  }
});

/**
 * PATCH /api/admin/config/prompts
 * Update system prompts
 */
router.patch('/', async (req: Request, res: Response) => {
  try {
    const { prompts } = req.body as { prompts?: Record<string, any> };
    if (!prompts || typeof prompts !== 'object') {
      return res.status(400).json({ message: 'prompts erforderlich' });
    }

    const { values } = await loadSystemPrompts();
    const next = { ...values } as Record<string, any>;

    Object.entries(prompts).forEach(([key, value]) => {
      if (typeof value === 'string') {
        next[key] = value;
      }
    });

    await setSetting('systemPrompts', next);
    res.json({ prompts: next });
  } catch (error) {
    res.status(500).json({ message: 'Fehler beim Speichern der Prompts' });
  }
});

export default router;
