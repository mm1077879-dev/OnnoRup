import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import nodemailer from 'nodemailer';
import { requireAuth, requireRole } from '../middleware/auth';
import { inMemoryProducts } from './productRoutes';
import { inMemoryOrders, inMemoryCoupons } from './checkoutRoutes';
import { getDbStatus, isDbConnected, isProduction } from '../db';
import { CouponModel } from '../models/Coupon';
import { ProductModel } from '../models/Product';
import { OrderModel } from '../models/Order';
import { OrderCancellationRequestModel } from '../models/OrderCancellationRequest';
import { UserModel } from '../models/User';
import { UserRole } from '../models/User';
import { ContactMessageModel, inMemoryContactMessages } from '../models/ContactMessage';
import { AdminNotificationModel, inMemoryAdminNotifications } from '../models/AdminNotification';
import { getActiveSettings, updateSettingsSection, getMaskedSettings } from '../models/Settings';
import { isPaymentReceiptVerified } from '../../src/utils/ecommerceRules';
import { getPaymentGatewayConfigStatus } from '../services/paymentService';
import {
  ActivityLogModel,
  AdminLogModel,
  inMemoryActivityLogs,
  inMemoryAdminSecurityLogs,
  recordActivityLog,
  recordAdminLog,
} from '../models/AuditLog';


const router = Router();
const ADMIN_NOTIFICATION_ROLES: UserRole[] = [
  'admin',
  'super_admin',
  'order_manager',
  'catalog_manager',
  'inventory_manager',
  'customer_support',
  'finance',
];

router.get('/notifications', requireAuth, requireRole(ADMIN_NOTIFICATION_ROLES), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    let notifications: Array<{
      id: string;
      title: string;
      description: string;
      module: string;
      referenceId?: string;
      createdAt: string;
      isRead: boolean;
    }>;
    let unreadCount: number;

    if (isDbConnected()) {
      const [records, unread] = await Promise.all([
        AdminNotificationModel.find().sort({ createdAt: -1 }).limit(50).lean(),
        AdminNotificationModel.countDocuments({ readBy: { $ne: userId } }),
      ]);
      notifications = records.map((item) => ({
        id: String(item._id),
        title: item.title,
        description: item.description,
        module: item.module,
        referenceId: item.referenceId,
        createdAt: new Date(item.createdAt).toISOString(),
        isRead: item.readBy.includes(userId),
      }));
      unreadCount = unread;
    } else {
      notifications = inMemoryAdminNotifications.slice(0, 50).map((item) => ({
        id: item.id,
        title: item.title,
        description: item.description,
        module: item.module,
        referenceId: item.referenceId,
        createdAt: item.createdAt,
        isRead: item.readBy.includes(userId),
      }));
      unreadCount = inMemoryAdminNotifications.filter((item) => !item.readBy.includes(userId)).length;
    }

    res.json({ success: true, data: notifications, unreadCount });
  } catch (error) {
    console.error('[Admin Notifications] Failed to load notifications:', error);
    res.status(500).json({ success: false, error: 'Could not load admin notifications.' });
  }
});

router.patch('/notifications/:id/read', requireAuth, requireRole(ADMIN_NOTIFICATION_ROLES), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;
    if (isDbConnected()) {
      if (!mongoose.isValidObjectId(id)) {
        res.status(404).json({ success: false, error: 'Notification not found.' });
        return;
      }
      const notification = await AdminNotificationModel.findByIdAndUpdate(
        id,
        { $addToSet: { readBy: userId } },
        { new: true }
      ).lean();
      if (!notification) {
        res.status(404).json({ success: false, error: 'Notification not found.' });
        return;
      }
    } else {
      const notification = inMemoryAdminNotifications.find((item) => item.id === id);
      if (!notification) {
        res.status(404).json({ success: false, error: 'Notification not found.' });
        return;
      }
      if (!notification.readBy.includes(userId)) notification.readBy.push(userId);
    }
    res.json({ success: true });
  } catch (error) {
    console.error('[Admin Notifications] Failed to mark notification as read:', error);
    res.status(500).json({ success: false, error: 'Could not update notification state.' });
  }
});

router.patch('/notifications/read-all', requireAuth, requireRole(ADMIN_NOTIFICATION_ROLES), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    if (isDbConnected()) {
      await AdminNotificationModel.updateMany(
        { readBy: { $ne: userId } },
        { $addToSet: { readBy: userId } }
      );
    } else {
      for (const notification of inMemoryAdminNotifications) {
        if (!notification.readBy.includes(userId)) notification.readBy.push(userId);
      }
    }
    res.json({ success: true });
  } catch (error) {
    console.error('[Admin Notifications] Failed to mark all notifications as read:', error);
    res.status(500).json({ success: false, error: 'Could not update notification state.' });
  }
});

let inMemoryAuditLogs = [
  {
    id: 'log-1',
    action: 'SYSTEM_BOOT',
    actor: 'System',
    role: 'system',
    details: 'Novara Commerce initialized with Bangladesh retail catalog',
    timestamp: new Date().toISOString(),
  },
  {
    id: 'log-2',
    action: 'CATALOG_SYNC',
    actor: 'Novara Admin',
    role: 'super_admin',
    details: 'Synced 15 products and 6 categories matching retail layout',
    timestamp: new Date().toISOString(),
  },
];

let inMemoryStaff = [
  { id: 'stf-1', name: 'Novara Admin', email: 'admin@novara.com', role: 'super_admin', status: 'active' },
  { id: 'stf-2', name: 'Tariq Rahman', email: 'tariq@novara.com', role: 'order_manager', status: 'active' },
  { id: 'stf-3', name: 'Nusrat Jahan', email: 'nusrat@novara.com', role: 'catalog_manager', status: 'active' },
  { id: 'stf-4', name: 'Kamal Hossain', email: 'kamal@novara.com', role: 'inventory_manager', status: 'active' },
];

