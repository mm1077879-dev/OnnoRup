import dotenv from 'dotenv';
dotenv.config();

export interface GatewayInitiationResult {
  success: boolean;
  gateway: 'bkash' | 'sslcommerz' | 'nagad' | 'cod';
  paymentId?: string;
  redirectUrl?: string;
  transactionRef?: string;
  amount: number;
  currency: string;
  error?: string;
  requiresRedirect: boolean;
  clientSecret?: string;
}

export interface GatewayVerificationResult {
  success: boolean;
  paymentId?: string;
  transactionId?: string;
  orderNumber?: string;
  amount?: number;
  currency?: string;
  gateway?: string;
  status: 'paid' | 'failed' | 'cancelled' | 'pending';
  rawResponse?: any;
  error?: string;
}

import { cachedSettings } from '../models/Settings';

/**
 * Check which payment gateways have valid credentials configured and are enabled in Admin Settings
 */
export function getPaymentGatewayConfigStatus(settings: typeof cachedSettings = cachedSettings) {
  const codEnabled = settings.payment?.cod?.enabled ?? true;

  const bkashConfigured = Boolean(
    (settings.payment?.bkash?.enabled ?? true) &&
    process.env.BKASH_APP_KEY?.trim() &&
    process.env.BKASH_APP_SECRET?.trim() &&
    process.env.BKASH_USERNAME?.trim() &&
    process.env.BKASH_PASSWORD?.trim()
  );

  const sslcommerzConfigured = Boolean(
    (settings.payment?.card?.enabled ?? true) &&
    process.env.SSLCOMMERZ_STORE_ID?.trim() &&
    process.env.SSLCOMMERZ_STORE_PASSWD?.trim()
  );

  // The current Nagad code has no authenticated merchant signature/encryption flow.
  const nagadConfigured = false;

  return {
    cod: codEnabled,
    bkash: bkashConfigured,
    sslcommerz: sslcommerzConfigured,
    nagad: nagadConfigured,
    defaultProvider: process.env.PAYMENT_PROVIDER || (bkashConfigured ? 'bkash' : (codEnabled ? 'cod' : 'bkash')),
  };
}

/**
 * -------------------------------------------------------------
 * 1. bKash Tokenized Checkout API (v2)
 * -------------------------------------------------------------
 */
const BKASH_BASE_URL = (() => {
  const sandboxSetting = process.env.BKASH_IS_SANDBOX?.trim().toLowerCase();
  if (sandboxSetting && sandboxSetting !== 'true' && sandboxSetting !== 'false') {
    throw new Error('BKASH_IS_SANDBOX must be either true or false');
  }
  if (process.env.NODE_ENV !== 'production' && sandboxSetting === 'false') {
    throw new Error('Live bKash payments require NODE_ENV=production');
  }

  const useSandbox =
    sandboxSetting === 'true' ||
    (!sandboxSetting && process.env.NODE_ENV !== 'production');
  return useSandbox
    ? 'https://tokenized.sandbox.bka.sh/v2/tokenized-checkout'
    : 'https://tokenized.pay.bka.sh/v2/tokenized-checkout';
})();

let cachedBkashToken: string | null = null;
let bkashTokenExpiresAt: number = 0;

async function getBkashIdToken(): Promise<string> {
  const now = Date.now();
  if (cachedBkashToken && bkashTokenExpiresAt > now + 60000) {
    return cachedBkashToken;
  }

  const appKey = process.env.BKASH_APP_KEY;
  const appSecret = process.env.BKASH_APP_SECRET;
  const username = process.env.BKASH_USERNAME;
  const password = process.env.BKASH_PASSWORD;

  if (!appKey || !appSecret || !username || !password) {
    throw new Error('bKash merchant credentials are not fully configured');
  }

  const res = await fetch(`${BKASH_BASE_URL}/auth/grant-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      username,
      password,
    },
    body: JSON.stringify({
      app_key: appKey,
      app_secret: appSecret,
    }),
  });

  const data: any = await res.json();
  if (!res.ok || data.statusCode !== '0000') {
    throw new Error(data.statusMessage || 'Failed to obtain bKash ID token');
  }

  if (typeof data.id_token !== 'string' || !data.id_token) {
    throw new Error('bKash token response did not contain an authorization token');
  }
  cachedBkashToken = data.id_token;
  bkashTokenExpiresAt = now + (parseInt(data.expires_in, 10) || 3600) * 1000;
  return cachedBkashToken!;
}

/**
 * Initiate bKash Payment
 */
export async function initiateBkashPayment(params: {
  amount: number;
  orderNumber: string;
  callbackUrl: string;
}): Promise<GatewayInitiationResult> {
  const { amount, orderNumber, callbackUrl } = params;

  if (
    !process.env.BKASH_APP_KEY ||
    !process.env.BKASH_APP_SECRET ||
    !process.env.BKASH_USERNAME ||
    !process.env.BKASH_PASSWORD
  ) {
    return {
      success: false,
      gateway: 'bkash',
      amount,
      currency: 'BDT',
      requiresRedirect: false,
      error: 'bKash merchant credentials (app key, app secret, username, and password) are not configured',
    };
  }

  try {
    const idToken = await getBkashIdToken();
    const appKey = process.env.BKASH_APP_KEY;

    const res = await fetch(`${BKASH_BASE_URL}/payment/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: idToken,
        'X-APP-Key': appKey,
      },
      body: JSON.stringify({
        payerReference: orderNumber,
        callbackURL: callbackUrl,
        amount: amount.toFixed(2),
        currency: 'BDT',
        intent: 'sale',
        merchantInvoiceNumber: orderNumber,
      }),
    });

    const data: any = await res.json();
    const redirectUrl = typeof data.bKashURL === 'string' ? data.bKashURL : '';
    if (!res.ok || !data.paymentId || !redirectUrl.startsWith('https://')) {
      return {
        success: false,
        gateway: 'bkash',
        amount,
        currency: 'BDT',
        requiresRedirect: false,
        error: data.errorMessageEn || 'bKash payment initiation rejected',
      };
    }

    return {
      success: true,
      gateway: 'bkash',
      paymentId: data.paymentId,
      redirectUrl,
      transactionRef: data.paymentId,
      amount,
      currency: 'BDT',
      requiresRedirect: true,
    };
  } catch (error: any) {
    return {
      success: false,
      gateway: 'bkash',
      amount,
      currency: 'BDT',
      requiresRedirect: false,
      error: 'bKash payment initiation could not be completed',
    };
  }
}

