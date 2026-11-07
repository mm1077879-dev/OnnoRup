import mongoose, { Schema, Document } from 'mongoose';

export interface IAdminNotification extends Document {
  eventKey: string;
  title: string;
  description: string;
  module: string;
  referenceId?: string;
  readBy: string[];
  createdAt: Date;
}

const AdminNotificationSchema = new Schema<IAdminNotification>(
  {
    eventKey: { type: String, required: true, unique: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    module: { type: String, required: true, trim: true },
    referenceId: { type: String },
    readBy: { type: [String], default: [] },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

AdminNotificationSchema.index({ createdAt: -1 });

export const AdminNotificationModel =
  mongoose.models.AdminNotification ||
  mongoose.model<IAdminNotification>('AdminNotification', AdminNotificationSchema);

export interface InMemoryAdminNotification {
  id: string;
  eventKey: string;
  title: string;
  description: string;
  module: string;
  referenceId?: string;
  readBy: string[];
  createdAt: string;
}

export const inMemoryAdminNotifications: InMemoryAdminNotification[] = [];
