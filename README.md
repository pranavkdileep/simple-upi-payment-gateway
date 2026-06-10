# Slice UPI Gateway

Cloudflare Worker based UPI payment gateway for Slice bank credit notification emails.

It creates short-lived UPI payment orders, assigns collision-free payable amounts, listens for Slice bank email notifications, matches incoming payments to waiting orders, updates order state in D1, and sends webhooks to your application.

## What It Does

- Creates UPI payment orders through an authenticated API.
- Generates ready-to-use `upi://pay` intents.
- Uses amount slotting to avoid multiple open orders having the same payable amount.
- Receives Slice bank notification emails from `noreply@slice.bank.in`.
- Parses payer name, amount, RRN, and transaction date from the email.
- Matches successful payments to waiting orders by amount.
- Marks stale waiting orders as `timeout` after 10 minutes.
- Sends webhook events for `order.success`, `order.timeout`, and `test`.
- Provides an HTML operator dashboard for viewing orders, payments, and runtime config.

## Stack

| Layer | Tech |
|---|---|
| Runtime | Cloudflare Workers |
| HTTP framework | Hono |
| Database | Cloudflare D1 |
| Runtime config | Cloudflare KV |
| Email parsing | `postal-mime` + custom Slice parser |
| Dashboard | Server-rendered HTML from the Worker |

## Project Structure

```txt
src/
  index.ts       HTTP API routes and inbound email handler
  orders.ts      Order creation and UPI intent generation
  webhook.ts     Webhook delivery and retry handling
  dashboard.ts   HTML dashboard routes
  parser.ts      Slice email parser
  log.ts         D1 logging helper
schema.sql       D1 schema
wrangler.jsonc   Cloudflare Worker configuration
```

## Quick Start

Install dependencies:

```txt
npm install
```

Run locally with Wrangler:

```txt
npm run dev
```

Deploy to Cloudflare:

```txt
npm run deploy
```

Generate Cloudflare binding types:

```txt
npm run cf-typegen
```

## Cloudflare Bindings

The Worker expects these bindings:

| Binding | Type | Purpose |
|---|---|---|
| `prod_d1_db_slice_upi_gateway` | D1Database | Stores orders, payments, and logs |
| `sclice_upi_gateway_namespace` | KVNamespace | Stores API secret, UPI ID, and webhook settings |
| `USERNAME` | Worker var | Dashboard username |
| `PASSWORD` | Worker var | Dashboard password |

## KV Configuration

These keys are read from `sclice_upi_gateway_namespace`.

| Key | Required | Used By | Description |
|---|---|---|---|
| `api_secret` | Yes | Protected API routes | Bearer token for `/api/*` endpoints |
| `upi_id` | Yes | `POST /api/create-order` | Merchant/payee UPI ID used in generated UPI intents |
| `webhook_url` | No | Webhook delivery | Destination URL for webhook POST requests |
| `webhook_secret` | No | Webhook delivery | Shared secret sent in `X-Webhook-Secret` header |

You can update these from the dashboard at `/dashboard`, or directly in Cloudflare KV.

## Database Schema

The database schema is defined in `schema.sql`.

### `Orders`

Stores created payment orders.

| Column | Description |
|---|---|
| `order_id` | Auto-increment order ID |
| `amount` | Payable amount assigned to the order |
| `status` | `waiting`, `success`, or `timeout` |
| `created_at` | Creation timestamp |
| `uid` | Payment RRN/UID after match |
| `payer_name` | Payer name after match |
| `paid_at` | Payment match timestamp |

Only one `waiting` order can exist for the same `amount` because of the partial unique index on waiting order amounts.

### `Payments`

Stores incoming Slice payment notifications.

| Column | Description |
|---|---|
| `payment_id` | Auto-increment payment ID |
| `amount` | Received amount |
| `uid` | RRN from Slice email, unique |
| `payer_name` | Payer name parsed from Slice email |
| `received_at` | Insert timestamp |
| `note` | Processing note such as `no_matching_order` |
| `matched_order_id` | Linked order ID when a match is found |

### `Logs`

Stores operational logs such as email rejections, payment match issues, and webhook failures.

## Authentication

Protected API endpoints use bearer-token authentication.

```http
Authorization: Bearer <api_secret>
```

If `api_secret` is missing from KV, protected endpoints return:

```json
{ "error": "API secret not configured" }
```

If the token is wrong or missing, protected endpoints return:

```json
{ "error": "Unauthorized" }
```

## API Reference

Base URL examples below use:

```txt
https://your-worker.your-subdomain.workers.dev
```

### `POST /api/create-order`

Create a new payment order and return a UPI deep link.

Requires authentication.

