import { Hono } from "hono";
import { parseSliceEmail } from "./parser";
import PostalMime from "postal-mime";
import { logToD1 } from "./log";

interface CloudflareBindings {
  prod_d1_db_slice_upi_gateway: D1Database;
}

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.get("/message", (c) => {
  return c.text("Hello Hono!");
});

export default {
  fetch: app.fetch,

  async email(message: ForwardableEmailMessage, env: any, ctx: ExecutionContext) {
    try {
      
      const rawBuffer = await new Response(message.raw).arrayBuffer();
      const parsedMime = await new PostalMime().parse(rawBuffer);
      const sender = parsedMime.from?.address || "Unknown Sender";
      if (sender !== "noreply@slice.bank.in") {
        logToD1(env.prod_d1_db_slice_upi_gateway, "Unauthorized sender: " + sender, "Rejected");
        message.setReject("Unauthorized sender: " + sender);
        return;
      }

      const rawHtml =
        typeof parsedMime.html === "string"
          ? parsedMime.html
          : typeof parsedMime.text === "string"
            ? parsedMime.text
            : "";
      const parsed = parseSliceEmail(rawHtml);
      if (!parsed) {
        logToD1(env.prod_d1_db_slice_upi_gateway, "Failed to parse email content.", "Rejected");
        message.setReject("Failed to parse email content.");
        return;
      }
      else if (!parsed.amount || !parsed.rrn || !parsed.date || !parsed.name) {
        logToD1(env.prod_d1_db_slice_upi_gateway, "Missing required transaction details.", "Rejected");
        message.setReject("Missing required transaction details.");
        return;
      }
      else if (parsed.amount <= 0 || !/^\d{12}$/.test(parsed.rrn) || isNaN(Date.parse(parsed.date.toISOString()))) {
        logToD1(env.prod_d1_db_slice_upi_gateway, "Invalid transaction details.", "Rejected");
        message.setReject("Invalid transaction.");
        return;
      }
      // save to payments table 
      env.prod_d1_db_slice_upi_gateway.prepare(`INSERT INTO Payments (amount, uid, payer_name) VALUES (?, ?, ?)`)
        .bind(parsed.amount, parsed.rrn, parsed.name)
        .run();

      const updatedOrder = env.prod_d1_db_slice_upi_gateway.prepare(
        `WITH matching_orders AS (
          SELECT id FROM orders 
          WHERE status = 'waiting' AND amount = ?
        ),
        order_count AS (
          SELECT COUNT(*) as cnt FROM matching_orders
        ),
        update_single AS (
          UPDATE orders 
          SET status = 'success', uid = ?, payer_name = ?, paid_at = datetime('now')
          WHERE status = 'waiting' AND amount = ? AND id IN (
            SELECT id FROM matching_orders WHERE (SELECT cnt FROM order_count) = 1
          )
          RETURNING id
        ),
        mark_ambiguous AS (
          UPDATE Payments
          SET note = 'ambiguous'
          WHERE uid = ? AND (SELECT cnt FROM order_count) > 1
          RETURNING 1 as dummy
        ),
        update_payment_with_order AS (
          UPDATE Payments
          SET matched_order_id = (SELECT id FROM update_single LIMIT 1)
          WHERE uid = ? AND (SELECT cnt FROM order_count) = 1
          RETURNING 1 as dummy
        )
        SELECT 
          CASE 
            WHEN (SELECT cnt FROM order_count) = 1 THEN (SELECT id FROM update_single LIMIT 1)
            ELSE NULL
          END as orderId`
      ).bind(parsed.amount, parsed.rrn, parsed.name, parsed.amount, parsed.rrn, parsed.rrn)
      .first()

      await message.forward("pkdartyt@gmail.com")
    } catch (error) {
      logToD1(env.prod_d1_db_slice_upi_gateway, error as string, "Error");
      console.error("Email forwarding failed:", error)
      message.setReject("Internal forwarding error occurred.")
    }
  }
}
