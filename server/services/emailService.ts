import dotenv from 'dotenv';
dotenv.config();

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailDeliveryResult {
  success: boolean;
  messageId?: string;
  error?: string;
  provider: 'resend' | 'unconfigured';
}

/**
 * Check if the email delivery provider is configured
 */
export function isEmailConfigured(): boolean {
  const apiKey = process.env.RESEND_API_KEY;
  return Boolean(apiKey && apiKey.trim() !== '');
}

/**
 * Format an email address from a "Name <email@example.com>" string or a plain email.
 */
export function normalizeEmailAddress(value?: string): string {
  if (!value) return '';

  const match = value.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  if (match) return match[0];

  return value.trim();
}

export function generateContactNotificationTemplate(params: {
  name: string;
  email: string;
  phone?: string;
  subject: string;
  department: string;
  message: string;
}): { html: string; text: string } {
  const { name, email, phone, subject, department, message } = params;

  const escapedName = name.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escapedEmail = email.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escapedSubject = subject.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escapedDepartment = department.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escapedMessage = message.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br />');

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>New Contact Message: ${escapedSubject}</title>
  <style>
    body { margin: 0; padding: 0; background: #f3f4f6; font-family: Arial, sans-serif; color: #111827; }
    .wrapper { padding: 32px 16px; }
    .container { max-width: 680px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e5e7eb; }
    .header { background: linear-gradient(135deg, #0f172a 0%, #0f766e 100%); color: white; padding: 24px 28px; }
    .title { margin: 0; font-size: 24px; }
    .body { padding: 28px; }
    .meta { margin-bottom: 18px; font-size: 14px; line-height: 1.6; }
    .label { font-weight: 700; color: #111827; }
    .field { background: #f9fafb; border-radius: 10px; padding: 12px 14px; margin-bottom: 12px; }
    .message { white-space: pre-wrap; line-height: 1.7; }
    .footer { padding: 18px 28px 28px; font-size: 12px; color: #6b7280; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <h1 class="title">New Contact Message</h1>
      </div>
      <div class="body">
        <div class="meta">
          <div><span class="label">Name:</span> ${escapedName}</div>
          <div><span class="label">Email:</span> ${escapedEmail}</div>
          ${phone ? `<div><span class="label">Phone:</span> ${phone.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>` : ''}
          <div><span class="label">Department:</span> ${escapedDepartment}</div>
          <div><span class="label">Subject:</span> ${escapedSubject}</div>
        </div>

        <div class="field">
          <div class="label" style="margin-bottom: 8px;">Message</div>
          <div class="message">${escapedMessage}</div>
        </div>
      </div>
      <div class="footer">
        This message was submitted from the public contact form on the storefront.
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();

  const text = `
New Contact Message
Name: ${name}
Email: ${email}
${phone ? `Phone: ${phone}\n` : ''}Department: ${department}
Subject: ${subject}

Message:
${message}
  `.trim();

  return { html, text };
}

/**
 * Professional HTML template for Email OTP verification
 */
export function generateOtpEmailTemplate(params: {
  otp: string;
  recipientName?: string;
  purpose: 'registration' | 'password_reset' | 'login';
  expiresInMinutes?: number;
}): { html: string; text: string } {
  const { otp, recipientName = 'Customer', purpose, expiresInMinutes = 10 } = params;

  const purposeLabels = {
    registration: 'Verify Your Email Address',
    password_reset: 'Reset Your Account Password',
    login: 'One-Time Sign In Verification',
  };

  const actionDescriptions = {
    registration: 'Thank you for choosing Novara Commerce / ShopMax. Please use the following 6-digit verification code to complete your registration.',
    password_reset: 'We received a request to reset the password for your account. Please use the following 6-digit verification code to proceed.',
    login: 'Please use the following 6-digit verification code to securely access your account.',
  };

  const subjectHeader = purposeLabels[purpose] || 'Your Verification Code';
  const actionText = actionDescriptions[purpose] || 'Please use this code to verify your action.';

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subjectHeader} — ShopMax</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: #f3faf7;
      color: #111827;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      width: 100%;
      background-color: #f3faf7;
      padding: 40px 16px;
    }
    .container {
      max-width: 560px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 20px;
      overflow: hidden;
      border: 1px solid #d1fae5;
      box-shadow: 0 10px 25px -5px rgba(0, 135, 90, 0.08);
    }
    .header {
      background: linear-gradient(135deg, #0c261e 0%, #00875a 100%);
      padding: 36px 32px;
      text-align: center;
      color: #ffffff;
    }
    .logo-badge {
      display: inline-block;
      width: 48px;
      height: 48px;
      line-height: 48px;
      background: rgba(255, 255, 255, 0.15);
      border-radius: 12px;
      margin-bottom: 12px;
      font-size: 24px;
    }
    .brand-title {
      margin: 0;
      font-size: 26px;
      font-weight: 800;
      letter-spacing: -0.5px;
    }
    .brand-subtitle {
      margin: 4px 0 0 0;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: #a7f3d0;
    }
    .body-content {
      padding: 36px 32px;
    }
    .greeting {
      font-size: 16px;
      font-weight: 600;
      color: #1f2937;
      margin-top: 0;
      margin-bottom: 12px;
    }
    .description {
      font-size: 14px;
      line-height: 1.6;
      color: #4b5563;
      margin-top: 0;
      margin-bottom: 28px;
    }
    .otp-card {
      background: linear-gradient(180deg, #ecfdf5 0%, #f0fdf4 100%);
      border: 2px dashed #059669;
      border-radius: 16px;
      padding: 24px 20px;
      text-align: center;
      margin-bottom: 28px;
    }
    .otp-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      font-weight: 700;
      color: #047857;
      margin-bottom: 8px;
    }
    .otp-code {
      font-family: 'Courier New', Courier, monospace;
      font-size: 38px;
      font-weight: 800;
      letter-spacing: 8px;
      color: #064e3b;
      margin: 0;
      display: inline-block;
    }
    .otp-expiry {
      margin-top: 10px;
      font-size: 12px;
      color: #059669;
      font-weight: 500;
    }
    .security-notice {
      background-color: #f9fafb;
      border-radius: 12px;
      padding: 16px 20px;
      border-left: 4px solid #10b981;
      margin-bottom: 24px;
    }
    .security-notice-title {
      font-size: 12px;
      font-weight: 700;
      color: #111827;
      margin: 0 0 4px 0;
    }
    .security-notice-text {
      font-size: 12px;
      line-height: 1.5;
      color: #6b7280;
      margin: 0;
    }
    .footer {
      background-color: #f9fafb;
      padding: 24px 32px;
      border-top: 1px solid #e5e7eb;
      text-align: center;
    }
    .footer-text {
      font-size: 11px;
      color: #9ca3af;
      line-height: 1.5;
      margin: 0 0 6px 0;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <div class="logo-badge">🛍️</div>
        <h1 class="brand-title">ShopMax</h1>
        <p class="brand-subtitle">Better Products, Better Life</p>
      </div>
      
      <div class="body-content">
        <h2 class="greeting">Hello ${recipientName},</h2>
        <p class="description">${actionText}</p>
        
        <div class="otp-card">
          <div class="otp-label">One-Time Verification Code</div>
          <div class="otp-code">${otp}</div>
          <div class="otp-expiry">⏱️ Expires in ${expiresInMinutes} minutes</div>
        </div>
        
        <div class="security-notice">
          <p class="security-notice-title">🛡️ Security Reminder</p>
          <p class="security-notice-text">
            Never share this OTP with anyone, including ShopMax or Novara representatives. If you did not initiate this request, please ignore this email.
          </p>
        </div>
      </div>
      
      <div class="footer">
        <p class="footer-text">© 2026 Novara Commerce / ShopMax Bangladesh. All rights reserved.</p>
        <p class="footer-text">Gulshan-2, Dhaka 1212, Bangladesh</p>
      </div>
    </div>
  </div>
</body>
</html>
  `;

  const text = `
ShopMax — Better Products, Better Life
=======================================
${subjectHeader}

Hello ${recipientName},

${actionText}

YOUR VERIFICATION CODE: ${otp}
(Expires in ${expiresInMinutes} minutes)

SECURITY REMINDER:
Never share this code with anyone. If you did not request this verification, please ignore this message.

© 2026 Novara Commerce / ShopMax Bangladesh.
Gulshan-2, Dhaka 1212, Bangladesh
  `.trim();

  return { html, text };
}

/**
 * Send email using the configured Resend API
 */
export async function sendEmail(options: SendEmailOptions): Promise<EmailDeliveryResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.EMAIL_FROM || 'Novara Commerce <onboarding@resend.dev>';

  if (!apiKey || apiKey.trim() === '') {
    console.warn(
      '⚠️ [Email Delivery] RESEND_API_KEY is not configured in .env. Email delivery will be simulated in development mode.'
    );
    return {
      success: false,
      error: 'RESEND_API_KEY environment variable is not configured',
      provider: 'unconfigured',
    };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [options.to],
        subject: options.subject,
        html: options.html,
        text: options.text,
      }),
    });

    const data: any = await response.json();

    if (!response.ok) {
      console.error('❌ [Resend API Error]:', data);
      return {
        success: false,
        error: data.message || `Resend API returned HTTP ${response.status}`,
        provider: 'resend',
      };
    }

    console.log(`✅ [Email Delivery] OTP successfully sent to ${options.to} (ID: ${data.id})`);
    return {
      success: true,
      messageId: data.id,
      provider: 'resend',
    };
  } catch (error: any) {
    console.error('❌ [Email Delivery Exception]:', error);
    return {
      success: false,
      error: error.message || 'Failed to connect to email delivery provider',
      provider: 'resend',
    };
  }
}