/**
 * Server-to-server execute and query fallback for bKash payments.
 */
export async function verifyBkashPayment(paymentId: string): Promise<GatewayVerificationResult> {
  try {
    const idToken = await getBkashIdToken();
    const headers = {
      'Content-Type': 'application/json',
      Authorization: idToken,
      'X-App-Key': process.env.BKASH_APP_KEY!,
    };

    let response: any;
    try {
      const executeResponse = await fetch(`${BKASH_BASE_URL}/payment/execute`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ paymentId }),
      });
      response = await executeResponse.json();
      if (!executeResponse.ok || response.transactionStatus !== 'Completed') {
        const queryResponse = await fetch(`${BKASH_BASE_URL}/query/payment`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ paymentId }),
        });
        if (!queryResponse.ok) {
          throw new Error('bKash payment status is not yet confirmed');
        }
        response = await queryResponse.json();
      }
    } catch {
      return {
        success: false,
        paymentId,
        gateway: 'bkash',
        status: 'pending',
        error: 'bKash payment status is uncertain; retry verification before retrying payment',
      };
    }

    const responsePaymentId = response.paymentId;
    const orderNumber = response.merchantInvoiceNumber || response.merchantInvoice;
    const transactionId = response.trxId;
    const amount = Number(response.amount);

    if (
      response.transactionStatus === 'Completed' &&
      responsePaymentId === paymentId &&
      typeof orderNumber === 'string' &&
      transactionId &&
      Number.isFinite(amount) &&
      response.currency
    ) {
      return {
        success: true,
        paymentId: responsePaymentId,
        transactionId,
        orderNumber,
        amount,
        currency: response.currency,
        gateway: 'bkash',
        status: 'paid',
        rawResponse: response,
      };
    }

    if (response.transactionStatus === 'Initiated' && responsePaymentId === paymentId) {
      return {
        success: false,
        paymentId,
        orderNumber,
        amount,
        currency: response.currency,
        gateway: 'bkash',
        status: 'failed',
        error: 'bKash Query Payment confirms this attempt remains Initiated; a new attempt may be started',
        rawResponse: response,
      };
    }

    return {
      success: false,
      paymentId,
      gateway: 'bkash',
      status: 'pending',
      error: 'bKash payment status is uncertain; retry verification before retrying payment',
    };
  } catch {
    return {
      success: false,
      paymentId,
      gateway: 'bkash',
      status: 'pending',
      error: 'bKash payment status is uncertain; retry verification before retrying payment',
    };
  }
}

/**
 * -------------------------------------------------------------
 * 2. SSLCOMMERZ Payment Integration
 * -------------------------------------------------------------
 */
const SSLCOMMERZ_BASE_URL =
  process.env.NODE_ENV === 'production' && !process.env.SSLCOMMERZ_IS_SANDBOX
    ? 'https://securepay.sslcommerz.com'
    : 'https://sandbox.sslcommerz.com';

