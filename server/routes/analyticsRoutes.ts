import { Router, Request, Response } from 'express';
import { inMemoryUsers } from './authRoutes';
import { UserModel } from '../models/User';
import { isDbConnected } from '../db';
import { inMemoryOrders } from './checkoutRoutes';

const router = Router();

// Heartbeat & visitor session state
interface ActiveSession {
  sessionId: string;
  userId?: string;
  page: string;
  lastSeen: number;
  userAgent?: string;
  device: 'desktop' | 'mobile' | 'tablet';
  createdAt: number;
}

const activeSessions: Map<string, ActiveSession> = new Map();
const dailyVisitors: Set<string> = new Set();
let pageViewCount = 0;
const pageViewsByPath: Record<string, number> = {};
let visitorDay = new Date().toISOString().slice(0, 10);

function resetDailyVisitorsIfNeeded(): void {
  const currentDay = new Date().toISOString().slice(0, 10);
  if (currentDay !== visitorDay) {
    dailyVisitors.clear();
    visitorDay = currentDay;
  }
}

// 1. Visitor Heartbeat Ping (called every 30-60s by client)
router.post('/heartbeat', (req: Request, res: Response) => {
  try {
    const { sessionId, page, device } = req.body;
    if (!sessionId) {
      res.status(400).json({ success: false, error: 'Session ID is required.' });
      return;
    }

    const now = Date.now();
    resetDailyVisitorsIfNeeded();
    const existing = activeSessions.get(sessionId);

    activeSessions.set(sessionId, {
      sessionId,
      userId: req.user?.userId,
      page: page || existing?.page || '/',
      lastSeen: now,
      device: ['desktop', 'mobile', 'tablet'].includes(device) ? device : existing?.device || 'desktop',
      createdAt: existing?.createdAt || now,
    });

    dailyVisitors.add(sessionId);

    // Prune stale sessions older than 15 minutes
    for (const [sId, sess] of activeSessions.entries()) {
      if (now - sess.lastSeen > 15 * 60 * 1000) {
        activeSessions.delete(sId);
      }
    }

    res.json({ success: true, timestamp: now });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Page View Tracking
router.post('/track-view', (req: Request, res: Response) => {
  try {
    const { path, sessionId } = req.body;
    resetDailyVisitorsIfNeeded();
    pageViewCount += 1;
    if (path) {
      pageViewsByPath[path] = (pageViewsByPath[path] || 0) + 1;
    }
    if (sessionId) {
      dailyVisitors.add(sessionId);
    }
    res.json({ success: true, totalPageViews: pageViewCount });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Real-Time Analytics Dashboard Summary (Dynamic DB calculations)
router.get('/realtime', async (req: Request, res: Response) => {
  try {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    let usersList: any[] = [];

    if (isDbConnected()) {
      try {
        const dbUsers = await UserModel.find().select('name email role createdAt').sort({ createdAt: -1 });
        if (dbUsers.length > 0) {
          usersList = dbUsers.map((u) => ({
            id: u._id.toString(),
            name: u.name,
            email: u.email,
            role: u.role,
            createdAt: u.createdAt,
          }));
        }
      } catch (dbErr) {
        console.warn('DB user query failed, falling back to memory store:', dbErr);
      }
    }

    if (usersList.length === 0) {
      usersList = inMemoryUsers;
    }

    const totalRegisteredUsers = usersList.length;

    // Filter registrations by timeframe
    const newRegistrationsToday = usersList.filter(
      (u) => new Date(u.createdAt).getTime() >= oneDayAgo
    ).length;

    const newRegistrations7Days = usersList.filter(
      (u) => new Date(u.createdAt).getTime() >= sevenDaysAgo
    ).length;

    const newRegistrations30Days = usersList.filter(
      (u) => new Date(u.createdAt).getTime() >= thirtyDaysAgo
    ).length;

    // Active online visitors within 5 minutes threshold
    const fiveMinutesAgo = now - 5 * 60 * 1000;
    const onlineSessions = Array.from(activeSessions.values()).filter(
      (s) => s.lastSeen >= fiveMinutesAgo
    );
    const currentOnlineVisitors = Math.max(1, onlineSessions.length);

    // Unique visitors and pageviews
    const uniqueVisitorsToday = dailyVisitors.size;
    const totalVisitorsToday = uniqueVisitorsToday;

    // Recent registered users preview
    const recentUsers = usersList.slice(0, 5).map((u) => ({
      name: u.name,
      email: u.email,
      role: u.role,
      joinedAt: u.createdAt,
    }));

    // Device breakdown
    const devices = { desktop: 0, mobile: 0, tablet: 0 };
    onlineSessions.forEach((s) => {
      devices[s.device] = (devices[s.device] || 0) + 1;
    });

    const totalOnlineSessions = onlineSessions.length;
    const devicePercentage = (count: number) =>
      totalOnlineSessions ? `${Math.round((count / totalOnlineSessions) * 100)}%` : '0%';

    res.json({
      success: true,
      data: {
        totalRegisteredUsers,
        newRegistrationsToday,
        newRegistrations7Days,
        newRegistrations30Days,
        currentOnlineVisitors,
        uniqueVisitorsToday,
        totalVisitorsToday,
        totalPageViews: pageViewCount,
        recentUsers,
        pageViewsByPath,
        visitorTrends: [],
        deviceBreakdown: {
          desktop: devicePercentage(devices.desktop),
          mobile: devicePercentage(devices.mobile),
          tablet: devicePercentage(devices.tablet),
        },
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
