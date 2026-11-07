import { createHash, randomBytes, timingSafeEqual } from 'crypto';

const PAYMENT_ACCESS_TOKEN_PATTERN = /^[a-f0-9]{64}$/i;

export function createPaymentAccessToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashPaymentAccessToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function matchesPaymentAccessToken(token: unknown, tokenHash: unknown): boolean {
  if (
    typeof token !== 'string' ||
    typeof tokenHash !== 'string' ||
    !PAYMENT_ACCESS_TOKEN_PATTERN.test(token) ||
    !PAYMENT_ACCESS_TOKEN_PATTERN.test(tokenHash)
  ) {
    return false;
  }

  const candidateHash = Buffer.from(hashPaymentAccessToken(token), 'hex');
  const expectedHash = Buffer.from(tokenHash, 'hex');
  return timingSafeEqual(candidateHash, expectedHash);
}