export async function initiateSslcommerzPayment(params: {
  amount: number;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  address: string;
  city: string;
  successUrl: string;
  failUrl: string;
  cancelUrl: string;
  ipnUrl: string;
}): Promise<GatewayInitiationResult> {
  const storeId = process.env.SSLCOMMERZ_STORE_ID;
  const storePasswd = process.env.SSLCOMMERZ_STORE_PASSWD;

  if (!storeId || !storePasswd) {
    return {
      success: false,
      gateway: 'sslcommerz',
      amount: params.amount,
      currency: 'BDT',
      requiresRedirect: false,
      error: 'SSLCOMMERZ credentials (SSLCOMMERZ_STORE_ID / SSLCOMMERZ_STORE_PASSWD) are not set in .env',
    };
  }

  try {
    const formData = new URLSearchParams();
    formData.append('store_id', storeId);
    formData.append('store_passwd', storePasswd);
    formData.append('total_amount', params.amount.toFixed(2));
    formData.append('currency', 'BDT');
    formData.append('tran_id', params.orderNumber);
    formData.append('success_url', params.successUrl);
    formData.append('fail_url', params.failUrl);
    formData.append('cancel_url', params.cancelUrl);
    formData.append('ipn_url', params.ipnUrl);
    formData.append('cus_name', params.customerName);
    formData.append('cus_email', params.customerEmail);
    formData.append('cus_add1', params.address);
    formData.append('cus_city', params.city);
    formData.append('cus_country', 'Bangladesh');
    formData.append('cus_phone', params.customerPhone);
    formData.append('shipping_method', 'NO');
    formData.append('product_name', 'Novara Commerce Order');
    formData.append('product_category', 'Retail');
    formData.append('product_profile', 'general');

    const res = await fetch(`${SSLCOMMERZ_BASE_URL}/gwprocess/v4/api.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    });

    const data: any = await res.json();
    if (data.status === 'SUCCESS' && data.GatewayPageURL) {
      return {
        success: true,
        gateway: 'sslcommerz',
        paymentId: data.sessionkey,
        redirectUrl: data.GatewayPageURL,
        transactionRef: params.orderNumber,
        amount: params.amount,
        currency: 'BDT',
        requiresRedirect: true,
      };
    }

    return {
      success: false,
      gateway: 'sslcommerz',
      amount: params.amount,
      currency: 'BDT',
      requiresRedirect: false,
      error: data.failedreason || 'SSLCOMMERZ initiation rejected',
    };
  } catch (err: any) {
    return {
      success: false,
      gateway: 'sslcommerz',
      amount: params.amount,
      currency: 'BDT',
      requiresRedirect: false,
      error: err.message,
    };
  }
}

/**
 * Server-to-Server SSLCOMMERZ Validation API
 */
export async function verifySslcommerzPayment(valId: string): Promise<GatewayVerificationResult> {
  const storeId = process.env.SSLCOMMERZ_STORE_ID;
  const storePasswd = process.env.SSLCOMMERZ_STORE_PASSWD;

  if (!storeId || !storePasswd) {
    throw new Error('SSLCOMMERZ credentials are not configured');
  }

  const queryUrl = `${SSLCOMMERZ_BASE_URL}/validator/api/validationserverAPI.php?val_id=${encodeURIComponent(
    valId
  )}&store_id=${encodeURIComponent(storeId)}&store_passwd=${encodeURIComponent(storePasswd)}&v=1&format=json`;

  const res = await fetch(queryUrl);
  const data: any = await res.json();

  if (data.status === 'VALID' || data.status === 'VALIDATED') {
    return {
      success: true,
      paymentId: valId,
      transactionId: data.bank_tran_id || data.tran_id,
      orderNumber: data.tran_id,
      amount: parseFloat(data.amount),
      currency: data.currency,
      gateway: 'sslcommerz',
      status: 'paid',
      rawResponse: data,
    };
  }

  return {
    success: false,
    paymentId: valId,
    transactionId: data.bank_tran_id || '',
    orderNumber: data.tran_id || '',
    amount: parseFloat(data.amount || '0'),
    currency: data.currency || 'BDT',
    gateway: 'sslcommerz',
    status: 'failed',
    error: data.error || 'SSLCOMMERZ payment validation failed',
    rawResponse: data,
  };
}

/**
 * Nagad is fail-closed until official merchant signing and encryption credentials
 * and the matching provider integration are supplied.
 */
export async function initiateNagadPayment(params: {
  amount: number;
  orderNumber: string;
  callbackUrl: string;
  customerPhone?: string;
}): Promise<GatewayInitiationResult> {
  return {
    success: false,
    gateway: 'nagad',
    amount: params.amount,
    currency: 'BDT',
    requiresRedirect: false,
    error: 'Nagad online payment is disabled until an official merchant integration is configured',
  };
}

export async function verifyNagadPayment(paymentRefId: string): Promise<GatewayVerificationResult> {
  if (!paymentRefId || !paymentRefId.trim()) {
    return {
      success: false,
      status: 'failed',
      error: 'Payment reference ID is required for verification',
    };
  }

  return {
    success: false,
    paymentId: paymentRefId,
    gateway: 'nagad',
    status: 'pending',
    error: 'Nagad online payment verification is unavailable until an official merchant integration is configured',
  };
}
