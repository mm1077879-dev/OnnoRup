import { Router, Request, Response } from 'express';
import { ContactMessageModel, inMemoryContactMessages } from '../models/ContactMessage';
import { contactLimiter } from '../middleware/rateLimit';
import { isDbConnected } from '../db';
import { generateContactNotificationTemplate, normalizeEmailAddress, sendEmail } from '../services/emailService';
import { createAdminNotification } from '../services/adminNotificationService';

const router = Router();

// Email validation helper
const isValidEmail = (email: string): boolean => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

/**
 * Public Contact Form Submission Endpoint
 * Saves the message and notifies the configured admin inbox through the existing Resend integration.
 */
router.post('/', contactLimiter, async (req: Request, res: Response) => {
  try {
    const { name, email, phone, subject, department, message } = req.body;

    // 1. Validation
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      res.status(400).json({
        success: false,
        error: 'Please enter your full name (at least 2 characters).',
      });
      return;
    }

    if (!email || typeof email !== 'string' || !isValidEmail(email.trim())) {
      res.status(400).json({
        success: false,
        error: 'Please provide a valid email address.',
      });
      return;
    }

    if (!subject || typeof subject !== 'string' || subject.trim().length < 3) {
      res.status(400).json({
        success: false,
        error: 'Please provide a subject line (at least 3 characters).',
      });
      return;
    }

    if (!message || typeof message !== 'string' || message.trim().length < 10) {
      res.status(400).json({
        success: false,
        error: 'Please enter a message containing at least 10 characters.',
      });
      return;
    }

    const trimmedName = name.trim();
    const trimmedEmail = email.toLowerCase().trim();
    const trimmedPhone = phone ? String(phone).trim() : undefined;
    const trimmedSubject = subject.trim();
    const trimmedDepartment = department ? String(department).trim() : 'General Support';
    const trimmedMessage = message.trim();
    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';

    const newId = `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const nowIso = new Date().toISOString();

    const newInMemoryRecord = {
      id: newId,
      name: trimmedName,
      email: trimmedEmail,
      phone: trimmedPhone,
      subject: trimmedSubject,
      department: trimmedDepartment,
      message: trimmedMessage,
      status: 'new' as const,
      isRead: false,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    // Prepend to in-memory store
    inMemoryContactMessages.unshift(newInMemoryRecord);

    let savedId = newId;

    // Persist to MongoDB if connected
    if (isDbConnected()) {
      try {
        const doc = await ContactMessageModel.create({
          name: trimmedName,
          email: trimmedEmail,
          phone: trimmedPhone,
          subject: trimmedSubject,
          department: trimmedDepartment,
          message: trimmedMessage,
          status: 'new',
          isRead: false,
          ipAddress: clientIp,
        });
        if (doc && doc._id) {
          savedId = doc._id.toString();
          newInMemoryRecord.id = savedId;
        }
      } catch (dbErr: any) {
        console.warn('[Contact] MongoDB save warning, kept in memory store:', dbErr.message);
      }
    }

    let adminNotificationCreated = true;
    try {
      await createAdminNotification({
        eventKey: `contact:${savedId}`,
        title: 'New customer message',
        description: `Message from ${trimmedName}: ${trimmedSubject}`,
        module: 'messages',
        referenceId: savedId,
      });
    } catch (error) {
      adminNotificationCreated = false;
      console.error('[Contact] Admin notification could not be persisted:', error);
    }

    const adminRecipient = normalizeEmailAddress(
      process.env.ADMIN_EMAIL || process.env.CONTACT_EMAIL || process.env.EMAIL_FROM || 'admin@novara.com'
    );

    const emailContent = generateContactNotificationTemplate({
      name: trimmedName,
      email: trimmedEmail,
      phone: trimmedPhone,
      subject: trimmedSubject,
      department: trimmedDepartment,
      message: trimmedMessage,
    });

    let emailDelivery = {
      success: false,
      message: 'Contact email notification was not attempted because the Resend sender/recipient configuration is unavailable.',
    };

    if (adminRecipient && adminRecipient.includes('@')) {
      const emailResult = await sendEmail({
        to: adminRecipient,
        subject: `[Contact Form] ${trimmedSubject}`,
        html: emailContent.html,
        text: emailContent.text,
      });

      emailDelivery = {
        success: emailResult.success,
        message: emailResult.success
          ? 'Contact notification delivered via Resend.'
          : emailResult.error || 'Resend rejected the contact notification request.',
      };

      if (!emailResult.success) {
        console.warn('[Contact] Resend notification failed for admin inbox:', {
          recipient: adminRecipient,
          error: emailResult.error,
          subject: trimmedSubject,
        });
      }
    }

    res.status(201).json({
      success: true,
      message: 'Thank you! Your message has been received by our Dhaka support desk.',
      emailDelivered: emailDelivery.success,
      emailStatus: emailDelivery.message,
      adminNotificationCreated,
      data: {
        id: savedId,
        name: trimmedName,
        email: trimmedEmail,
        subject: trimmedSubject,
        createdAt: nowIso,
      },
    });
  } catch (err: any) {
    console.error('[Contact Error]', err);
    res.status(500).json({
      success: false,
      error: 'An unexpected error occurred while processing your message. Please try again.',
    });
  }
});

export default router;
