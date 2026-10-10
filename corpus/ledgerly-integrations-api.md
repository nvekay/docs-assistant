# Ledgerly: integrations and API

## Online payments

Connect Stripe or PayPal in Settings > Payments so clients can pay invoices by card or PayPal. When a payment succeeds, the invoice is marked Paid automatically. Ledgerly does not charge a fee on top of the payment provider's fees.

## Accounting software

Ledgerly can sync paid invoices to QuickBooks Online and Xero once a day. Connect them in Settings > Integrations. Only invoices with the status Paid are synced, and each invoice is synced once.

## API

The Ledgerly REST API is available on the Pro and Team plans. Create an API key in Settings > API keys; the key is shown only once, so store it securely. Send it in the Authorization header as "Bearer" followed by the key.

The API is limited to 60 requests per minute per key. Requests over the limit receive HTTP status 429 with a Retry-After header.

## Webhooks

Webhooks notify your server when something happens, for example invoice.sent, invoice.viewed and invoice.paid. Add an endpoint URL in Settings > Webhooks. Each request is signed with an HMAC-SHA256 signature in the Ledgerly-Signature header, so you can verify that it came from Ledgerly. Failed deliveries are retried for up to 24 hours.
