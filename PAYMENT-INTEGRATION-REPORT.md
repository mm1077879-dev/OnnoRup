# Payment System Audit and Readiness Report

**Application:** NOVARA COMMERCE / ShopMax  
**Audit date:** 2026-11-06  
**Scope:** bKash, Nagad, Cash on Delivery (COD), and the directly related admin and financial reporting paths

## Executive summary

The application has a server-side bKash Tokenized Checkout API v2 flow and a separate COD collection lifecycle. Nagad is deliberately unavailable: the code does not implement its authenticated merchant signing/encryption flow. No bKash or Nagad merchant credentials are configured in the inspected local environment, so neither sandbox nor live money movement was tested. Do not treat this environment as production-payment-ready.

The audit corrected order-level payment locking, payment-order authorization, concurrent initiation races, unsafe COD-to-gateway switching, the bKash environment selector, misleading gateway readiness reporting, and a missing Admin Dashboard COD-collection callback.

## bKash

- The backend obtains an ID token, creates a hosted payment, then executes or queries the provider transaction during verification.
- A browser redirect alone does not set an order to paid. Server verification must match the order reference, initiated payment ID, amount, BDT currency, gateway, and provider transaction ID.
- The selected sandbox/live base URL now honors `BKASH_IS_SANDBOX` when set; otherwise it follows the `NODE_ENV`-based default.
- The backend uses Query Payment after an inconclusive execute call. Its documented `Initiated` result is treated as a failed/cancelled attempt, so a new attempt is allowed only after that provider-side query confirms the state.
- Merchant credentials were absent in the inspected `.env`. No provider request or real transaction was performed; live merchant access and callback configuration remain unverified.

## Nagad

- Online Nagad is disabled in checkout and backend configuration.
- The existing functions explicitly fail closed because authenticated merchant signing, encryption, and provider verification are not implemented.
- Environment variable names alone do not establish merchant authorization. No Nagad request or transaction was attempted. Integration remains blocked on the official merchant integration and credentials.

## Cash on Delivery

- New orders start with `paymentStatus: unpaid`; checkout does not record COD as received.
- An authorized admin, order manager, or finance user can record collection only after the order reaches `delivered`.
- The backend records the actor and time, and uses an atomic conditional update to reject duplicate collection. The dashboard now passes its existing collection handler to the order-details modal.

## Persistence, authorization, and idempotency

- Order records remain the source of truth. They store method, status, amount, currency, provider reference, paid time, and COD collector/time. A separate payment-ledger model does not exist; event history is represented in the order timeline.
- MongoDB payment-lock fields are now declared in the order schema, allowing the existing atomic lease to serialize verification and initiation operations.
- Online orders receive a random access token at creation. Only its SHA-256 hash is persisted; the token is returned separately and kept in the checkout session for guest verification/retry. Authenticated owners can also authorize through their account.
- Initiation re-reads the order while holding the lock, blocks concurrent initiation, prevents changing a COD order to an online gateway, and permits switching an online gateway only after a failed attempt.
- Failed payment timeline entries now retain the provider reference for reconciliation.

## Admin and financial reporting

- Admin order details show method, payment status, transaction reference, and COD collection metadata.
- COD collection remains an explicit post-delivery admin action; it is not coupled to order confirmation or delivery status updates.
- System integration status now uses the same complete credential/enablement checks as checkout instead of treating a provider name or single bKash key as a configured gateway.
- Revenue calculations use `isPaymentReceiptVerified`: online orders require `paid` plus a transaction ID; COD additionally requires a recorded collection time. Pending, failed, and uncollected COD orders are excluded from received revenue.
- No refund provider flow or separate reconciliation ledger was verified. The current payment status model remains `unpaid`, `paid`, `failed`, and `refunded`; it does not persist separate cancelled/expired attempt states.

## Verification performed

- Automated tests: **112 passed, 0 failed**.
- Production frontend build: **passed** (Vite emitted existing configuration and large-chunk warnings).
- TypeScript check initially identified a missing COD callback on the Admin Dashboard order modal; that directly related wiring defect was fixed. Final `npm run lint` passed.
- No sandbox or production provider transaction was performed because valid merchant credentials were not configured.

## Production readiness

| Area | Result |
|---|---|
| COD order creation and collection workflow | Implemented; collection requires authorized post-delivery confirmation |
| bKash backend flow | Implemented; awaiting merchant credentials and sandbox/live verification |
| Nagad | Blocked; official authenticated integration and credentials are required |
| Live payment capability | Not verified; do not claim live readiness |
| Financial reporting | Uses verified receipt criteria; a dedicated payment ledger/reconciliation process is not present |

Before enabling live payment, configure authorized merchant credentials, explicitly select the bKash environment, confirm HTTPS callback URLs with the provider, and execute provider-approved sandbox tests for success, failure, cancellation, timeout, retry, and duplicate callbacks.

## Provider documentation consulted

- [bKash Create Payment](https://developer.bka.sh/docs/create-payment-3.md)
- [bKash Execute Payment](https://developer.bka.sh/docs/execute-payment-4.md)
- [bKash Query Payment](https://developer.bka.sh/docs/query-payment.md)
