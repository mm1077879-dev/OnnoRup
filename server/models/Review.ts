import mongoose, { Schema, Document } from 'mongoose';

export interface IReview extends Document {
  productId: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  rating: number;
  title?: string;
  comment: string;
  isVerifiedPurchase: boolean;
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason?: string;
  helpfulCount: number;
  notHelpfulCount: number;
  isReported: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ReviewSchema = new Schema<IReview>(
  {
    productId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    userName: { type: String, required: true },
    userAvatar: { type: String },
    rating: { type: Number, required: true, min: 1, max: 5 },
    title: { type: String, trim: true },
    comment: { type: String, required: true, trim: true },
    isVerifiedPurchase: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'approved',
      index: true,
    },
    rejectionReason: { type: String },
    helpfulCount: { type: Number, default: 0 },
    notHelpfulCount: { type: Number, default: 0 },
    isReported: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

ReviewSchema.index({ productId: 1, userId: 1 }, { unique: true });

export interface IReviewVote extends Document {
  reviewId: string;
  userId: string;
  voteType: 'helpful' | 'not_helpful';
  createdAt: Date;
  updatedAt: Date;
}

const ReviewVoteSchema = new Schema<IReviewVote>(
  {
    reviewId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    voteType: { type: String, enum: ['helpful', 'not_helpful'], required: true },
  },
  { timestamps: true }
);

ReviewVoteSchema.index({ reviewId: 1, userId: 1 }, { unique: true });

export const ReviewModel = mongoose.models.Review || mongoose.model<IReview>('Review', ReviewSchema);
export const ReviewVoteModel = mongoose.models.ReviewVote || mongoose.model<IReviewVote>('ReviewVote', ReviewVoteSchema);
