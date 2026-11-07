import { Router, Request, Response } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { inMemoryOrders, restoreOrderStock } from './checkoutRoutes';
import { OrderModel } from '../models/Order';
import { OrderCancellationRequestModel } from '../models/OrderCancellationRequest';
import { getOrderTransitionError, isValidOrderTransition, OrderStatus } from '../../src/utils/ecommerceRules';
import { isDbConnected, isProduction, requirePersistentStorage } from '../db';
import { UserRole } from '../models/User';
import { createAdminNotification } from '../services/adminNotificationService';

const router = Router();
const inMemoryCancellationRequests: any[] = [];

const ORDER_STAFF_ROLES: UserRole[] = [
  'admin',
  'super_admin',
  'order_manager',
  'inventory_manager',
  'customer_support',
  'finance',
];

function matchOrderNumber(candidate: string, target: string): boolean {
  const a = (candidate || '').trim().replace(/^#/, '');
  const b = (target || '').trim().replace(/^#/, '');
  return Boolean(a && b && a === b);
}

// Customer: Get my orders
router.get('/my-orders', requireAuth, async (req: Request, res: Response) => {
  try {
    if (req.user!.role !== 'customer') {
      res.status(403).json({ success: false, error: 'Customer order history is available only to customer accounts.' });
      return;
    }
    if (!requirePersistentStorage(res, 'Order history')) {
      return;
    }

    const userId = req.user!.userId;
    const userEmail = (req.user!.email || '').toLowerCase();

    if (isDbConnected()) {
      const orders = await OrderModel.find({
        $or: [{ customerId: userId }, ...(userEmail ? [{ customerEmail: userEmail }] : [])],
      }).sort({ createdAt: -1 });
      res.json({ success: true, data: orders });
      return;
    }

    const myOrders = inMemoryOrders.filter(
      (o) => o.customerId === userId || (userEmail && (o.customerEmail || '').toLowerCase() === userEmail)
    );
    res.json({ success: true, data: myOrders });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Single order details
router.get('/:orderNumber', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!requirePersistentStorage(res, 'Order lookup')) {
      return;
    }

    const { orderNumber } = req.params;
    const user = req.user!;

    let order: any = null;
    if (isDbConnected()) {
      const clean = orderNumber.trim().replace(/^#/, '');
      order = await OrderModel.findOne({
        $or: [{ orderNumber }, { orderNumber: clean }, { orderNumber: `#${clean}` }],
      });
    }
    if (!order && !isDbConnected()) {
      order = inMemoryOrders.find((o) => matchOrderNumber(o.orderNumber, orderNumber) || o.id === orderNumber);
    }

    if (!order) {
      res.status(404).json({ success: false, error: 'Order not found' });
      return;
    }

    const isStaff = ORDER_STAFF_ROLES.includes(user.role);
    const isOwner =
      order.customerId === user.userId ||
      (user.email && (order.customerEmail || '').toLowerCase() === user.email.toLowerCase());

    if (!isOwner && !isStaff) {
      res.status(403).json({ success: false, error: 'Access denied to this order' });
      return;
    }

    res.json({ success: true, data: order });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Record COD only after delivery and actual cash collection.
router.post(
  '/admin/:orderNumber/cod-collection',
  requireAuth,
  requireRole(['admin', 'super_admin', 'order_manager', 'finance']),
  async (req: Request, res: Response) => {
    try {
      if (!requirePersistentStorage(res, 'COD collection recording')) {
        return;
      }

      const { orderNumber } = req.params;
      const clean = orderNumber.trim().replace(/^#/, '');
      const user = req.user!;
      let dbOrder: any = null;
      if (isDbConnected()) {
        dbOrder = await OrderModel.findOne({
          $or: [{ orderNumber: orderNumber.trim() }, { orderNumber: clean }, { orderNumber: `#${clean}` }],
        });
      }
      const memOrder = inMemoryOrders.find((o) => matchOrderNumber(o.orderNumber, orderNumber));
      const order = dbOrder || memOrder;

      if (!order) {
        res.status(404).json({ success: false, error: 'Order not found' });
        return;
      }
      if (order.paymentMethod !== 'cod') {
        res.status(400).json({ success: false, error: 'COD collection can only be recorded for COD orders.' });
        return;
      }
      if (order.status !== 'delivered') {
        res.status(409).json({ success: false, error: 'COD can only be collected after the order is delivered.' });
        return;
      }
      if (order.codCollectedAt && order.paymentStatus === 'paid') {
        res.json({ success: true, alreadyCollected: true, order, message: 'COD collection was already recorded.' });
        return;
      }
      if (order.paymentStatus !== 'unpaid' && order.paymentStatus !== 'paid') {
        res.status(409).json({ success: false, error: 'Order is not awaiting COD collection.' });
        return;
      }

      const collectedAt = new Date();
      const actor = `${user.name} (${user.role})`;
      const timelineEntry = {
        status: 'delivered' as OrderStatus,
        timestamp: collectedAt,
        actor,
        note: `COD payment of BDT ${Number(order.finalTotal).toFixed(2)} collected and recorded.`,
      };

      if (dbOrder) {
        const updatedOrder = await OrderModel.findOneAndUpdate(
          {
            _id: dbOrder._id,
            paymentMethod: 'cod',
            paymentStatus: { $in: ['unpaid', 'paid'] },
            status: 'delivered',
            codCollectedAt: { $exists: false },
          },
          {
            $set: {
              paymentStatus: 'paid',
              paymentPaidAt: collectedAt,
              codCollectedAt: collectedAt,
              codCollectedBy: actor,
            },
            $push: { statusTimeline: timelineEntry },
          },
          { returnDocument: 'after' }
        );
        if (!updatedOrder) {
          res.status(409).json({ success: false, error: 'COD collection was recorded by another request.' });
          return;
        }
        res.json({ success: true, order: updatedOrder, message: 'COD collection recorded successfully.' });
        return;
      }

      memOrder.paymentStatus = 'paid';
      memOrder.paymentPaidAt = collectedAt;
      memOrder.codCollectedAt = collectedAt;
      memOrder.codCollectedBy = actor;
      if (!memOrder.statusTimeline) memOrder.statusTimeline = [];
      memOrder.statusTimeline.push(timelineEntry);
      memOrder.updatedAt = collectedAt;
      res.json({ success: true, order: memOrder, message: 'COD collection recorded successfully.' });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || 'Failed to record COD collection' });
    }
  }
);

router.get('/admin/cancellation-requests/pending-count', requireAuth, requireRole(ORDER_STAFF_ROLES), async (_req: Request, res: Response) => {
  try {
    if (!requirePersistentStorage(res, 'Pending cancellation count')) {
      return;
    }

    let pendingCount = 0;
    if (isDbConnected()) {
      pendingCount = await OrderCancellationRequestModel.countDocuments({ status: 'pending_approval' });
    } else {
      pendingCount = inMemoryCancellationRequests.filter((request) => request.status === 'pending_approval').length;
    }

    res.json({
      success: true,
      data: { pendingCount: Math.max(0, pendingCount) },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to load pending cancellation count.' });
  }
});

router.get('/admin/cancellation-requests', requireAuth, requireRole(ORDER_STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    if (!requirePersistentStorage(res, 'Cancellation request review')) {
      return;
    }

    const { status, search } = req.query;
    const normalizedStatus = typeof status === 'string' ? status : 'all';
    const searchQuery = typeof search === 'string' ? search.trim() : '';

    let requests: any[] = [];
    if (isDbConnected()) {
      const filter: any = {};
      if (normalizedStatus !== 'all') {
        filter.status = normalizedStatus;
      }
      if (searchQuery) {
        filter.$or = [
          { orderNumber: { $regex: searchQuery, $options: 'i' } },
          { customerEmail: { $regex: searchQuery, $options: 'i' } },
          { reason: { $regex: searchQuery, $options: 'i' } },
        ];
      }
      requests = await OrderCancellationRequestModel.find(filter).sort({ requestedAt: -1 }).lean();
    } else {
      requests = [...inMemoryCancellationRequests].filter((request) => {
        if (normalizedStatus !== 'all' && request.status !== normalizedStatus) return false;
        if (!searchQuery) return true;
        const haystack = [
          request.orderNumber,
          request.customerEmail,
          request.reason,
          request.detail,
          request.status,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(searchQuery.toLowerCase());
      });
      requests.sort(
        (a, b) =>
          Number(new Date(b.requestedAt || b.createdAt || 0)) -
          Number(new Date(a.requestedAt || a.createdAt || 0))
      );
    }

    res.json({ success: true, data: requests, total: requests.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to list cancellation requests.' });
  }
});

router.post('/admin/cancellation-requests/:requestId/approve', requireAuth, requireRole(ORDER_STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    if (!requirePersistentStorage(res, 'Cancellation approval')) {
      return;
    }

    const { requestId } = req.params;
    const { reason } = req.body;
    const user = req.user!;
    const decisionReason = typeof reason === 'string' ? reason.trim() : 'Approved by admin review';

    let requestDoc: any = null;
    if (isDbConnected()) {
      requestDoc = await OrderCancellationRequestModel.findById(requestId).lean();
    } else {
      requestDoc = inMemoryCancellationRequests.find((entry) => String(entry._id || entry.id) === requestId);
    }

    if (!requestDoc) {
      res.status(404).json({ success: false, error: 'Cancellation request not found.' });
      return;
    }

    if (requestDoc.status !== 'pending_approval') {
      res.status(409).json({ success: false, error: 'This cancellation request is no longer pending approval.' });
      return;
    }

    const orderLookup = requestDoc.orderId || requestDoc.orderNumber;
    let dbOrder: any = null;
    if (isDbConnected()) {
      dbOrder = await OrderModel.findOne({
        $or: [{ _id: orderLookup }, { orderNumber: requestDoc.orderNumber }, { orderNumber: `#${requestDoc.orderNumber}` }],
      });
    }

    const memOrder =
      inMemoryOrders.find((o) => matchOrderNumber(o.orderNumber, requestDoc.orderNumber) || o.id === orderLookup) ||
      inMemoryOrders.find((o) => o.orderNumber === requestDoc.orderNumber || o.id === orderLookup);
    const targetOrder = dbOrder || memOrder;
    if (!targetOrder) {
      res.status(404).json({ success: false, error: 'Associated order no longer exists.' });
      return;
    }

    if (targetOrder.status !== 'pending' && targetOrder.status !== 'confirmed') {
      res.status(409).json({
        success: false,
        error: `Order is no longer eligible for cancellation. Current status: ${targetOrder.status}.`,
      });
      return;
    }

    const actor = `${user.name} (${user.role})`;
    const approvedAt = new Date();
    const timelineEntry = {
      status: 'cancelled' as OrderStatus,
      timestamp: approvedAt,
      actor,
      note: `Cancellation approved: ${decisionReason}`,
    };

    if (isDbConnected() && dbOrder) {
      const updatedOrder = await OrderModel.findOneAndUpdate(
        {
          _id: dbOrder._id,
          status: { $in: ['pending', 'confirmed'] },
          cancellationRequestStatus: { $in: ['none', 'pending_approval'] },
        },
        {
          $set: {
            status: 'cancelled',
            cancellationReason: requestDoc.reason || 'Approved by admin review',
            cancellationRequestStatus: 'approved',
            cancellationRequestId: requestDoc._id ? String(requestDoc._id) : requestId,
            cancellationReviewedAt: approvedAt,
            cancellationReviewedBy: actor,
            cancellationDecisionReason: decisionReason,
            stockRestored: false,
          },
          $push: { statusTimeline: timelineEntry },
        },
        { returnDocument: 'after' }
      );

      if (!updatedOrder) {
        res.status(409).json({ success: false, error: 'This order was already changed by another admin.' });
        return;
      }

      await OrderCancellationRequestModel.findByIdAndUpdate(requestId, {
        status: 'approved',
        reviewedAt: approvedAt,
        reviewedBy: actor,
        reviewReason: decisionReason,
      });

      const stockRestored = await restoreOrderStock(updatedOrder);
      if (!stockRestored && !updatedOrder.stockRestored) {
        res.status(409).json({ success: false, error: 'Inventory restoration is already in progress. Please retry shortly.' });
        return;
      }

      res.json({
        success: true,
        message: 'Cancellation approved and order cancelled.',
        order: updatedOrder,
      });
      return;
    }

    if (memOrder) {
      memOrder.status = 'cancelled';
      memOrder.cancellationReason = requestDoc.reason || 'Approved by admin review';
      memOrder.cancellationRequestStatus = 'approved';
      memOrder.cancellationRequestId = String(requestDoc._id || requestId);
      memOrder.cancellationReviewedAt = approvedAt;
      memOrder.cancellationReviewedBy = actor;
      memOrder.cancellationDecisionReason = decisionReason;
      memOrder.stockRestored = false;
      if (!memOrder.statusTimeline) memOrder.statusTimeline = [];
      memOrder.statusTimeline.push(timelineEntry);
      memOrder.updatedAt = approvedAt;
    }

    const index = inMemoryCancellationRequests.findIndex((entry) => String(entry._id || entry.id) === requestId);
    if (index >= 0) {
      inMemoryCancellationRequests[index] = {
        ...inMemoryCancellationRequests[index],
        status: 'approved',
        reviewedAt: approvedAt,
        reviewedBy: actor,
        reviewReason: decisionReason,
      };
    }

    const stockRestored = await restoreOrderStock(targetOrder);
    if (!stockRestored && !targetOrder.stockRestored) {
      res.status(409).json({ success: false, error: 'Inventory restoration is already in progress. Please retry shortly.' });
      return;
    }

    res.json({
      success: true,
      message: 'Cancellation approved and order cancelled.',
      order: targetOrder,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to approve cancellation request.' });
  }
});

router.post('/admin/cancellation-requests/:requestId/reject', requireAuth, requireRole(ORDER_STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    if (!requirePersistentStorage(res, 'Cancellation rejection')) {
      return;
    }

    const { requestId } = req.params;
    const { reason } = req.body;
    const user = req.user!;
    const rejectionReason = typeof reason === 'string' ? reason.trim() : 'Rejected by admin review';

    let requestDoc: any = null;
    if (isDbConnected()) {
      requestDoc = await OrderCancellationRequestModel.findById(requestId).lean();
    } else {
      requestDoc = inMemoryCancellationRequests.find((entry) => String(entry._id || entry.id) === requestId);
    }

    if (!requestDoc) {
      res.status(404).json({ success: false, error: 'Cancellation request not found.' });
      return;
    }

    if (requestDoc.status !== 'pending_approval') {
      res.status(409).json({ success: false, error: 'This cancellation request is no longer pending approval.' });
      return;
    }

    const actor = `${user.name} (${user.role})`;
    const reviewedAt = new Date();
    const orderLookup = requestDoc.orderId || requestDoc.orderNumber;
    let dbOrder: any = null;
    if (isDbConnected()) {
      dbOrder = await OrderModel.findOne({
        $or: [{ _id: orderLookup }, { orderNumber: requestDoc.orderNumber }, { orderNumber: `#${requestDoc.orderNumber}` }],
      });
    }

    const memOrder =
      inMemoryOrders.find((o) => matchOrderNumber(o.orderNumber, requestDoc.orderNumber) || o.id === orderLookup) ||
      inMemoryOrders.find((o) => o.orderNumber === requestDoc.orderNumber || o.id === orderLookup);
    const targetOrder = dbOrder || memOrder;

    if (isDbConnected() && dbOrder) {
      await OrderModel.findOneAndUpdate(
        { _id: dbOrder._id, cancellationRequestStatus: { $in: ['none', 'pending_approval'] } },
        {
          $set: {
            cancellationRequestStatus: 'rejected',
            cancellationReviewedAt: reviewedAt,
            cancellationReviewedBy: actor,
            cancellationDecisionReason: rejectionReason,
          },
        }
      );
      await OrderCancellationRequestModel.findByIdAndUpdate(requestId, {
        status: 'rejected',
        reviewedAt,
        reviewedBy: actor,
        reviewReason: rejectionReason,
      });
    }

    if (targetOrder) {
      targetOrder.cancellationRequestStatus = 'rejected';
      targetOrder.cancellationReviewedAt = reviewedAt;
      targetOrder.cancellationReviewedBy = actor;
      targetOrder.cancellationDecisionReason = rejectionReason;
      targetOrder.updatedAt = reviewedAt;
    }

    const index = inMemoryCancellationRequests.findIndex((entry) => String(entry._id || entry.id) === requestId);
    if (index >= 0) {
      inMemoryCancellationRequests[index] = {
        ...inMemoryCancellationRequests[index],
        status: 'rejected',
        reviewedAt,
        reviewedBy: actor,
        reviewReason: rejectionReason,
      };
    }

    res.json({
      success: true,
      message: 'Cancellation request rejected and the order remains unchanged.',
      order: targetOrder,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to reject cancellation request.' });
  }
});

// Customer: Submit a cancellation request without finalizing the order immediately
router.post('/:orderNumber/cancel', requireAuth, async (req: Request, res: Response) => {
  try {
    const { orderNumber } = req.params;
    const { reason, detail } = req.body;
    const user = req.user!;
    const clean = orderNumber.trim().replace(/^#/, '');

    const memOrder = inMemoryOrders.find((o) => matchOrderNumber(o.orderNumber, orderNumber) || o.id === orderNumber);
    let dbOrder: any = null;
    if (isDbConnected()) {
      dbOrder = await OrderModel.findOne({
        $or: [{ orderNumber }, { orderNumber: clean }, { orderNumber: `#${clean}` }],
      });
    }

    const targetOrder = dbOrder || memOrder;
    if (!targetOrder) {
      res.status(404).json({ success: false, error: 'Order not found' });
      return;
    }

    const isOwner =
      targetOrder.customerId === user.userId ||
      (user.email && (targetOrder.customerEmail || '').toLowerCase() === user.email.toLowerCase());
    const isStaff = ['admin', 'super_admin', 'order_manager', 'customer_support'].includes(user.role);

    if (!isOwner && !isStaff) {
      res.status(403).json({ success: false, error: 'Access denied' });
      return;
    }

    if (targetOrder.status !== 'pending' && targetOrder.status !== 'confirmed') {
      res.status(400).json({
        success: false,
        error: `Cannot request cancellation for order in "${targetOrder.status}" status. Only pending or confirmed orders can be cancelled by request.`,
      });
      return;
    }

    if (targetOrder.cancellationRequestStatus === 'pending_approval' || targetOrder.cancellationRequestStatus === 'approved') {
      res.status(409).json({
        success: false,
        error: 'A cancellation request is already pending approval or the order is already cancelled.',
      });
      return;
    }

    const cancelReason = typeof reason === 'string' ? reason.trim() : '';
    if (!cancelReason) {
      res.status(400).json({ success: false, error: 'Cancellation reason is required.' });
      return;
    }

    const requestId = isDbConnected() ? undefined : `cancel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date();
    const requestRecord = {
      _id: requestId,
      orderId: targetOrder._id ? String(targetOrder._id) : targetOrder.id || targetOrder.orderNumber,
      orderNumber: targetOrder.orderNumber,
      customerId: targetOrder.customerId || user.userId,
      customerEmail: targetOrder.customerEmail || user.email || '',
      status: 'pending_approval',
      reason: cancelReason,
      detail: typeof detail === 'string' ? detail.trim() : '',
      requestedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    if (isDbConnected()) {
      const createdRequest = await OrderCancellationRequestModel.create({
        orderId: requestRecord.orderId,
        orderNumber: targetOrder.orderNumber,
        customerId: requestRecord.customerId,
        customerEmail: requestRecord.customerEmail,
        status: 'pending_approval',
        reason: cancelReason,
        detail: requestRecord.detail,
        requestedAt: now,
      });

      await OrderModel.findOneAndUpdate(
        { _id: targetOrder._id },
        {
          $set: {
            cancellationRequestStatus: 'pending_approval',
            cancellationRequestId: String(createdRequest._id),
            cancellationRequestedAt: now,
            cancellationReason: cancelReason,
          },
        }
      );

      targetOrder.cancellationRequestStatus = 'pending_approval';
      targetOrder.cancellationRequestId = String(createdRequest._id);
      targetOrder.cancellationRequestedAt = now;
      targetOrder.cancellationReason = cancelReason;

      try {
        await createAdminNotification({
          eventKey: `cancellation:${createdRequest._id}`,
          title: 'New cancellation request',
          description: `Cancellation requested for order ${targetOrder.orderNumber}.`,
          module: 'cancellation-requests',
          referenceId: String(createdRequest._id),
        });
      } catch (error) {
        console.error(`[Orders] Admin notification could not be persisted for cancellation ${createdRequest._id}:`, error);
      }

      res.json({
        success: true,
        message: 'Cancellation request submitted and is awaiting admin approval.',
        requestId: String(createdRequest._id),
        order: targetOrder,
      });
      return;
    }

    inMemoryCancellationRequests.push({ ...requestRecord, id: requestId });
    targetOrder.cancellationRequestStatus = 'pending_approval';
    targetOrder.cancellationRequestId = requestId;
    targetOrder.cancellationRequestedAt = now;
    targetOrder.cancellationReason = cancelReason;
    targetOrder.updatedAt = now;

    try {
      await createAdminNotification({
        eventKey: `cancellation:${requestId}`,
        title: 'New cancellation request',
        description: `Cancellation requested for order ${targetOrder.orderNumber}.`,
        module: 'cancellation-requests',
        referenceId: requestId,
      });
    } catch (error) {
      console.error(`[Orders] Admin notification could not be persisted for cancellation ${requestId}:`, error);
    }

    res.json({
      success: true,
      message: 'Cancellation request submitted and is awaiting admin approval.',
      requestId,
      order: targetOrder,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to create cancellation request.' });
  }
});

// Customer can withdraw a pending cancellation request before admin approval
router.post('/:orderNumber/cancel/withdraw', requireAuth, async (req: Request, res: Response) => {
  try {
    const { orderNumber } = req.params;
    const user = req.user!;
    const clean = orderNumber.trim().replace(/^#/, '');

    let dbOrder: any = null;
    if (isDbConnected()) {
      dbOrder = await OrderModel.findOne({
        $or: [{ orderNumber }, { orderNumber: clean }, { orderNumber: `#${clean}` }],
      });
    }

    const memOrder = inMemoryOrders.find((o) => matchOrderNumber(o.orderNumber, orderNumber) || o.id === orderNumber);
    const targetOrder = dbOrder || memOrder;
    if (!targetOrder) {
      res.status(404).json({ success: false, error: 'Order not found' });
      return;
    }

    const isOwner =
      targetOrder.customerId === user.userId ||
      (user.email && (targetOrder.customerEmail || '').toLowerCase() === user.email.toLowerCase());
    if (!isOwner) {
      res.status(403).json({ success: false, error: 'Access denied' });
      return;
    }

    const requestId = targetOrder.cancellationRequestId || (isDbConnected() ? null : null);
    if (!targetOrder.cancellationRequestStatus || targetOrder.cancellationRequestStatus !== 'pending_approval') {
      res.status(409).json({ success: false, error: 'There is no pending cancellation request to withdraw.' });
      return;
    }

    if (isDbConnected()) {
      const request = await OrderCancellationRequestModel.findOne({
        orderId: targetOrder._id ? String(targetOrder._id) : targetOrder.id,
        status: 'pending_approval',
      });
      if (!request) {
        res.status(404).json({ success: false, error: 'Cancellation request not found.' });
        return;
      }
      await OrderCancellationRequestModel.findByIdAndUpdate(request._id, { status: 'withdrawn' });
      await OrderModel.findOneAndUpdate(
        { _id: targetOrder._id },
        {
          $set: {
            cancellationRequestStatus: 'withdrawn',
            cancellationReviewedAt: new Date(),
            cancellationDecisionReason: 'Customer withdrew the cancellation request.',
          },
        }
      );
    } else {
      const requestIndex = inMemoryCancellationRequests.findIndex(
        (entry) => (entry.orderId === (targetOrder._id ? String(targetOrder._id) : targetOrder.id) || entry.orderNumber === targetOrder.orderNumber) && entry.status === 'pending_approval'
      );
      if (requestIndex >= 0) {
        inMemoryCancellationRequests[requestIndex].status = 'withdrawn';
      }
    }

    targetOrder.cancellationRequestStatus = 'withdrawn';
    targetOrder.cancellationDecisionReason = 'Customer withdrew the cancellation request.';
    targetOrder.updatedAt = new Date();

    res.json({ success: true, message: 'Cancellation request withdrawn.', order: targetOrder });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to withdraw cancellation request.' });
  }
});

// Admin: List all orders
router.get('/admin/list', requireAuth, requireRole(ORDER_STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    if (!requirePersistentStorage(res, 'Admin order list')) {
      return;
    }

    const { status, search } = req.query;

    let orders: any[] = [];

    if (isDbConnected()) {
      try {
        const query: any = {};
        if (status && status !== 'all') query.status = status;
        const dbOrders = await OrderModel.find(query).sort({ createdAt: -1 });
        if (dbOrders.length > 0) {
          orders = dbOrders.map((o) => ({
            id: o._id.toString(),
            orderNumber: o.orderNumber,
            customerId: o.customerId,
            customerName: o.customerName,
            customerEmail: o.customerEmail,
            customerPhone: o.customerPhone,
            items: o.items,
            subtotal: o.subtotal,
            discount: o.discount,
            couponCode: o.couponCode,
            shippingFee: o.shippingFee,
            tax: o.tax,
            finalTotal: o.finalTotal,
            shippingAddress: o.shippingAddress,
            paymentMethod: o.paymentMethod,
            paymentStatus: o.paymentStatus,
            paymentTransactionId: o.paymentTransactionId,
            paymentPaidAt: o.paymentPaidAt,
            codCollectedAt: o.codCollectedAt,
            codCollectedBy: o.codCollectedBy,
            status: o.status,
            statusTimeline: o.statusTimeline,
            stockRestored: o.stockRestored,
            createdAt: o.createdAt,
            updatedAt: o.updatedAt,
          }));
        }
      } catch (dbErr) {
        console.error('Persistent order list failed:', dbErr);
        res.status(503).json({ success: false, error: 'Persistent order data is temporarily unavailable.' });
        return;
      }
    }

    if (!isDbConnected()) {
      orders = [...inMemoryOrders];
      if (status && status !== 'all') {
        orders = orders.filter((o) => o.status === status);
      }
    }

    if (search) {
      const q = (search as string).toLowerCase();
      orders = orders.filter(
        (o) =>
          o.orderNumber.toLowerCase().includes(q) ||
          o.customerName.toLowerCase().includes(q) ||
          o.customerEmail.toLowerCase().includes(q)
      );
    }

    res.json({ success: true, data: orders, total: orders.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin: Update order status with state machine verification & automatic stock restoration on cancel/return
router.put(
  '/admin/:orderNumber/status',
  requireAuth,
  requireRole(['admin', 'super_admin', 'order_manager', 'customer_support', 'finance']),
  async (req: Request, res: Response) => {
    try {
      if (!requirePersistentStorage(res, 'Order status update')) {
        return;
      }
      const { orderNumber } = req.params;
      const { status: nextStatus, note } = req.body;
      const user = req.user!;

      const clean = orderNumber.trim().replace(/^#/, '');
      const memOrder = inMemoryOrders.find(
        (o) => matchOrderNumber(o.orderNumber, orderNumber) || o.id === orderNumber.trim()
      );

      let dbOrder: any = null;
      if (isDbConnected()) {
        dbOrder = await OrderModel.findOne({
          $or: [
            { orderNumber: orderNumber.trim() },
            { orderNumber: clean },
            { orderNumber: `#${clean}` },
          ],
        });
      }

      const targetOrder = dbOrder || memOrder;
      if (!targetOrder) {
        res.status(404).json({ success: false, error: 'Order not found' });
        return;
      }

      const currentStatus = targetOrder.status as OrderStatus;
      if (!isValidOrderTransition(currentStatus, nextStatus as OrderStatus)) {
        res.status(400).json({
          success: false,
          error: getOrderTransitionError(currentStatus, nextStatus as OrderStatus),
        });
        return;
      }

      const timelineEntry = {
        status: nextStatus as OrderStatus,
        timestamp: new Date(),
        actor: `${user.name} (${user.role})`,
        note: note || `Updated to ${nextStatus}`,
      };

      // Restore stock idempotently when transitioning to cancelled or returned
      if (nextStatus === 'cancelled' || nextStatus === 'returned') {
        const stockWasRestored = await restoreOrderStock(targetOrder);
        if (!stockWasRestored && !targetOrder.stockRestored) {
          res.status(409).json({ success: false, error: 'Order stock restoration is already in progress. Please retry shortly.' });
          return;
        }
      }

      let updatedPaymentStatus = targetOrder.paymentStatus;

      if (memOrder) {
        memOrder.status = nextStatus;
        memOrder.paymentStatus = updatedPaymentStatus;
        if (targetOrder.stockRestored) memOrder.stockRestored = true;
        if (!memOrder.statusTimeline) memOrder.statusTimeline = [];
        memOrder.statusTimeline.push(timelineEntry);
        memOrder.updatedAt = new Date();
      }

      if (dbOrder) {
        dbOrder.status = nextStatus;
        dbOrder.paymentStatus = updatedPaymentStatus;
        if (targetOrder.stockRestored) dbOrder.stockRestored = true;
        dbOrder.statusTimeline.push(timelineEntry);
        await dbOrder.save();
      }

      res.json({
        success: true,
        order: dbOrder || memOrder,
        message: `Status updated to ${nextStatus}`,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

export default router;
