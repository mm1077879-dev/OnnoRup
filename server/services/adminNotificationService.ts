import { isDbConnected } from '../db';
import {
  AdminNotificationModel,
  inMemoryAdminNotifications,
} from '../models/AdminNotification';

export interface NewAdminNotification {
  eventKey: string;
  title: string;
  description: string;
  module: string;
  referenceId?: string;
}

export async function createAdminNotification(notification: NewAdminNotification): Promise<void> {
  if (isDbConnected()) {
    try {
      await AdminNotificationModel.updateOne(
        { eventKey: notification.eventKey },
        { $setOnInsert: notification },
        { upsert: true }
      );
    } catch (error) {
      if ((error as { code?: number })?.code !== 11000) throw error;
    }
    return;
  }

  if (inMemoryAdminNotifications.some((item) => item.eventKey === notification.eventKey)) return;
  inMemoryAdminNotifications.unshift({
    ...notification,
    id: notification.eventKey,
    readBy: [],
    createdAt: new Date().toISOString(),
  });
}
