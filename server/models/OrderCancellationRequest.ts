import mongoose, { Schema, Document } from 'mongoose';

export interface IOrderCancellationRequest extends Document {
  orderId: string;
  orderNumber: string;
  customerId: string;
  customerEmail: string;
  status: 'pending_approval' | 'approved' | 'rejected' | 'withdrawn';
  reason: string;
  detail?: string;
  requestedAt: Date;
  reviewedAt?: Date;
  reviewedBy?: string;
  reviewReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const OrderCancellationRequestSchema = new Schema<IOrderCancellationRequest>(
  {
    orderId: { type: String, required: true, index: true },
    orderNumber: { type: String, required: true, index: true },
    customerId: { type: String, required: true, index: true },
    customerEmail: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ['pending_approval', 'approved', 'rejected', 'withdrawn'],
      default: 'pending_approval',
      index: true,
    },
    reason: { type: String, required: true },
    detail: { type: String },
    requestedAt: { type: Date, default: Date.now },
    reviewedAt: { type: Date },
    reviewedBy: { type: String },
    reviewReason: { type: String },
  },
  { timestamps: true }
);

OrderCancellationRequestSchema.index({ orderId: 1, status: 1 }, { unique: false });
OrderCancellationRequestSchema.index({ customerId: 1, status: 1, requestedAt: -1 });

export const OrderCancellationRequestModel =
  mongoose.models.OrderCancellationRequest ||
  mongoose.model<IOrderCancellationRequest>('OrderCancellationRequest', OrderCancellationRequestSchema);
