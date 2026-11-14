import mongoose, { Schema, Document } from 'mongoose';

export type NavigationItemType = 'link' | 'dropdown' | 'category' | 'external';

export interface INavigationItem extends Document {
  label: string;
  type: NavigationItemType;
  destination: string;
  parentId?: string | null;
  displayOrder: number;
  isActive: boolean;
  image?: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

const NavigationItemSchema = new Schema<INavigationItem>(
  {
    label: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ['link', 'dropdown', 'category', 'external'],
      required: true,
      default: 'link',
      index: true,
    },
    destination: { type: String, default: '', trim: true },
    parentId: { type: String, default: null, index: true },
    displayOrder: { type: Number, default: 0, index: true },
    isActive: { type: Boolean, default: true, index: true },
    image: { type: String, default: '' },
    description: { type: String, default: '' },
  },
  { timestamps: true }
);

NavigationItemSchema.index({ parentId: 1, displayOrder: 1, isActive: 1 });

export const NavigationItemModel = mongoose.models.NavigationItem || mongoose.model<INavigationItem>('NavigationItem', NavigationItemSchema);
