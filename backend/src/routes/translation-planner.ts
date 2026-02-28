import express, { Request, Response } from 'express';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import {
  deleteAllPlannedTranslations,
  deleteEmailTemplateTranslation,
  deleteUiTranslation,
  getEmailTemplateTranslationDetail,
  getTranslationCoverageReport,
  getTranslationPlannerStatus,
  getUiTranslationDetail,
  listTranslationEntries,
  retranslateLanguageParts,
  setTranslationPlannerEnabled,
  triggerTranslationPlannerRunNow,
  upsertEmailTemplateTranslation,
  upsertUiTranslation,
} from '../services/translation-planner.js';

const router = express.Router();

router.use(authMiddleware, adminOnly);

router.get('/status', async (_req: Request, res: Response) => {
  try {
    const status = await getTranslationPlannerStatus();
    return res.json(status);
  } catch (error) {
    return res.status(500).json({ message: 'Status konnte nicht geladen werden' });
  }
});

router.post('/play', async (_req: Request, res: Response) => {
  try {
    const status = await setTranslationPlannerEnabled(true);
    return res.json(status);
  } catch (error) {
    return res.status(500).json({ message: 'Play konnte nicht aktiviert werden' });
  }
});

router.post('/stop', async (_req: Request, res: Response) => {
  try {
    const status = await setTranslationPlannerEnabled(false);
    return res.json(status);
  } catch (error) {
    return res.status(500).json({ message: 'Stop konnte nicht aktiviert werden' });
  }
});

router.post('/run-now', async (_req: Request, res: Response) => {
  try {
    const status = await triggerTranslationPlannerRunNow();
    return res.json(status);
  } catch (error) {
    return res.status(500).json({ message: 'Lauf konnte nicht gestartet werden' });
  }
});

router.get('/coverage', async (req: Request, res: Response) => {
  try {
    const language = typeof req.query.language === 'string' ? req.query.language : '';
    const includeMissing =
      req.query.includeMissing === undefined
        ? true
        : String(req.query.includeMissing).trim().toLowerCase() !== 'false';
    const report = await getTranslationCoverageReport({
      language,
      includeMissing,
    });
    return res.json(report);
  } catch (error) {
    return res.status(500).json({ message: 'Abdeckungsdaten konnten nicht geladen werden' });
  }
});

router.post('/retranslate', async (req: Request, res: Response) => {
  try {
    const language = typeof req.body?.language === 'string' ? req.body.language : '';
    if (!language) {
      return res.status(400).json({ message: 'language ist erforderlich' });
    }

    const includeUi =
      req.body?.includeUi === undefined
        ? true
        : req.body?.includeUi === true ||
          req.body?.includeUi === 1 ||
          String(req.body?.includeUi).trim().toLowerCase() === 'true';
    const includeEmail =
      req.body?.includeEmail === undefined
        ? true
        : req.body?.includeEmail === true ||
          req.body?.includeEmail === 1 ||
          String(req.body?.includeEmail).trim().toLowerCase() === 'true';
    const uiKeys = Array.isArray(req.body?.uiKeys) ? req.body.uiKeys : [];
    const emailTemplateIds = Array.isArray(req.body?.emailTemplateIds) ? req.body.emailTemplateIds : [];

    const result = await retranslateLanguageParts({
      language,
      includeUi,
      includeEmail,
      uiKeys,
      emailTemplateIds,
    });
    return res.json({
      message: 'Nachübersetzung abgeschlossen',
      ...result,
    });
  } catch (error: any) {
    return res.status(400).json({
      message: error?.message || 'Nachübersetzung fehlgeschlagen',
    });
  }
});

router.get('/entries', async (req: Request, res: Response) => {
  try {
    const kind =
      req.query.kind === 'ui' || req.query.kind === 'email' || req.query.kind === 'all'
        ? (req.query.kind as 'ui' | 'email' | 'all')
        : 'all';
    const language = typeof req.query.language === 'string' ? req.query.language : '';
    const search = typeof req.query.search === 'string' ? req.query.search : '';
    const limit = parseInt(String(req.query.limit || '80'), 10);
    const offset = parseInt(String(req.query.offset || '0'), 10);

    const result = await listTranslationEntries({
      kind,
      language,
      search,
      limit: Number.isFinite(limit) ? limit : 80,
      offset: Number.isFinite(offset) ? offset : 0,
    });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: 'Übersetzungen konnten nicht geladen werden' });
  }
});

router.get('/entries/ui', async (req: Request, res: Response) => {
  try {
    const language = typeof req.query.language === 'string' ? req.query.language : '';
    const key = typeof req.query.key === 'string' ? req.query.key : '';
    if (!language || !key) {
      return res.status(400).json({ message: 'language und key sind erforderlich' });
    }

    const detail = await getUiTranslationDetail(language, key);
    if (!detail) {
      return res.status(404).json({ message: 'UI-Übersetzung nicht gefunden' });
    }
    return res.json(detail);
  } catch (error) {
    return res.status(500).json({ message: 'Detail konnte nicht geladen werden' });
  }
});