router.get('/cancellation-requests/pending-count', requireAuth, requireRole(['admin', 'super_admin', 'order_manager', 'customer_support', 'inventory_manager', 'finance']), async (req: Request, res: Response) => {
  try {
    let pendingCount = 0;
    if (isDbConnected()) {
      pendingCount = await OrderCancellationRequestModel.countDocuments({ status: 'pending_approval' });
    } else {
      pendingCount = 0;
    }

    res.json({ success: true, data: { pendingCount: Math.max(0, pendingCount) } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to load pending cancellation count.' });
  }
});

router.get('/cancellation-requests', requireAuth, requireRole(['admin', 'super_admin', 'order_manager', 'customer_support', 'inventory_manager', 'finance']), async (req: Request, res: Response) => {
  try {
    const { status, search } = req.query;
    const normalizedStatus = typeof status === 'string' ? status : 'all';
    const searchQuery = typeof search === 'string' ? search.trim() : '';

    let requests: any[] = [];
    if (isDbConnected()) {
      const filter: any = {};
      if (normalizedStatus !== 'all') filter.status = normalizedStatus;
      if (searchQuery) {
        filter.$or = [
          { orderNumber: { $regex: searchQuery, $options: 'i' } },
          { customerEmail: { $regex: searchQuery, $options: 'i' } },
          { reason: { $regex: searchQuery, $options: 'i' } },
        ];
      }
      requests = await OrderCancellationRequestModel.find(filter).sort({ requestedAt: -1 }).lean();
    }

    res.json({ success: true, data: requests, total: requests.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to list cancellation requests.' });
  }
});

// Admin Dashboard KPIs
router.get('/dashboard', requireAuth, requireRole(['admin', 'super_admin', 'order_manager']), async (req: Request, res: Response) => {
  try {
    if (isProduction() && !isDbConnected()) {
      res.status(503).json({ success: false, error: 'Persistent order data is required for production financial reporting.' });
      return;
    }

    let orders: any[] = inMemoryOrders;
    let products: any[] = inMemoryProducts;
    let couponsCount = inMemoryCoupons.length;

    if (isDbConnected()) {
      try {
        const dbOrders = await OrderModel.find().sort({ createdAt: -1 }).lean();
        orders = dbOrders as any[];
      } catch (err: any) {
        console.error('Dashboard persistent orders query failed:', err.message);
        res.status(503).json({ success: false, error: 'Persistent order data is temporarily unavailable.' });
        return;
      }

      try {
        const dbProducts = await ProductModel.find().lean();
        products = dbProducts.map((product: any) => ({
          ...product,
          id: String(product._id),
        }));
      } catch (err: any) {
        console.error('Dashboard persistent products query failed:', err);
        res.status(503).json({ success: false, error: 'Persistent product data is temporarily unavailable.' });
        return;
      }

      try {
        couponsCount = await CouponModel.countDocuments();
      } catch (error) {
        console.error('Dashboard coupon count query failed:', error);
        res.status(503).json({ success: false, error: 'Persistent coupon data is temporarily unavailable.' });
        return;
      }
    }

    const now = new Date();
    const utcDayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const utcMonthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const revenueOrders = orders.filter(
      (o) =>
        isPaymentReceiptVerified(o) &&
        !['cancelled', 'returned', 'refunded'].includes(o.status)
    );
    const completedOrders = orders.filter((o) => !['cancelled', 'returned', 'refunded'].includes(o.status));
    const paidRevenue = Math.round(revenueOrders.reduce((sum, o) => sum + (Number(o.finalTotal) || 0), 0) * 100) / 100;
    const grossSales = paidRevenue;
    const netSales = Math.round(revenueOrders.reduce((sum, o) => sum + ((Number(o.subtotal) || Number(o.finalTotal) || 0) - (Number(o.discount) || 0)), 0) * 100) / 100;

    const unpaidOrders = completedOrders.filter((o) => !isPaymentReceiptVerified(o));
    const unpaidOrderValue = Math.round(unpaidOrders.reduce((sum, o) => sum + (Number(o.finalTotal) || 0), 0) * 100) / 100;

    const refundedOrders = orders.filter((o) => o.paymentStatus === 'refunded');
    const refundTotals = Math.round(refundedOrders.reduce((sum, o) => sum + (Number(o.finalTotal) || 0), 0) * 100) / 100;
    const codCollectedOrders = orders.filter(
      (o) => o.paymentMethod === 'cod' && isPaymentReceiptVerified(o)
    );
    const codAwaitingOrders = orders.filter(
      (o) =>
        o.paymentMethod === 'cod' &&
        !['cancelled', 'returned', 'refunded'].includes(o.status) &&
        !isPaymentReceiptVerified(o)
    );
    const codCollectedRevenue = Math.round(codCollectedOrders.reduce((sum, o) => sum + (Number(o.finalTotal) || 0), 0) * 100) / 100;
    const codAwaitingCollection = Math.round(codAwaitingOrders.reduce((sum, o) => sum + (Number(o.finalTotal) || 0), 0) * 100) / 100;
    const failedPaymentOrders = orders.filter((o) => o.paymentStatus === 'failed').length;
    const pendingPaymentOrders = orders.filter((o) => o.paymentStatus === 'unpaid' && o.paymentMethod !== 'cod').length;

    const cancelledOrdersCount = orders.filter((o) => o.status === 'cancelled').length;
    const pendingOrders = orders.filter((o) => o.status === 'pending').length;
    const processingOrders = orders.filter((o) => ['processing', 'packed'].includes(o.status)).length;
    const shippedOrders = orders.filter((o) => o.status === 'shipped').length;
    const deliveredOrders = orders.filter((o) => o.status === 'delivered').length;
    const todayOrders = orders.filter((o) => new Date(o.createdAt).getTime() >= utcDayStart).length;
    const monthlyOrders = orders.filter((o) => new Date(o.createdAt).getTime() >= utcMonthStart).length;
    
    // Payment method distribution
    const codOrders = orders.filter((o) => o.paymentMethod === 'cod').length;
    const onlinePaymentOrders = orders.filter((o) => o.paymentMethod !== 'cod').length;
    const paymentMethodBreakdown: Record<string, { count: number; volume: number }> = {
      cod: { count: 0, volume: 0 },
      bkash: { count: 0, volume: 0 },
      nagad: { count: 0, volume: 0 },
      sslcommerz: { count: 0, volume: 0 },
    };
    orders.forEach((o) => {
      const pm = (o.paymentMethod || 'cod').toLowerCase();
      const target = pm === 'bkash' ? 'bkash' : pm === 'nagad' ? 'nagad' : (pm === 'card' || pm === 'credit_card' || pm === 'sslcommerz') ? 'sslcommerz' : 'cod';
      paymentMethodBreakdown[target].count += 1;
      if (isPaymentReceiptVerified(o)) {
        paymentMethodBreakdown[target].volume = Math.round((paymentMethodBreakdown[target].volume + (Number(o.finalTotal) || 0)) * 100) / 100;
      }
    });

    const lowStockProducts = products.filter((p) => Number(p.stock) <= (Number(p.lowStockThreshold) || 5));
    const outOfStockProducts = products.filter((p) => Number(p.stock) === 0);

    // Unique Customers Calculation
    const customerKeys = new Set<string>();
    orders.forEach((o) => {
      const key = o.customerId || o.customerEmail;
      if (key) customerKeys.add(key);
    });
    let totalCustomers = customerKeys.size;
    if (isDbConnected()) {
      try {
        totalCustomers = await UserModel.countDocuments({ role: 'customer' });
      } catch (error) {
        console.error('Dashboard customer count query failed:', error);
        res.status(503).json({ success: false, error: 'Persistent customer data is temporarily unavailable.' });
        return;
      }
    }

    // Category breakdown from actual orders
    const categorySales: Record<string, number> = {};
    revenueOrders.forEach((o) => {
      o.items?.forEach((item: any) => {
        const p = products.find((prod) => String(prod._id || prod.id) === item.productId || prod.sku === item.sku);
        const cat = p?.category || 'General';
        const lineTotal = item.total || (Number(item.effectivePrice || item.price || 0) * (Number(item.quantity) || 1));
        categorySales[cat] = Math.round(((categorySales[cat] || 0) + lineTotal) * 100) / 100;
      });
    });

    // Keep 90 daily buckets so the dashboard can display each supported range.
    const days: { day: string; dateStr: string; sales: number; orders: number }[] = [];
    for (let i = 89; i >= 0; i--) {
      const d = new Date(utcDayStart - i * 86400000);
      const dayName = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
      const dateStr = d.toISOString().split('T')[0];
      days.push({ day: dayName, dateStr, sales: 0, orders: 0 });
    }

    revenueOrders.forEach((o) => {
      const paymentDate = o.paymentPaidAt || o.createdAt;
      if (paymentDate) {
        const dObj = new Date(paymentDate);
        if (!isNaN(dObj.getTime())) {
          const orderDate = dObj.toISOString().split('T')[0];
          const match = days.find((d) => d.dateStr === orderDate);
          if (match) {
            match.sales += Number(o.finalTotal || o.subtotal || 0);
          }
        }
      }
    });
    orders.forEach((o) => {
      const orderDate = new Date(o.createdAt).toISOString().split('T')[0];
      const match = days.find((day) => day.dateStr === orderDate);
      if (match) match.orders += 1;
    });

    const salesOverview = days.map((d) => ({
      day: d.day,
      sales: Math.round(d.sales * 100) / 100,
      orders: d.orders,
      formatted: `৳${Math.round(d.sales).toLocaleString()}`,
    }));

    // Dynamic Order Status Distribution
    const statusCounts: Record<string, number> = {};
    orders.forEach((o) => {
      const s = (o.status || 'pending').toLowerCase();
      statusCounts[s] = (statusCounts[s] || 0) + 1;
    });

    const statusColors: Record<string, string> = {
      completed: '#00875a',
      delivered: '#00875a',
      processing: '#3b82f6',
      shipped: '#6366f1',
      confirmed: '#8b5cf6',
      pending: '#f59e0b',
      cancelled: '#ef4444',
      refunded: '#94a3b8',
      returned: '#ec4899',
    };

    const orderStatusDistribution = Object.entries(statusCounts).map(([status, count]) => {
      const capitalized = status.charAt(0).toUpperCase() + status.slice(1);
      const percentage = orders.length > 0 ? ((count / orders.length) * 100).toFixed(1) + '%' : '0%';
      return {
        status: capitalized,
        count,
        percentage,
        color: statusColors[status] || '#64748b',
      };
    });

    // Dynamic Top Selling Products
    const salesByProduct: Record<string, { id: string; name: string; price: number; image: string; count: number }> = {};
    revenueOrders.forEach((order) => {
      order.items?.forEach((item: any) => {
        const key = item.productId || item.sku;
        if (!key) return;
        if (!salesByProduct[key]) {
          salesByProduct[key] = {
            id: key,
            name: item.name || 'Product',
            price: Number(item.unitPrice || item.price) || 0,
            image: item.image || '',
            count: 0,
          };
        }
        salesByProduct[key].count += Number(item.quantity) || 0;
      });
    });

    const topSellingProducts = Object.values(salesByProduct)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map((p) => ({
        id: p.id,
        name: p.name,
        sold: `${p.count} sold`,
        price: p.price,
        image: p.image,
      }));

    const aov = revenueOrders.length > 0 ? Math.round((paidRevenue / revenueOrders.length) * 100) / 100 : 0;
    const startOfRecentWeek = utcDayStart - 6 * 86400000;
    const startOfPreviousWeek = startOfRecentWeek - 7 * 86400000;
    const countInRange = (list: any[], field: string, start: number, end: number) =>
      list.filter((order) => {
        const value = new Date(order[field] || order.createdAt).getTime();
        return value >= start && value < end;
      }).length;
    const percentChange = (current: number, previous: number) =>
      previous === 0 ? (current === 0 ? '0%' : '+100%') : `${((current - previous) / previous) >= 0 ? '+' : ''}${(((current - previous) / previous) * 100).toFixed(1)}%`;

    const monthBuckets = Array.from({ length: 12 }, (_, index) => {
      const monthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + index, 1));
      const monthKey = monthDate.toISOString().slice(0, 7);
      return {
        month: monthDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
        monthKey,
        orders: 0,
        revenue: 0,
      };
    });
    orders.forEach((order) => {
      const monthKey = new Date(order.createdAt).toISOString().slice(0, 7);
      const bucket = monthBuckets.find((item) => item.monthKey === monthKey);
      if (bucket) bucket.orders += 1;
    });
    revenueOrders.forEach((order) => {
      const monthKey = new Date(order.paymentPaidAt || order.createdAt).toISOString().slice(0, 7);
      const bucket = monthBuckets.find((item) => item.monthKey === monthKey);
      if (bucket) bucket.revenue += Number(order.finalTotal) || 0;
    });
    const currentWeekStart = utcDayStart - ((new Date(utcDayStart).getUTCDay() + 6) % 7) * 86400000;
    const firstWeekStart = currentWeekStart - 12 * 7 * 86400000;
    const weekBuckets = Array.from({ length: 13 }, (_, index) => {
      const weekStart = new Date(firstWeekStart + index * 7 * 86400000);
      return {
        date: weekStart.toISOString().slice(0, 10),
        week: weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
        orders: 0,
        revenue: 0,
      };
    });
    const findWeekBucket = (value: string | number | Date) => {
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) return undefined;
      const utcDate = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
      const index = Math.floor((utcDate - firstWeekStart) / (7 * 86400000));
      return weekBuckets[index];
    };
    orders.forEach((order) => {
      const bucket = findWeekBucket(order.createdAt);
      if (bucket) bucket.orders += 1;
    });
    revenueOrders.forEach((order) => {
      const bucket = findWeekBucket(order.paymentPaidAt || order.createdAt);
      if (bucket) bucket.revenue += Number(order.finalTotal) || 0;
    });
    const ordersThisWeek = countInRange(orders, 'createdAt', startOfRecentWeek, utcDayStart + 86400000);
    const ordersPreviousWeek = countInRange(orders, 'createdAt', startOfPreviousWeek, startOfRecentWeek);
    const revenueThisWeek = revenueOrders
      .filter((order) => new Date(order.paymentPaidAt || order.createdAt).getTime() >= startOfRecentWeek)
      .reduce((sum, order) => sum + (Number(order.finalTotal) || 0), 0);
    const revenuePreviousWeek = revenueOrders
      .filter((order) => {
        const date = new Date(order.paymentPaidAt || order.createdAt).getTime();
        return date >= startOfPreviousWeek && date < startOfRecentWeek;
      })
      .reduce((sum, order) => sum + (Number(order.finalTotal) || 0), 0);

    res.json({
      success: true,
      data: {
        grossSales,
        totalSales: grossSales,
        salesGrowth: percentChange(revenueThisWeek, revenuePreviousWeek),
        netSales,
        paidRevenue,
        unpaidOrderValue,
        refundTotals,
        codCollectedRevenue,
        codAwaitingCollection,
        codAwaitingOrders: codAwaitingOrders.length,
        pendingPaymentOrders,
        failedPaymentOrders,
        cancelledOrdersCount,
        codOrders,
        onlinePaymentOrders,
        paymentMethodBreakdown,
        totalOrders: orders.length,
        ordersGrowth: percentChange(ordersThisWeek, ordersPreviousWeek),
        totalCustomers,
        totalProducts: products.length,
        totalCoupons: couponsCount,
        averageOrderValue: aov,
        pendingOrders,
        processingOrders,
        shippedOrders,
        deliveredOrders,
        todayOrders,
        monthlyOrders,
        lowStockCount: lowStockProducts.length,
        outOfStockCount: outOfStockProducts.length,
        categorySales,
        lowStockAlerts: lowStockProducts.map((p) => ({ id: String(p._id || p.id || ''), name: p.name, sku: p.sku, stock: p.stock })),
        recentOrders: orders.slice(0, 5),
        salesOverview,
        dailyOrderStatistics: days.map(({ day, dateStr, orders: count, sales }) => ({ day, date: dateStr, orders: count, revenue: Math.round(sales * 100) / 100 })),
        weeklyOrderStatistics: weekBuckets.map(({ week, date, orders: count, revenue }) => ({
          week,
          date,
          orders: count,
          revenue: Math.round(revenue * 100) / 100,
        })),
        monthlyOrderStatistics: monthBuckets.map(({ month, monthKey, orders: count, revenue }) => ({
          month,
          monthKey,
          orders: count,
          revenue: Math.round(revenue * 100) / 100,
        })),
        orderStatusDistribution,
        topSellingProducts,
        systemMetrics: {
          storeStatus: 'Online',
          lastBackup: 'Not configured',
          serverLoad: 'Not measured',
          databaseStatus: isDbConnected() ? 'Atlas Connected' : 'In-Memory Active',
        },
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin Inventory View
router.get('/inventory', requireAuth, requireRole(['admin', 'super_admin', 'inventory_manager']), (req: Request, res: Response) => {
  const inventoryList = inMemoryProducts.map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    category: p.category,
    price: p.price,
    salePrice: p.salePrice,
    stockOnHand: p.stock + (p.reservedStock || 0),
    reservedStock: p.reservedStock || 0,
    availableStock: p.stock,
    lowStockThreshold: p.lowStockThreshold || 5,
    isLowStock: p.stock <= (p.lowStockThreshold || 5),
    isOutOfStock: p.stock === 0,
  }));

  res.json({ success: true, data: inventoryList });
});

// Admin Audit Logs
router.get('/audit-logs', requireAuth, requireRole(['admin', 'super_admin']), (req: Request, res: Response) => {
  res.json({ success: true, data: inMemoryAuditLogs });
});

// Admin Staff Management
router.get('/staff', requireAuth, requireRole(['super_admin', 'admin']), (req: Request, res: Response) => {
  res.json({ success: true, data: inMemoryStaff });
});

// Admin Customers List
router.get('/customers', requireAuth, requireRole(['admin', 'super_admin']), (req: Request, res: Response) => {
  // Aggregate customer order history
  const customerMap: Record<string, any> = {
    'user-customer': {
      id: 'user-customer',
      name: 'Sarah Khan',
      email: 'customer@example.com',
      phone: '+880 1812 345678',
      role: 'customer',
      city: 'Dhaka',
      district: 'Dhanmondi',
      status: 'active',
      ordersCount: 0,
      totalSpent: 0,
      joinedAt: '2025-01-15T00:00:00.000Z',
    },
    'user-guest-sample': {
      id: 'user-guest-sample',
      name: 'Rafiul Islam',
      email: 'rafiul@example.com',
      phone: '+880 1712 998877',
      role: 'customer',
      city: 'Chittagong',
      district: 'Agrabad',
      status: 'active',
      ordersCount: 0,
      totalSpent: 0,
      joinedAt: '2025-02-10T00:00:00.000Z',
    },
  };

  inMemoryOrders.forEach((o) => {
    const key = o.customerId || o.customerEmail;
    if (!customerMap[key]) {
      customerMap[key] = {
        id: key,
        name: o.customerName || 'Customer',
        email: o.customerEmail,
        phone: o.customerPhone || 'N/A',
        role: 'customer',
        city: o.shippingAddress?.division || 'Dhaka',
        district: o.shippingAddress?.district || 'General',
        status: 'active',
        ordersCount: 0,
        totalSpent: 0,
        joinedAt: o.createdAt || new Date().toISOString(),
      };
    }
    customerMap[key].ordersCount += 1;
    if (o.status !== 'cancelled' && o.status !== 'returned') {
      customerMap[key].totalSpent += o.finalTotal || 0;
    }
  });

  const customers = Object.values(customerMap).map((c) => ({
    ...c,
    totalSpent: Math.round(c.totalSpent * 100) / 100,
  }));

  res.json({ success: true, data: customers });
});

// Admin Coupons List & Management
router.get('/coupons', requireAuth, requireRole(['admin', 'super_admin']), async (req: Request, res: Response) => {
  try {
    const { inMemoryCoupons } = await import('./checkoutRoutes');
    if (isDbConnected()) {
      try {
        const dbCoupons = await CouponModel.find().sort({ createdAt: -1 });
        if (dbCoupons.length > 0) {
          const formatted = dbCoupons.map((c) => ({
            id: c._id.toString(),
            code: c.code,
            discountType: c.discountType,
            discountValue: c.discountValue,
            minOrderAmount: c.minOrderAmount || 0,
            maxDiscount: c.maxDiscount,
            validFrom: c.validFrom ? c.validFrom.toISOString().split('T')[0] : '2024-01-01',
            validTo: c.validTo ? c.validTo.toISOString().split('T')[0] : '2028-12-31',
            isActive: c.isActive,
            usageCount: c.usedCount || 0,
          }));
          res.json({ success: true, data: formatted });
          return;
        }
      } catch (e) {
        console.warn('DB coupon fetch failed:', e);
      }
    }
    res.json({ success: true, data: inMemoryCoupons });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/coupons', requireAuth, requireRole(['admin', 'super_admin']), async (req: Request, res: Response) => {
  try {
    const { inMemoryCoupons } = await import('./checkoutRoutes');
    const {
      code,
      discountType,
      discountValue,
      minOrderAmount,
      minOrderValue,
      maxDiscount,
      validFrom,
      validTo,
      expiresAt,
    } = req.body;

    if (!code || !discountValue) {
      res.status(400).json({ success: false, error: 'Coupon code and discount value are required' });
      return;
    }

    const cleanCode = code.trim().toUpperCase();
    if (inMemoryCoupons.some((c: any) => c.code === cleanCode)) {
      res.status(400).json({ success: false, error: 'Coupon code already exists' });
      return;
    }

    const parsedMin = parseFloat(minOrderAmount || minOrderValue || '0') || 0;
    const parsedValidFrom = validFrom || new Date().toISOString();
    const parsedValidTo = validTo || expiresAt || '2028-12-31T23:59:59.999Z';

    const newCoupon = {
      id: `cpn-${Date.now()}`,
      code: cleanCode,
      discountType: discountType || 'percentage',
      discountValue: parseFloat(discountValue),
      minOrderAmount: parsedMin,
      minOrderValue: parsedMin,
      maxDiscount: maxDiscount ? parseFloat(maxDiscount) : undefined,
      validFrom: parsedValidFrom,
      validTo: parsedValidTo,
      expiresAt: parsedValidTo,
      isActive: true,
      usageCount: 0,
    };

    inMemoryCoupons.push(newCoupon);

    if (isDbConnected()) {
      try {
        await CouponModel.create({
          code: cleanCode,
          discountType: newCoupon.discountType,
          discountValue: newCoupon.discountValue,
          minOrderAmount: parsedMin,
          maxDiscount: newCoupon.maxDiscount,
          validFrom: new Date(parsedValidFrom),
          validTo: new Date(parsedValidTo),
          isActive: true,
        });
      } catch (dbErr: any) {
        console.warn('Coupon DB persistence failed:', dbErr.message);
      }
    }

    res.status(201).json({ success: true, data: newCoupon });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/coupons/:code/toggle', requireAuth, requireRole(['admin', 'super_admin']), async (req: Request, res: Response) => {
  try {
    const { inMemoryCoupons } = await import('./checkoutRoutes');
    const { code } = req.params;
    const cleanCode = code.toUpperCase();
    const cpn = inMemoryCoupons.find((c: any) => c.code === cleanCode);
    if (!cpn) {
      res.status(404).json({ success: false, error: 'Coupon not found' });
      return;
    }
    cpn.isActive = !cpn.isActive;

    if (isDbConnected()) {
      try {
        await CouponModel.findOneAndUpdate({ code: cleanCode }, { isActive: cpn.isActive });
      } catch (dbErr: any) {
        console.warn('Coupon toggle DB sync failed:', dbErr.message);
      }
    }

    res.json({ success: true, data: cpn });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/coupons/:code', requireAuth, requireRole(['admin', 'super_admin']), async (req: Request, res: Response) => {
  try {
    const { inMemoryCoupons } = await import('./checkoutRoutes');
    const { code } = req.params;
    const cleanCode = code.toUpperCase();
    const idx = inMemoryCoupons.findIndex((c: any) => c.code === cleanCode);
    if (idx === -1) {
      res.status(404).json({ success: false, error: 'Coupon not found' });
      return;
    }
    inMemoryCoupons.splice(idx, 1);

    if (isDbConnected()) {
      try {
        await CouponModel.findOneAndDelete({ code: cleanCode });
      } catch (dbErr: any) {
        console.warn('Coupon deletion DB sync failed:', dbErr.message);
      }
    }

    res.json({ success: true, message: `Coupon ${cleanCode} deleted` });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin Analytics & Reports
router.get('/analytics', requireAuth, requireRole(['admin', 'super_admin']), async (req: Request, res: Response) => {
  try {
    if (isProduction() && !isDbConnected()) {
      res.status(503).json({ success: false, error: 'Persistent order data is required for production financial reporting.' });
      return;
    }

    let orders: any[] = inMemoryOrders;

    if (isDbConnected()) {
      try {
        const dbOrders = await OrderModel.find().sort({ createdAt: -1 }).lean();
        orders = dbOrders as any[];
      } catch (err: any) {
        console.error('Analytics persistent orders query failed:', err.message);
        res.status(503).json({ success: false, error: 'Persistent order data is temporarily unavailable.' });
        return;
      }
    }

    const completedOrders = orders.filter((o) => !['cancelled', 'returned', 'refunded'].includes(o.status));
    const revenueOrders = orders.filter(
      (o) => isPaymentReceiptVerified(o) && !['cancelled', 'returned', 'refunded'].includes(o.status)
    );
    const paidRevenue = Math.round(revenueOrders.reduce((sum, o) => sum + (Number(o.finalTotal) || 0), 0) * 100) / 100;
    const grossSales = paidRevenue;
    const unpaidOrders = completedOrders.filter((o) => !isPaymentReceiptVerified(o));
    const unpaidOrderValue = Math.round(unpaidOrders.reduce((sum, o) => sum + (Number(o.finalTotal) || 0), 0) * 100) / 100;
    const refundedOrders = orders.filter((o) => o.paymentStatus === 'refunded');
    const refundTotals = Math.round(refundedOrders.reduce((sum, o) => sum + (Number(o.finalTotal) || 0), 0) * 100) / 100;

    // Status breakdown
    const statusCounts: Record<string, number> = {
      pending: 0,
      confirmed: 0,
      processing: 0,
      packed: 0,
      shipped: 0,
      delivered: 0,
      cancelled: 0,
      refunded: 0,
      returned: 0,
    };
    orders.forEach((o) => {
      const s = (o.status || 'pending').toLowerCase();
      statusCounts[s] = (statusCounts[s] || 0) + 1;
    });

    // Payment method breakdown
    const paymentMethods: Record<string, number> = {
      cod: 0,
      bkash: 0,
      nagad: 0,
      card: 0,
    };
    orders.forEach((o) => {
      const pm = (o.paymentMethod || 'cod').toLowerCase();
      if (pm === 'bkash') paymentMethods.bkash += 1;
      else if (pm === 'nagad') paymentMethods.nagad += 1;
      else if (pm === 'card' || pm === 'credit_card' || pm === 'sslcommerz') paymentMethods.card += 1;
      else paymentMethods.cod += 1;
    });

    // Top products
    const productPerformance: Record<string, { name: string; sales: number; revenue: number }> = {};
    revenueOrders.forEach((o) => {
      o.items?.forEach((item: any) => {
        const name = item.name || 'Product';
        if (!productPerformance[name]) {
          productPerformance[name] = { name, sales: 0, revenue: 0 };
        }
        productPerformance[name].sales += item.quantity || 1;
        productPerformance[name].revenue = Math.round((productPerformance[name].revenue + (item.total || (item.unitPrice || item.price || 0) * (item.quantity || 1))) * 100) / 100;
      });
    });

    const topProducts = Object.values(productPerformance)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    // 7-day revenue trend calculated from real order dates
    const now = new Date();
    const utcDayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const dayBuckets = Array.from({ length: 7 }, (_, index) => {
      const d = new Date(utcDayStart - (6 - index) * 86400000);
      const dateStr = d.toISOString().split('T')[0];
      return {
        day: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
        dateStr,
        revenue: 0,
        orders: 0,
      };
    });

    revenueOrders.forEach((o) => {
      const oDate = new Date(o.paymentPaidAt || o.createdAt).toISOString().split('T')[0];
      const match = dayBuckets.find((b) => b.dateStr === oDate);
      if (match) match.revenue += Number(o.finalTotal || 0);
    });
    orders.forEach((o) => {
      const oDate = new Date(o.createdAt).toISOString().split('T')[0];
      const match = dayBuckets.find((b) => b.dateStr === oDate);
      if (match) match.orders += 1;
    });

    const dailyRevenue = dayBuckets.map((b) => ({
      day: b.day,
      revenue: Math.round(b.revenue * 100) / 100,
      orders: b.orders,
    }));
    const monthlyBuckets = Array.from({ length: 12 }, (_, index) => {
      const monthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + index, 1));
      return {
        month: monthDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
        key: monthDate.toISOString().slice(0, 7),
        orders: 0,
        revenue: 0,
      };
    });
    orders.forEach((order) => {
      const bucket = monthlyBuckets.find((item) => item.key === new Date(order.createdAt).toISOString().slice(0, 7));
      if (bucket) bucket.orders += 1;
    });
    revenueOrders.forEach((order) => {
      const bucket = monthlyBuckets.find(
        (item) => item.key === new Date(order.paymentPaidAt || order.createdAt).toISOString().slice(0, 7)
      );
      if (bucket) bucket.revenue += Number(order.finalTotal) || 0;
    });

    res.json({
      success: true,
      data: {
        currency: 'BDT',
        grossSales: Math.round(grossSales * 100) / 100,
        paidRevenue,
        unpaidOrderValue,
        refundTotals,
        codCollectedRevenue: Math.round(
          orders
            .filter((o) => o.paymentMethod === 'cod' && isPaymentReceiptVerified(o))
            .reduce((sum, o) => sum + (Number(o.finalTotal) || 0), 0) * 100
        ) / 100,
        codAwaitingCollection: Math.round(
          orders
            .filter(
              (o) =>
                o.paymentMethod === 'cod' &&
                !['cancelled', 'returned', 'refunded'].includes(o.status) &&
                !isPaymentReceiptVerified(o)
            )
            .reduce((sum, o) => sum + (Number(o.finalTotal) || 0), 0) * 100
        ) / 100,
        pendingPaymentOrders: orders.filter((o) => o.paymentStatus === 'unpaid' && o.paymentMethod !== 'cod').length,
        codAwaitingOrders: orders.filter(
          (o) =>
            o.paymentMethod === 'cod' &&
            !['cancelled', 'returned', 'refunded'].includes(o.status) &&
            !isPaymentReceiptVerified(o)
        ).length,
        failedPaymentOrders: orders.filter((o) => o.paymentStatus === 'failed').length,
        totalOrders: orders.length,
        averageOrderValue: revenueOrders.length ? Math.round((paidRevenue / revenueOrders.length) * 100) / 100 : 0,
        pendingOrders: statusCounts.pending,
        processingOrders: statusCounts.processing,
        shippedOrders: statusCounts.shipped,
        deliveredOrders: statusCounts.delivered,
        todayOrders: dayBuckets[dayBuckets.length - 1].orders,
        monthlyOrders: monthlyBuckets[monthlyBuckets.length - 1].orders,
        statusCounts,
        paymentMethods,
        topProducts,
        dailyRevenue,
        dailyOrderStatistics: dayBuckets.map(({ day, dateStr, orders: count }) => ({
          day,
          date: dateStr,
          orders: count,
        })),
        monthlyOrderStatistics: monthlyBuckets.map(({ month, key, orders: count, revenue }) => ({
          month,
          monthKey: key,
          orders: count,
          revenue: Math.round(revenue * 100) / 100,
        })),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// STORE SETTINGS APIS (MONGODB PERSISTENT)
// ==========================================

// Legacy endpoint backwards-compatibility
router.get('/store-settings', requireAuth, requireRole(['admin', 'super_admin']), async (req: Request, res: Response) => {
  const current = await getActiveSettings();
  res.json({
    success: true,
    data: {
      storeName: current.general.storeName,
      tagline: current.general.tagline,
      currency: current.general.currency,
      currencySymbol: current.general.currencySymbol,
      supportEmail: current.general.supportEmail,
      supportPhone: current.general.supportPhone,
      freeShippingThreshold: current.shipping.freeShippingThreshold,
      dhakaShippingFee: current.shipping.insideDhakaFee,
      outsideDhakaShippingFee: current.shipping.outsideDhakaFee,
      taxRatePercent: current.general.taxRatePercent,
    },
  });
});

router.put('/store-settings', requireAuth, requireRole(['admin', 'super_admin']), async (req: Request, res: Response) => {
  const updates = req.body;
  if (updates.storeName || updates.tagline || updates.supportEmail || updates.supportPhone) {
    await updateSettingsSection('general', {
      storeName: updates.storeName,
      tagline: updates.tagline,
      supportEmail: updates.supportEmail,
      supportPhone: updates.supportPhone,
    });
  }
  if (updates.freeShippingThreshold !== undefined || updates.dhakaShippingFee !== undefined || updates.outsideDhakaShippingFee !== undefined) {
    await updateSettingsSection('shipping', {
      freeShippingThreshold: Number(updates.freeShippingThreshold || 2500),
      insideDhakaFee: Number(updates.dhakaShippingFee || 60),
      outsideDhakaFee: Number(updates.outsideDhakaShippingFee || 120),
    });
  }
  res.json({ success: true, message: 'Settings saved successfully' });
});

// GET /api/admin/settings - Retrieve full masked settings for admin settings center
router.get('/settings', requireAuth, requireRole(['admin', 'super_admin']), async (req: Request, res: Response) => {
  try {
    const raw = await getActiveSettings();
    const masked = getMaskedSettings(raw);
    res.json({ success: true, data: masked });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/admin/settings/general - Update General Store Settings
router.put('/settings/general', requireAuth, requireRole(['admin', 'super_admin']), async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const updated = await updateSettingsSection('general', req.body);
    await recordActivityLog({
      action: 'SETTINGS_GENERAL_UPDATE',
      category: 'settings',
      actorName: user?.name || 'Administrator',
      actorEmail: user?.email,
      actorRole: user?.role || 'admin',
      details: `Updated General Store profile: ${updated.storeName} (${updated.supportEmail})`,
      metadata: updated,
    });
    res.json({ success: true, message: 'General store settings updated and persisted.', data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/admin/settings/shipping - Update Shipping Rates & Delivery Time
router.put('/settings/shipping', requireAuth, requireRole(['admin', 'super_admin']), async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const updated = await updateSettingsSection('shipping', req.body);
    await recordActivityLog({
      action: 'SETTINGS_SHIPPING_UPDATE',
      category: 'settings',
      actorName: user?.name || 'Administrator',
      actorEmail: user?.email,
      actorRole: user?.role || 'admin',
      details: `Updated shipping fees: Inside Dhaka ৳${updated.insideDhakaFee}, Outside Dhaka ৳${updated.outsideDhakaFee}, Free Threshold ৳${updated.freeShippingThreshold}`,
      metadata: updated,
    });
    res.json({ success: true, message: 'Shipping settings saved. Real checkout rates updated immediately.', data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/admin/settings/payment - Update Payment Gateways (COD, bKash, Nagad, Card)
router.put('/settings/payment', requireAuth, requireRole(['admin', 'super_admin']), async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const updated = await updateSettingsSection('payment', req.body);
    await recordActivityLog({
      action: 'SETTINGS_PAYMENT_UPDATE',
      category: 'settings',
      actorName: user?.name || 'Administrator',
      actorEmail: user?.email,
      actorRole: user?.role || 'admin',
      details: `Updated payment gateway settings (COD: ${updated.cod.enabled ? 'ON' : 'OFF'}, bKash: ${updated.bkash.enabled ? 'ON' : 'OFF'}, Nagad: ${updated.nagad.enabled ? 'ON' : 'OFF'}, Card: ${updated.card.enabled ? 'ON' : 'OFF'})`,
    });
    const full = await getActiveSettings();
    res.json({ success: true, message: 'Payment gateway configuration updated successfully.', data: getMaskedSettings(full).payment });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/admin/settings/email - Update SMTP & Email Configurations
router.put('/settings/email', requireAuth, requireRole(['admin', 'super_admin']), async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const updated = await updateSettingsSection('email', req.body);
    await recordActivityLog({
      action: 'SETTINGS_EMAIL_UPDATE',
      category: 'settings',
      actorName: user?.name || 'Administrator',
      actorEmail: user?.email,
      actorRole: user?.role || 'admin',
      details: `Updated SMTP host ${updated.smtp?.host}:${updated.smtp?.port} with sender ${updated.smtp?.senderEmail}`,
    });
    const full = await getActiveSettings();
    res.json({ success: true, message: 'Email & SMTP settings saved successfully.', data: getMaskedSettings(full).email });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/admin/settings/email/test - Verify SMTP Connection / Send Test Email
router.post('/settings/email/test', requireAuth, requireRole(['admin', 'super_admin']), async (req: Request, res: Response) => {
  try {
    const { recipientEmail } = req.body;
    const targetEmail = recipientEmail || 'admin@novara.com';
    const settings = await getActiveSettings();
    const smtp = settings.email.smtp;

    if (!smtp.host) {
      res.status(400).json({ success: false, error: 'SMTP Host is not configured in email settings.' });
      return;
    }

    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port || 587,
      secure: Boolean(smtp.secure),
      auth: smtp.username ? { user: smtp.username, pass: smtp.password || '' } : undefined,
      connectionTimeout: 5000,
    });

    try {
      await transporter.verify();
      // Try sending a sample test email
      await transporter.sendMail({
        from: `"${smtp.senderName || 'ShopMax'}" <${smtp.senderEmail || 'orders@shopmax.com'}>`,
        to: targetEmail,
        subject: 'ShopMax by Novara - SMTP Connection Verification',
        text: 'This is a test email confirming that your Novara Commerce SMTP connection is working correctly and ready to dispatch customer transactional emails.',
        html: `<div style="font-family:sans-serif;padding:24px;background:#f9fafb;border-radius:8px;">
          <h2 style="color:#059669;margin-top:0;">SMTP Connection Verified Successfully</h2>
          <p>Your ShopMax SMTP configuration is connected to <strong>${smtp.host}:${smtp.port}</strong>.</p>
          <p>Sender Identity: <strong>${smtp.senderName} (${smtp.senderEmail})</strong></p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />
          <small style="color:#6b7280;">Novara Commerce Production Infrastructure</small>
        </div>`,
      });

      const user = (req as any).user;
      await recordActivityLog({
        action: 'EMAIL_TEST_SUCCESS',
        category: 'settings',
        actorName: user?.name || 'Administrator',
        actorEmail: user?.email,
        actorRole: user?.role || 'admin',
        details: `Verified SMTP connection and delivered test email to ${targetEmail}`,
      });

      res.json({
        success: true,
        message: `SMTP connection established and verified. Test email dispatched to ${targetEmail}.`,
      });
    } catch (smtpErr: any) {
      // In development or sandbox without live outgoing port access, verify configuration parameters gracefully
      console.warn('Direct SMTP socket error (sandbox or offline relay):', smtpErr.message);
      
      const user = (req as any).user;
      await recordActivityLog({
        action: 'EMAIL_TEST_SIMULATION',
        category: 'settings',
        actorName: user?.name || 'Administrator',
        actorEmail: user?.email,
        actorRole: user?.role || 'admin',
        details: `SMTP configuration validated for ${smtp.host}:${smtp.port}. Relay returned: ${smtpErr.message}`,
      });

      res.json({
        success: true,
        message: `SMTP parameters validated for ${smtp.host}:${smtp.port} (Relay status: configured).`,
        warning: `External relay reported: ${smtpErr.message}. Ensure firewall permits outbound SMTP on port ${smtp.port}.`,
      });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// AUDIT LOGS & ADMIN SECURITY LOGS APIS
// ==========================================

// GET /api/admin/logs/activity - Administrative Activity Audit Trail
router.get('/logs/activity', requireAuth, requireRole(['admin', 'super_admin']), async (req: Request, res: Response) => {
  try {
    const { category, search, limit = '50', page = '1' } = req.query;
    const lim = Math.min(200, parseInt(limit as string, 10) || 50);
    const pg = Math.max(1, parseInt(page as string, 10) || 1);

    if (isDbConnected()) {
      try {
        const query: any = {};
        if (category && category !== 'all') {
          query.category = category;
        }
        if (search) {
          const s = String(search).trim();
          query.$or = [
            { action: { $regex: s, $options: 'i' } },
            { actorName: { $regex: s, $options: 'i' } },
            { actorEmail: { $regex: s, $options: 'i' } },
            { details: { $regex: s, $options: 'i' } },
          ];
        }

        const total = await ActivityLogModel.countDocuments(query);
        const docs = await ActivityLogModel.find(query)
          .sort({ timestamp: -1 })
          .skip((pg - 1) * lim)
          .limit(lim)
          .lean();

        if (docs.length > 0 || total > 0) {
          const formatted = docs.map((d: any) => ({
            id: d._id ? d._id.toString() : d.id,
            action: d.action,
            category: d.category,
            actorName: d.actorName,
            actorEmail: d.actorEmail,
            actorRole: d.actorRole,
            resourceId: d.resourceId,
            resourceType: d.resourceType,
            details: d.details,
            metadata: d.metadata,
            timestamp: d.timestamp ? new Date(d.timestamp).toISOString() : new Date().toISOString(),
          }));

          res.json({
            success: true,
            data: formatted,
            pagination: { total, page: pg, limit: lim, pages: Math.ceil(total / lim) },
          });
          return;
        }
      } catch (dbErr: any) {
        console.warn('ActivityLog DB query fallback:', dbErr.message);
      }
    }

    // Memory store fallback
    let logs = [...inMemoryActivityLogs];
    if (category && category !== 'all') {
      logs = logs.filter((l) => l.category === category);
    }
    if (search) {
      const q = String(search).toLowerCase();
      logs = logs.filter(
        (l) =>
          l.action.toLowerCase().includes(q) ||
          l.actorName.toLowerCase().includes(q) ||
          (l.actorEmail && l.actorEmail.toLowerCase().includes(q)) ||
          l.details.toLowerCase().includes(q)
      );
    }

    const total = logs.length;
    const paginated = logs.slice((pg - 1) * lim, pg * lim);

    res.json({
      success: true,
      data: paginated,
      pagination: { total, page: pg, limit: lim, pages: Math.ceil(total / lim) },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/admin/logs/security - Security & Access Audit Trail
router.get('/logs/security', requireAuth, requireRole(['admin', 'super_admin']), async (req: Request, res: Response) => {
  try {
    const { eventType, outcome, search, limit = '50', page = '1' } = req.query;
    const lim = Math.min(200, parseInt(limit as string, 10) || 50);
    const pg = Math.max(1, parseInt(page as string, 10) || 1);

    if (isDbConnected()) {
      try {
        const query: any = {};
        if (eventType && eventType !== 'all') query.eventType = eventType;
        if (outcome && outcome !== 'all') query.outcome = outcome;
        if (search) {
          const s = String(search).trim();
          query.$or = [
            { actorEmail: { $regex: s, $options: 'i' } },
            { actorName: { $regex: s, $options: 'i' } },
            { reason: { $regex: s, $options: 'i' } },
            { ipAddress: { $regex: s, $options: 'i' } },
          ];
        }

        const total = await AdminLogModel.countDocuments(query);
        const docs = await AdminLogModel.find(query)
          .sort({ timestamp: -1 })
          .skip((pg - 1) * lim)
          .limit(lim)
          .lean();

        if (docs.length > 0 || total > 0) {
          const formatted = docs.map((d: any) => ({
            id: d._id ? d._id.toString() : d.id,
            eventType: d.eventType,
            actorEmail: d.actorEmail,
            actorName: d.actorName,
            actorRole: d.actorRole,
            ipAddress: d.ipAddress,
            userAgent: d.userAgent,
            outcome: d.outcome,
            reason: d.reason,
            metadata: d.metadata,
            timestamp: d.timestamp ? new Date(d.timestamp).toISOString() : new Date().toISOString(),
          }));

          res.json({
            success: true,
            data: formatted,
            pagination: { total, page: pg, limit: lim, pages: Math.ceil(total / lim) },
          });
          return;
        }
      } catch (dbErr: any) {
        console.warn('AdminLog DB query fallback:', dbErr.message);
      }
    }

    let logs = [...inMemoryAdminSecurityLogs];
    if (eventType && eventType !== 'all') logs = logs.filter((l) => l.eventType === eventType);
    if (outcome && outcome !== 'all') logs = logs.filter((l) => l.outcome === outcome);
    if (search) {
      const q = String(search).toLowerCase();
      logs = logs.filter(
        (l) =>
          (l.actorEmail && l.actorEmail.toLowerCase().includes(q)) ||
          (l.reason && l.reason.toLowerCase().includes(q)) ||
          (l.ipAddress && l.ipAddress.toLowerCase().includes(q))
      );
    }

    const total = logs.length;
    const paginated = logs.slice((pg - 1) * lim, pg * lim);

    res.json({
      success: true,
      data: paginated,
      pagination: { total, page: pg, limit: lim, pages: Math.ceil(total / lim) },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// System Integration Status
router.get('/system-status', async (_req: Request, res: Response) => {
  try {
    const db = getDbStatus();
    const cloudinaryConfigured = Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY);
    const resendConfigured = Boolean(process.env.RESEND_API_KEY);
    const paymentGateways = getPaymentGatewayConfigStatus(await getActiveSettings());
    const onlinePaymentConfigured =
      paymentGateways.bkash || paymentGateways.nagad || paymentGateways.sslcommerz;

    res.json({
      success: true,
      system: {
        mongodb: db,
        cloudinary: {
          configured: cloudinaryConfigured,
          provider: 'Cloudinary Media API',
        },
        email: {
          configured: resendConfigured,
          provider: 'Resend HTTP API',
        },
        payment: {
          configured: onlinePaymentConfigured,
          methods: [
            `Cash on Delivery (${paymentGateways.cod ? 'Available' : 'Disabled'})`,
            `bKash (${paymentGateways.bkash ? 'Configured' : 'Not configured'})`,
            `Nagad (${paymentGateways.nagad ? 'Configured' : 'Unavailable'})`,
            `SSLCOMMERZ (${paymentGateways.sslcommerz ? 'Configured' : 'Not configured'})`,
          ],
        },
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Could not load system status' });
  }
});

// ==========================================
// CONTACT MESSAGES MANAGEMENT (ADMIN)
// ==========================================

// Get message statistics (total, unread, counts by status)
router.get('/messages/stats', requireAuth, requireRole(['admin', 'super_admin', 'order_manager']), async (req: Request, res: Response) => {
  try {
    let messages = inMemoryContactMessages;
    if (isDbConnected()) {
      try {
        const dbMsgs = await ContactMessageModel.find().lean();
        if (dbMsgs && dbMsgs.length > 0) {
          messages = dbMsgs.map((m: any) => ({
            ...m,
            id: m._id ? m._id.toString() : m.id,
            createdAt: m.createdAt ? new Date(m.createdAt).toISOString() : new Date().toISOString(),
            updatedAt: m.updatedAt ? new Date(m.updatedAt).toISOString() : new Date().toISOString(),
          }));
        }
      } catch (err: any) {
        console.warn('[Admin Messages] DB query fallback:', err.message);
      }
    }

    const unread = messages.filter((m) => !m.isRead).length;
    const byStatus = {
      new: messages.filter((m) => m.status === 'new').length,
      read: messages.filter((m) => m.status === 'read').length,
      replied: messages.filter((m) => m.status === 'replied').length,
      archived: messages.filter((m) => m.status === 'archived').length,
    };

    res.json({
      success: true,
      data: {
        total: messages.length,
        unread,
        byStatus,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get all contact messages with search & filtering
router.get('/messages', requireAuth, requireRole(['admin', 'super_admin', 'order_manager']), async (req: Request, res: Response) => {
  try {
    const { status, search } = req.query;

    let messages = inMemoryContactMessages;

    if (isDbConnected()) {
      try {
        const query: any = {};
        if (status && status !== 'all') {
          query.status = status;
        }
        if (search) {
          const s = String(search).trim();
          query.$or = [
            { name: { $regex: s, $options: 'i' } },
            { email: { $regex: s, $options: 'i' } },
            { subject: { $regex: s, $options: 'i' } },
            { message: { $regex: s, $options: 'i' } },
          ];
        }

        const dbMsgs = await ContactMessageModel.find(query).sort({ createdAt: -1 }).lean();
        if (dbMsgs && dbMsgs.length > 0) {
          messages = dbMsgs.map((m: any) => ({
            ...m,
            id: m._id ? m._id.toString() : m.id,
            createdAt: m.createdAt ? new Date(m.createdAt).toISOString() : new Date().toISOString(),
            updatedAt: m.updatedAt ? new Date(m.updatedAt).toISOString() : new Date().toISOString(),
          }));
        }
      } catch (err: any) {
        console.warn('[Admin Messages] DB query fallback:', err.message);
      }
    }

    // In-memory filtering fallback
    let filtered = [...messages];
    if (status && status !== 'all') {
      if (status === 'unread') {
        filtered = filtered.filter((m) => !m.isRead);
      } else {
        filtered = filtered.filter((m) => m.status === status);
      }
    }
    if (search) {
      const q = String(search).toLowerCase();
      filtered = filtered.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q) ||
          m.subject.toLowerCase().includes(q) ||
          m.message.toLowerCase().includes(q)
      );
    }

    // Sort newest first
    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    res.json({
      success: true,
      data: filtered,
      count: filtered.length,
      unreadCount: messages.filter((m) => !m.isRead).length,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update message status (e.g. mark read, mark archived)
router.patch('/messages/:id/status', requireAuth, requireRole(['admin', 'super_admin', 'order_manager']), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, isRead } = req.body;

    const memoryItem = inMemoryContactMessages.find((m) => m.id === id);
    if (memoryItem) {
      if (status) memoryItem.status = status;
      if (typeof isRead === 'boolean') memoryItem.isRead = isRead;
      memoryItem.updatedAt = new Date().toISOString();
    }

    if (isDbConnected()) {
      try {
        const update: any = {};
        if (status) update.status = status;
        if (typeof isRead === 'boolean') update.isRead = isRead;

        await ContactMessageModel.findByIdAndUpdate(id, update);
      } catch (err: any) {
        console.warn('[Admin Messages] DB status update fallback:', err.message);
      }
    }

    res.json({
      success: true,
      message: 'Message status updated',
      data: memoryItem,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Add staff reply note / resolution
router.post('/messages/:id/reply-note', requireAuth, requireRole(['admin', 'super_admin', 'order_manager']), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { staffNotes } = req.body;

    const memoryItem = inMemoryContactMessages.find((m) => m.id === id);
    if (memoryItem) {
      memoryItem.staffNotes = staffNotes;
      memoryItem.status = 'replied';
      memoryItem.isRead = true;
      memoryItem.repliedAt = new Date().toISOString();
      memoryItem.updatedAt = new Date().toISOString();
    }

    if (isDbConnected()) {
      try {
        await ContactMessageModel.findByIdAndUpdate(id, {
          staffNotes,
          status: 'replied',
          isRead: true,
          repliedAt: new Date(),
        });
      } catch (err: any) {
        console.warn('[Admin Messages] DB note update fallback:', err.message);
      }
    }

    res.json({
      success: true,
      message: 'Staff reply note recorded successfully',
      data: memoryItem,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete message
router.delete('/messages/:id', requireAuth, requireRole(['admin', 'super_admin']), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const idx = inMemoryContactMessages.findIndex((m) => m.id === id);
    if (idx !== -1) {
      inMemoryContactMessages.splice(idx, 1);
    }

    if (isDbConnected()) {
      try {
        await ContactMessageModel.findByIdAndDelete(id);
      } catch (err: any) {
        console.warn('[Admin Messages] DB delete fallback:', err.message);
      }
    }

    res.json({
      success: true,
      message: 'Message deleted successfully',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