#### Amount Slotting

To make payment matching deterministic, each open waiting order must have a unique amount.

If you request `100.00` and another waiting order already exists for `100.00`, the gateway tries `100.01`, then `100.02`, up to 100 paisa slots. The first available amount is inserted as a waiting order.

#### Request

```http
POST /api/create-order
Authorization: Bearer <api_secret>
Content-Type: application/json
```

```json
{
  "amount": 100.5
}
```

#### Success Response

```json
{
  "amount": 100.5,
  "orderId": 1,
  "upiIntent": "upi://pay?pa=merchant%40upi&am=100.5&tn=ORDER1&cu=INR"
}
```

#### Response Fields

| Field | Type | Description |
|---|---|---|
| `amount` | number | Actual payable amount assigned to the order. This can be slightly higher than the requested amount because of amount slotting. |
| `orderId` | number | Created order ID. |
| `upiIntent` | string | UPI deep link containing `pa`, `am`, `tn`, and `cu`. |

#### Errors

| Status | Response | Meaning |
|---|---|---|
| `400` | `{ "error": "Invalid amount." }` | Amount is missing, not a number, or not greater than zero. |
| `401` | `{ "error": "Unauthorized" }` | Bearer token is missing or incorrect. |
| `409` | `{ "error": "No payment slots available. Please retry after a few minutes." }` | All 100 amount slots are occupied by waiting orders. |
| `409` | `{ "error": "UPI ID not configured." }` | `upi_id` is missing in KV. |
| `500` | `{ "error": "API secret not configured" }` | `api_secret` is missing in KV. |

#### cURL

```bash
curl -X POST "https://your-worker.your-subdomain.workers.dev/api/create-order" \
  -H "Authorization: Bearer <api_secret>" \
  -H "Content-Type: application/json" \
  -d '{"amount":100.5}'
```

### `GET /api/order/:id`

Fetch one order by ID.

Requires authentication.

#### Request

```http
GET /api/order/1
Authorization: Bearer <api_secret>
```

#### Success Response

```json
{
  "order_id": 1,
  "amount": 100.5,
  "status": "waiting",
  "created_at": "2026-06-10 12:00:00",
  "uid": null,
  "payer_name": null,
  "paid_at": null
}
```

#### Status Values

| Status | Meaning |
|---|---|
| `waiting` | Order is open and waiting for payment. |
| `success` | Payment email was received and matched. |
| `timeout` | Order was waiting for at least 10 minutes and was swept as timed out. |

#### Errors

| Status | Response | Meaning |
|---|---|---|
| `401` | `{ "error": "Unauthorized" }` | Bearer token is missing or incorrect. |
| `404` | `{ "error": "Order not found" }` | No order exists for the requested ID. |
| `500` | `{ "error": "API secret not configured" }` | `api_secret` is missing in KV. |

### `POST /api/timeout-orders`

Mark stale waiting orders as timed out.

Requires authentication.

This updates every order where:

- `status = 'waiting'`
- age is at least 10 minutes

Each timed-out order triggers an `order.timeout` webhook.

#### Request

```http
POST /api/timeout-orders
Authorization: Bearer <api_secret>
```

#### Success Response

```json
{
  "timedOut": 2,
  "orderIds": [1, 3]
}
```

#### cURL

```bash
curl -X POST "https://your-worker.your-subdomain.workers.dev/api/timeout-orders" \
  -H "Authorization: Bearer <api_secret>"
```

### `POST /api/test-webhook`

Send a test webhook event.

Does not require bearer authentication.

#### Request

```http
POST /api/test-webhook
```

#### Success Response

```json
{ "ok": true }
```

#### Webhook Sent

```json
{
  "event": "test",
  "message": "Webhook test"
}
```

#### Errors

| Status | Response | Meaning |
|---|---|---|
| `500` | `{ "error": "Webhook namespace not configured" }` | KV namespace binding is unavailable. |

### `GET /message`

Simple health-check endpoint.

Does not require authentication.

#### Response

```txt
Hello Hono!!
```

## Webhooks

Webhooks are used to notify your application about payment and timeout events.

### Configuration

Set these KV keys:

| Key | Required | Description |
|---|---|---|
| `webhook_url` | Yes, to enable webhooks | Destination URL that receives webhook POST requests. |
| `webhook_secret` | No | Shared secret sent in the `X-Webhook-Secret` request header. |

If `webhook_url` is not configured, webhook delivery is skipped.

### Delivery Contract

Every webhook is sent as:

```http
POST <webhook_url>
Content-Type: application/json
X-Webhook-Secret: <webhook_secret>
```

`X-Webhook-Secret` is only included when `webhook_secret` exists in KV.

