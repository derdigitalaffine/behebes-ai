import express, { Request, Response } from 'express';
import { getDatabase } from '../database.js';
import { getPlatformBlogPostBySlug, listPublicPlatformBlogPosts } from '../services/platform-blog.js';

const router = express.Router();

router.get('/stats', async (_req: Request, res: Response): Promise<any> => {
  try {
    const db = getDatabase();
    const [
      ticketCountRow,
      openTicketCountRow,
      tenantCountRow,
      adminUserCountRow,
      citizenCountRow,
      internalTaskCountRow,
      blogPostCountRow,
      recentTicketRow,
    ] = await Promise.all([
      db.get<any>(`SELECT COUNT(*) AS count FROM tickets`),
      db.get<any>(
        `SELECT COUNT(*) AS count
         FROM tickets
         WHERE status IN ('pending_validation', 'pending', 'open', 'assigned', 'in-progress')`
      ),
      db.get<any>(`SELECT COUNT(*) AS count FROM tenants WHERE COALESCE(active, 1) = 1`),
      db.get<any>(`SELECT COUNT(*) AS count FROM admin_users WHERE COALESCE(active, 1) = 1`),
      db.get<any>(`SELECT COUNT(*) AS count FROM citizens`),
      db.get<any>(
        `SELECT COUNT(*) AS count
         FROM workflow_internal_tasks
         WHERE status IN ('pending', 'in_progress')`
      ),
      db.get<any>(
        `SELECT COUNT(*) AS count
         FROM platform_blog_posts
         WHERE status IN ('published', 'scheduled')`
      ),
      db.get<any>(
        `SELECT MAX(updated_at) AS last_update
         FROM tickets`
      ),
    ]);

    return res.json({
      totals: {
        tickets: Number(ticketCountRow?.count || 0),
        openTickets: Number(openTicketCountRow?.count || 0),
        tenants: Number(tenantCountRow?.count || 0),
        adminUsers: Number(adminUserCountRow?.count || 0),
        citizens: Number(citizenCountRow?.count || 0),
        activeInternalTasks: Number(internalTaskCountRow?.count || 0),
        publishedBlogPosts: Number(blogPostCountRow?.count || 0),
      },
      lastTicketUpdateAt: recentTicketRow?.last_update ? String(recentTicketRow.last_update) : null,
      generatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Plattform-Statistiken konnten nicht geladen werden.',
      error: error?.message || String(error),
    });
  }
});

router.get('/blog', async (req: Request, res: Response): Promise<any> => {
  try {
    const limitRaw = Number(req.query?.limit);
    const offsetRaw = Number(req.query?.offset);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(120, Math.floor(limitRaw))) : 12;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;
    const result = await listPublicPlatformBlogPosts({ limit, offset });
    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({
      message: 'Plattform-Blog konnte nicht geladen werden.',
      error: error?.message || String(error),
    });
  }
});

router.get('/blog/:slug', async (req: Request, res: Response): Promise<any> => {
  try {
    const slug = String(req.params?.slug || '').trim();
    if (!slug) {
      return res.status(400).json({ message: 'Slug fehlt.' });
    }
    const item = await getPlatformBlogPostBySlug(slug);
    if (!item) {
      return res.status(404).json({ message: 'Blogbeitrag nicht gefunden.' });
    }
    return res.json({ item });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Blogbeitrag konnte nicht geladen werden.',
      error: error?.message || String(error),
    });
  }
});

export default router;
