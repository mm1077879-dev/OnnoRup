import { Router, Request, Response } from 'express';
import { verifyToken } from '../middleware/auth';
import {
  recordUserInteraction,
  getPersonalizedRecommendations,
  mergeAnonymousSessionIntoUser,
  InteractionEventType,
} from '../models/UserInteraction';

const router = Router();

function extractUserAndSession(req: Request): { userId?: string; sessionId?: string } {
  let userId: string | undefined;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const decoded = verifyToken(authHeader.slice('Bearer '.length));
    if (decoded) userId = decoded.userId;
  }

  const sessionId =
    (req.headers['x-session-id'] as string) ||
    (req.headers['x-device-id'] as string) ||
    req.ip ||
    'anonymous-session';

  return { userId, sessionId };
}

/**
 * POST /api/recommendations/track
 * Records user interactions (product views, searches, category visits, completed orders)
 */
router.post('/track', async (req: Request, res: Response) => {
  try {
    const { eventType, productId, category, searchQuery, metadata } = req.body;

    const allowedEvents: InteractionEventType[] = [
      'product_view',
      'search',
      'search_click',
      'category_view',
      'order_complete',
    ];

    if (!eventType || !allowedEvents.includes(eventType)) {
      res.status(400).json({ success: false, error: 'Valid eventType is required' });
      return;
    }

    const { userId, sessionId } = extractUserAndSession(req);

    await recordUserInteraction({
      userId,
      sessionId,
      eventType,
      productId,
      category,
      searchQuery,
      metadata,
    });

    res.json({ success: true, message: 'Interaction tracked successfully' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/recommendations/personalized
 * Returns scored products based on past searches, views, order history, and category affinity
 */
router.get('/personalized', async (req: Request, res: Response) => {
  try {
    const { currentProductId, currentCategory, limit } = req.query;
    const { userId, sessionId } = extractUserAndSession(req);

    const parsedLimit = Math.min(24, Math.max(1, parseInt(limit as string, 10) || 8));

    const recommendations = await getPersonalizedRecommendations({
      userId,
      sessionId,
      currentProductId: currentProductId as string,
      currentCategory: currentCategory as string,
      limit: parsedLimit,
    });

    res.json({
      success: true,
      data: recommendations,
      count: recommendations.length,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/merge', async (req: Request, res: Response) => {
  try {
    const { userId: bodyUserId, sessionId: bodySessionId } = req.body || {};
    const { userId, sessionId } = extractUserAndSession(req);
    const resolvedUserId = bodyUserId || userId;
    const resolvedSessionId = bodySessionId || sessionId;

    if (!resolvedUserId) {
      return res.status(401).json({ success: false, error: 'Authentication required to merge anonymous activity.' });
    }

    const result = await mergeAnonymousSessionIntoUser({
      userId: resolvedUserId,
      sessionId: resolvedSessionId,
    });

    res.json({
      success: true,
      mergedCount: result.mergedCount,
      alreadyMerged: result.alreadyMerged,
      message: result.mergedCount > 0 ? 'Anonymous browsing history merged into account.' : 'No anonymous activity to merge.',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to merge anonymous history.' });
  }
});

export default router;