router.get('/entries/email', async (req: Request, res: Response) => {
  try {
    const language = typeof req.query.language === 'string' ? req.query.language : '';
    const templateId = typeof req.query.templateId === 'string' ? req.query.templateId : '';
    if (!language || !templateId) {
      return res.status(400).json({ message: 'language und templateId sind erforderlich' });
    }

    const detail = await getEmailTemplateTranslationDetail(language, templateId);
    if (!detail) {
      return res.status(404).json({ message: 'E-Mail-Übersetzung nicht gefunden' });
    }
    return res.json(detail);
  } catch (error) {
    return res.status(500).json({ message: 'Detail konnte nicht geladen werden' });
  }
});

router.patch('/entries/ui', async (req: Request, res: Response) => {
  try {
    const language = typeof req.body?.language === 'string' ? req.body.language : '';
    const key = typeof req.body?.key === 'string' ? req.body.key : '';
    const value = typeof req.body?.value === 'string' ? req.body.value : '';

    if (!language || !key) {
      return res.status(400).json({ message: 'language und key sind erforderlich' });
    }

    const detail = await upsertUiTranslation({ language, key, value });
    if (!detail) {
      return res.status(400).json({ message: 'UI-Übersetzung konnte nicht gespeichert werden' });
    }
    return res.json(detail);
  } catch (error) {
    return res.status(500).json({ message: 'UI-Übersetzung konnte nicht gespeichert werden' });
  }
});

router.patch('/entries/email', async (req: Request, res: Response) => {
  try {
    const language = typeof req.body?.language === 'string' ? req.body.language : '';
    const templateId = typeof req.body?.templateId === 'string' ? req.body.templateId : '';
    const templateName = typeof req.body?.templateName === 'string' ? req.body.templateName : '';
    const subject = typeof req.body?.subject === 'string' ? req.body.subject : '';
    const htmlContent = typeof req.body?.htmlContent === 'string' ? req.body.htmlContent : '';
    const textContent = typeof req.body?.textContent === 'string' ? req.body.textContent : '';
    const translationNotice =
      typeof req.body?.translationNotice === 'string' ? req.body.translationNotice : '';

    if (!language || !templateId || !subject || !htmlContent) {
      return res.status(400).json({
        message: 'language, templateId, subject und htmlContent sind erforderlich',
      });
    }

    const detail = await upsertEmailTemplateTranslation({
      language,
      templateId,
      templateName,
      subject,
      htmlContent,
      textContent,
      translationNotice,
    });

    if (!detail) {
      return res.status(400).json({ message: 'E-Mail-Übersetzung konnte nicht gespeichert werden' });
    }

    return res.json(detail);
  } catch (error) {
    return res.status(500).json({ message: 'E-Mail-Übersetzung konnte nicht gespeichert werden' });
  }
});

router.delete('/entries/ui', async (req: Request, res: Response) => {
  try {
    const language = typeof req.body?.language === 'string' ? req.body.language : '';
    const key = typeof req.body?.key === 'string' ? req.body.key : '';
    if (!language || !key) {
      return res.status(400).json({ message: 'language und key sind erforderlich' });
    }

    const deleted = await deleteUiTranslation(language, key);
    if (!deleted) {
      return res.status(404).json({ message: 'UI-Übersetzung nicht gefunden' });
    }

    return res.json({ message: 'UI-Übersetzung gelöscht' });
  } catch (error) {
    return res.status(500).json({ message: 'UI-Übersetzung konnte nicht gelöscht werden' });
  }
});

router.delete('/entries/email', async (req: Request, res: Response) => {
  try {
    const language = typeof req.body?.language === 'string' ? req.body.language : '';
    const templateId = typeof req.body?.templateId === 'string' ? req.body.templateId : '';
    if (!language || !templateId) {
      return res.status(400).json({ message: 'language und templateId sind erforderlich' });
    }

    const deleted = await deleteEmailTemplateTranslation(language, templateId);
    if (!deleted) {
      return res.status(404).json({ message: 'E-Mail-Übersetzung nicht gefunden' });
    }

    return res.json({ message: 'E-Mail-Übersetzung gelöscht' });
  } catch (error) {
    return res.status(500).json({ message: 'E-Mail-Übersetzung konnte nicht gelöscht werden' });
  }
});

router.delete('/entries', async (req: Request, res: Response) => {
  try {
    const kind =
      req.body?.kind === 'ui' || req.body?.kind === 'email' || req.body?.kind === 'all'
        ? (req.body.kind as 'all' | 'ui' | 'email')
        : 'all';
    const language = typeof req.body?.language === 'string' ? req.body.language : '';
    const stopPlanner = req.body?.stopPlanner !== false;

    const result = await deleteAllPlannedTranslations({
      kind,
      language,
      stopPlanner,
    });
    return res.json({
      message: 'Vorübersetzungen gelöscht',
      ...result,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Vorübersetzungen konnten nicht gelöscht werden' });
  }
});

export default router;
