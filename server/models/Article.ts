import mongoose, { Schema, Document } from 'mongoose';

export interface IArticle extends Document {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  coverImage: string;
  category: string;
  author: {
    name: string;
    role: string;
    avatar: string;
  };
  readTimeMinutes: number;
  publishedAt: Date;
  featured: boolean;
  tags: string[];
  viewsCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const ArticleSchema = new Schema<IArticle>(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    excerpt: { type: String, required: true, trim: true },
    content: { type: String, required: true },
    coverImage: { type: String, required: true },
    category: { type: String, required: true, trim: true },
    author: {
      name: { type: String, required: true },
      role: { type: String, default: 'Editorial Staff' },
      avatar: { type: String, default: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&q=80' },
    },
    readTimeMinutes: { type: Number, default: 4 },
    publishedAt: { type: Date, default: Date.now },
    featured: { type: Boolean, default: false },
    tags: [{ type: String, trim: true }],
    viewsCount: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_, ret: any) => {
        ret.id = ret._id ? ret._id.toString() : ret.id;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

ArticleSchema.index({ slug: 1 });
ArticleSchema.index({ category: 1, publishedAt: -1 });
ArticleSchema.index({ featured: 1 });

export const ArticleModel = mongoose.models.Article || mongoose.model<IArticle>('Article', ArticleSchema);