### Success Acknowledgement

The receiver must return JSON with `success: true`.

```json
{ "success": true }
```

Any other response body, invalid JSON, network failure, or thrown error is treated as a failed attempt.

### Retry Behavior

The gateway attempts delivery up to 3 times.

If all 3 attempts fail, it writes a D1 log entry:

```txt
status: WebhookFail
message: Webhook failed after 3 attempts: <event> -> <webhook_url>
```

### Events

| Event | Trigger |
|---|---|
| `order.success` | A Slice email is parsed and matched to a waiting order. |
| `order.timeout` | Timeout sweep marks a waiting order as timed out. |
| `test` | `POST /api/test-webhook` is called. |

### `order.success` Payload

```json
{
  "event": "order.success",
  "order": {
    "order_id": 1,
    "amount": 100.5,
    "status": "success",
    "paid_at": "2026-06-10T12:00:00.000Z"
  }
}
```

### `order.timeout` Payload

```json
{
  "event": "order.timeout",
  "order": {
    "order_id": 1,
    "amount": 100.5,
    "status": "timeout",
    "created_at": "2026-06-10 11:45:00",
    "uid": null,
    "payer_name": null,
    "paid_at": null
  }
}
```

### `test` Payload

```json
{
  "event": "test",
  "message": "Webhook test"
}
```

### Example Receiver

```ts
app.post("/webhook", async (req, res) => {
  if (req.header("X-Webhook-Secret") !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ success: false });
  }

  const payload = req.body;

  if (payload.event === "order.success") {
    // Mark your internal order as paid.
  }

  return res.json({ success: true });
});
```

## Email Payment Flow

The Worker exposes an `email()` handler for Cloudflare Email Workers.

### Accepted Sender

Only emails from this sender are processed:

```txt
noreply@slice.bank.in
```

All other senders are rejected and logged to D1.

### Parsed Fields

The Slice email parser extracts:

| Field | Source |
|---|---|
| `amount` | `received ₹... via UPI` text |
| `name` | `From` table cell |
| `rrn` | `RRN` table cell |
| `date` | `Transaction date` table cell |

### Matching Logic

1. Insert the incoming payment into `Payments` with amount, RRN, and payer name.
2. Find the oldest `waiting` order with the exact same paise amount.
3. If no order matches, mark the payment note as `no_matching_order` and log `NoMatch`.
4. If an order matches, update it to `success`, store RRN and payer name, and set `paid_at`.
5. Link the payment to the matched order.
6. Fire an `order.success` webhook.
7. Log the successful update to D1.

## Dashboard

The dashboard is available at:

```txt
/dashboard
```

It uses `USERNAME` and `PASSWORD` Worker vars for login and stores a session cookie named `dashboard_session`.

### Dashboard Routes

| Route | Method | Description |
|---|---|---|
| `/dashboard/login` | GET | Login page |
| `/dashboard/login` | POST | Authenticate and create dashboard session |
| `/dashboard/logout` | GET | Clear session cookie |
| `/dashboard` | GET | Dashboard home with order/payment tables and config |
| `/dashboard/kv` | POST | Save a KV config key |
| `/dashboard/timeout-orders` | POST | Run timeout sweep from dashboard |

### Dashboard Features

- View counts for waiting, successful, and timed-out orders.
- View recent orders with pagination.
- View recent payments with pagination.
- Update runtime KV keys: `api_secret`, `upi_id`, `webhook_url`, and `webhook_secret`.
- Manually run the timeout sweep.

## Order Lifecycle

```txt
POST /api/create-order
        |
        v
Orders.status = waiting
        |
        | Slice email received and amount matches
        v
Orders.status = success  ->  order.success webhook

or

waiting for 10+ minutes
        |
        v
POST /api/timeout-orders or dashboard timeout sweep
        |
        v
Orders.status = timeout  ->  order.timeout webhook
```

## Operational Notes

- Payment matching is amount-based, so amount slotting is important for avoiding ambiguity.
- Waiting order amounts are unique at the database level.
- Incoming payment RRN values are unique in `Payments`.
- Timeout is not automatic unless you call `/api/timeout-orders`, use the dashboard button, or schedule a caller.
- Webhook receivers must return `{ "success": true }` for delivery to be considered successful.
- Failed webhook deliveries are logged after 3 attempts.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start local Wrangler dev server |
| `npm run deploy` | Deploy Worker with minification |
| `npm run cf-typegen` | Generate Cloudflare binding types |

## Hono Binding Type

Pass the Cloudflare bindings as generics when creating the Hono app:

```ts
const app = new Hono<{ Bindings: CloudflareBindings }>();
```
