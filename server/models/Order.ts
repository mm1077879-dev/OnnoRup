import mongoose, { Schema, Document } from 'mongoose';
import { OrderStatus } from '../../src/utils/ecommerceRules';

export interface IOrderItemSnapshot {
  productId: string;
  variantId?: string;
  variantName?: string;
  sku: string;
  name: string;
  unitPrice: number;
  quantity: number;
  total: number;
  image: string;
}

export interface IOrderTimelineItem {
  status: OrderStatus;
  timestamp: Date;
  actor: string;
  note?: string;
}

export interface IOrderAddressSnapshot {
  name: string;
  phone: string;
  country?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  division: string;
  divisionId?: string;
  district: string;
  districtId?: string;
  upazila?: string;
  upazilaId?: string;
  unionWard?: string;
  unionId?: string;
  street: string;
  landmark?: string;
}

export interface IOrder extends Document {
  orderNumber: string;
  idempotencyKey?: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  items: IOrderItemSnapshot[];
  subtotal: number;
  discount: number;
  couponCode?: string;
  shippingFee: number;
  shippingMethod?: 'standard' | 'express' | 'next_day';
  shippingMethodName?: string;
  tax: number;
  finalTotal: number;
  shippingAddress: IOrderAddressSnapshot;
  paymentMethod: 'cod' | 'bkash' | 'nagad' | 'card' | 'credit_card' | 'sslcommerz' | 'paypal';
  paymentStatus: 'unpaid' | 'paid' | 'failed' | 'refunded';
  paymentTransactionId?: string;
  paymentPaidAt?: Date;
  codCollectedAt?: Date;
  codCollectedBy?: string;
  paymentDetails?: {
    cardLast4?: string;
    cardBrand?: string;
    cardExpMonth?: string;
    cardExpYear?: string;
  };
  paymentLock?: boolean;
  paymentLockAt?: Date;
  paymentAccessTokenHash?: string;
  status: OrderStatus;
  statusTimeline: IOrderTimelineItem[];
  staffNotes?: string;
  cancellationReason?: string;
  cancellationRequestStatus?: 'none' | 'pending_approval' | 'approved' | 'rejected' | 'withdrawn';
  cancellationRequestId?: string;
  cancellationRequestedAt?: Date;
  cancellationReviewedAt?: Date;
  cancellationReviewedBy?: string;
  cancellationDecisionReason?: string;
  stockRestored?: boolean;
  currency?: string;
  historicalAuditVerified?: boolean;
  saveAddressOnConfirmation?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const OrderItemSnapshotSchema = new Schema<IOrderItemSnapshot>(
  {
    productId: { type: String, required: true },
    variantId: { type: String },
    variantName: { type: String },
    sku: { type: String, required: true },
    name: { type: String, required: true },
    unitPrice: { type: Number, required: true },
    quantity: { type: Number, required: true, min: 1 },
    total: { type: Number, required: true },
    image: { type: String, required: true },
  },
  { _id: false }
);

const OrderTimelineItemSchema = new Schema<IOrderTimelineItem>(
  {
    status: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    actor: { type: String, required: true },
    note: { type: String },
  },
  { _id: false }
);

const OrderAddressSnapshotSchema = new Schema<IOrderAddressSnapshot>(
  {
    name: { type: String, required: true },
    phone: { type: String, required: true },
    country: { type: String, default: 'Bangladesh' },
    city: { type: String, default: 'Dhaka' },
    state: { type: String, default: 'Dhaka' },
    postalCode: { type: String, default: '1209' },
    division: { type: String, required: true },
    divisionId: { type: String },
    district: { type: String, required: true },
    districtId: { type: String },
    upazila: { type: String },
    upazilaId: { type: String },
    unionWard: { type: String },
    unionId: { type: String },
    street: { type: String, required: true },
    landmark: { type: String },
  },
  { _id: false }
);

const OrderSchema = new Schema<IOrder>(
  {
    orderNumber: { type: String, required: true, unique: true, index: true },
    idempotencyKey: { type: String },
    customerId: { type: String, required: true, index: true },
    customerName: { type: String, required: true },
    customerEmail: { type: String, required: true, index: true },
    customerPhone: { type: String, required: true },
    items: [OrderItemSnapshotSchema],
    subtotal: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    couponCode: { type: String },
    shippingFee: { type: Number, required: true },
    shippingMethod: {
      type: String,
      enum: ['standard', 'express', 'next_day'],
      default: 'standard',
    },
    shippingMethodName: { type: String, default: 'Standard Shipping' },
    tax: { type: Number, default: 0 },
    finalTotal: { type: Number, required: true },
    shippingAddress: { type: OrderAddressSnapshotSchema, required: true },
    paymentMethod: {
      type: String,
      enum: ['cod', 'bkash', 'nagad', 'card', 'credit_card', 'sslcommerz', 'paypal'],
      required: true,
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'paid', 'failed', 'refunded'],
      default: 'unpaid',
      index: true,
    },
    paymentTransactionId: { type: String },
    paymentPaidAt: { type: Date },
    codCollectedAt: { type: Date },
    codCollectedBy: { type: String },
    paymentLock: { type: Boolean },
    paymentLockAt: { type: Date },
    paymentAccessTokenHash: { type: String, select: false },
    paymentDetails: {
      cardLast4: { type: String },
      cardBrand: { type: String },
      cardExpMonth: { type: String },
      cardExpYear: { type: String },
    },
    status: {
      type: String,
      enum: [
        'pending',
        'confirmed',
        'processing',
        'packed',
        'shipped',
        'delivered',
        'cancelled',
        'returned',
        'refunded',
      ],
      default: 'pending',
      index: true,
    },
    statusTimeline: [OrderTimelineItemSchema],
    staffNotes: { type: String },
    cancellationReason: { type: String },
    cancellationRequestStatus: {
      type: String,
      enum: ['none', 'pending_approval', 'approved', 'rejected', 'withdrawn'],
      default: 'none',
      index: true,
    },
    cancellationRequestId: { type: String },
    cancellationRequestedAt: { type: Date },
    cancellationReviewedAt: { type: Date },
    cancellationReviewedBy: { type: String },
    cancellationDecisionReason: { type: String },
    stockRestored: { type: Boolean, default: false },
    currency: { type: String, default: 'BDT', index: true },
    historicalAuditVerified: { type: Boolean },
    saveAddressOnConfirmation: { type: Boolean, default: false, select: false },
  },
  { timestamps: true }
);

OrderSchema.index({ customerId: 1, createdAt: -1 });
OrderSchema.index({ status: 1, createdAt: -1 });
OrderSchema.index({ paymentTransactionId: 1 }, { sparse: true });
OrderSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

export const OrderModel = mongoose.models.Order || mongoose.model<IOrder>('Order', OrderSchema);
