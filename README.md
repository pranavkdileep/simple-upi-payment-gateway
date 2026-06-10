```txt
npm install
npm run dev
```

```txt
npm run deploy
```

[For generating/synchronizing types based on your Worker configuration run](https://developers.cloudflare.com/workers/wrangler/commands/#types):

```txt
npm run cf-typegen
```

Pass the `CloudflareBindings` as generics when instantiating `Hono`:

```ts
// src/index.ts
const app = new Hono<{ Bindings: CloudflareBindings }>()
```

## API Reference

All API routes are prefixed with `/api` and require a `Bearer` token in the `Authorization` header, except where noted.

**Authentication:** Set the `api_secret` in the KV namespace. Include it as `Authorization: Bearer <secret>`.

---

### `POST /api/create-order`

Create a new payment order. Uses slot-based amount allocation: if the exact amount is taken by an existing waiting order, it increments by 1 paisa up to 100 attempts until a free slot is found.

  **Request body:**
  ```json
  { "amount": 100.50 }
  ```

  **Response `200`:**
  ```json
  {
    "amount": 100.51,
    "orderId": 1,
    "upiIntent": "upi://pay?pa=example@upi&am=100.51&tn=ORDER1&cu=INR"
  }
  ```

| Field | Type | Description |
|---|---|---|
| `amount` | number | Actual order amount (may differ by a few paise from requested) |
| `orderId` | number | Auto-generated order ID |
| `upiIntent` | string | Ready-to-use UPI deep link for payment |

**Errors:** `400` invalid amount, `409` no payment slots available or UPI ID not configured, `401` unauthorized, `500` missing secret.

---

### `POST /api/timeout-orders`

Mark all waiting orders older than 10 minutes as `timeout`. Fires `order.timeout` webhooks for each.

**Response `200`:**
```json
{ "timedOut": 2, "orderIds": [1, 3] }
```

---

### `GET /api/order/:id`

Fetch a single order by its ID.

**Response `200`:**
```json
{
  "order_id": 1,
  "amount": 100.50,
  "status": "waiting",
  "uid": null,
  "payer_name": null,
  "created_at": "2025-01-01T00:00:00.000Z",
  "paid_at": null
}
```

**Errors:** `404` order not found.

---

### `POST /api/test-webhook`

Send a test webhook event (`test` event type). Does **not** require authentication.

**Response `200`:**
```json
{ "ok": true }
```

---

### `GET /message`

Health-check endpoint. Does not require authentication.

**Response:** `200 text/plain` `Hello Hono!!`

---

## Dashboard Routes

The web dashboard is served at `/dashboard` (HTML). These routes are **not** API endpoints and return HTML pages.

| Route | Method | Auth | Description |
|---|---|---|---|
| `/dashboard/login` | GET | No | Login page |
| `/dashboard/login` | POST | Form body | Authenticate and set session cookie |
| `/dashboard/logout` | GET | No | Clear session and redirect to login |
| `/dashboard` | GET | Session cookie | Dashboard overview (orders, payments, config) |
| `/dashboard/kv` | POST | Session cookie | Update a KV config key |
| `/dashboard/timeout-orders` | POST | Session cookie | Run timeout sweep from dashboard |

## Email Handler (non-HTTP)

The worker's `email()` handler ingests inbound email from `noreply@slice.bank.in`, parses the UPI transaction details (amount, RRN, payer name, date) and matches it against a waiting order with a matching amount. On match, the order status is set to `success` and an `order.success` webhook is fired.

## Webhooks

Webhooks notify external systems when order state changes. Configure them via the dashboard or by setting KV keys directly.

### Configuration

| KV Key | Required | Description |
|---|---|---|
| `webhook_url` | Yes | HTTPS endpoint that receives webhook POST requests |
| `webhook_secret` | No | Value sent in the `X-Webhook-Secret` header for receiver verification |

### Delivery

Webhooks are fire-and-forget POST requests. Failures are silently discarded — no retry logic is implemented.

### Request Format

```http
POST <webhook_url>
Content-Type: application/json
X-Webhook-Secret: <webhook_secret>  
```

```json
{
  "event": "order.success",
  "order": {
    "order_id": 1,
    "amount": 100.50,
    "status": "success",
    "paid_at": "2025-01-01T00:00:00.000Z"
  }
}
```

The payload always contains an `event` field plus the event-specific data as additional top-level keys.

### Events

| Event | Trigger | Payload |
|---|---|---|
| `order.success` | An incoming payment matched a waiting order | `{ "order": { order_id, amount, status, paid_at } }` |
| `order.timeout` | Timeout sweep marks a waiting order as timed out | `{ "order": { order_id, amount, status, created_at, ... } }` |
| `test` | Manual via `POST /api/test-webhook` | `{ "message": "Webhook test" }` |
