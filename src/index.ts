import { Hono } from "hono";
import { parseSliceEmail } from "./parser";
import PostalMime from "postal-mime";
import { logToD1 } from "./log";
import { createOrder } from "./orders";

interface CloudflareBindings {
  prod_d1_db_slice_upi_gateway: D1Database;
}

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.get("/message", (c) => {
  return c.text("Hello Hono!!");
});

app.post("/api/create-order", async (c) => {
  try {
    const { amount } = await c.req.json<{ amount: number }>();
    if (typeof amount !== "number" || amount <= 0) {
      return c.json({ error: "Invalid amount." }, 400);
    }
    const result = await createOrder(amount, c.env.prod_d1_db_slice_upi_gateway);
    return c.json(result);
  } catch (e: any) {
    return c.json({ error: e.message }, 409);
  }
});

export default {
  fetch: app.fetch,

  async email(message: ForwardableEmailMessage, env: CloudflareBindings, ctx: ExecutionContext) {
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
      else if (parsed.amount <= 0 || !parsed.rrn || isNaN(Date.parse(parsed.date.toISOString()))) {
        logToD1(env.prod_d1_db_slice_upi_gateway, "Invalid transaction details.", "Rejected");
        message.setReject("Invalid transaction.");
        return;
      }
      const db = env.prod_d1_db_slice_upi_gateway;
      const payment = await db.prepare(
        `INSERT INTO Payments (amount, uid, payer_name) VALUES (?, ?, ?) RETURNING payment_id`
      ).bind(parsed.amount, parsed.rrn, parsed.name).first<{ payment_id: number }>();

      const amountPaise = Math.round(parsed.amount * 100);
      const matchingOrder = await db.prepare(
        `SELECT order_id FROM Orders
        WHERE status = 'waiting'
          AND CAST(ROUND(amount * 100) AS INTEGER) = ?
        ORDER BY created_at ASC
        LIMIT 1`
      ).bind(amountPaise).first<{ order_id: number }>();

      if (!matchingOrder) {
        await db.prepare(`UPDATE Payments SET note = 'no_matching_order' WHERE payment_id = ?`)
          .bind(payment!.payment_id)
          .run();
        await logToD1(db, `No waiting order found for amount ${parsed.amount}`, "NoMatch");
        return;
      }

      const updatedOrder = await db.prepare(
        `UPDATE Orders
        SET status = 'success', uid = ?, payer_name = ?, paid_at = datetime('now')
        WHERE order_id = ? AND status = 'waiting'
        RETURNING order_id`
      ).bind(parsed.rrn, parsed.name, matchingOrder.order_id).first<{ order_id: number }>();

      if (!updatedOrder) {
        await db.prepare(`UPDATE Payments SET note = 'order_update_failed' WHERE payment_id = ?`)
          .bind(payment!.payment_id)
          .run();
        throw new Error(`Failed to update order ${matchingOrder.order_id}`);
      }

      await db.prepare(`UPDATE Payments SET matched_order_id = ? WHERE payment_id = ?`)
        .bind(updatedOrder.order_id, payment!.payment_id)
        .run();

      await logToD1(db, `Order ${updatedOrder.order_id} updated successfully.`, "Success");
      // await message.forward("pkdartyt@gmail.com")
    } catch (error) {
      logToD1(env.prod_d1_db_slice_upi_gateway, error as string, "Error");
      console.error("Email forwarding failed:", error)
      message.setReject("Internal forwarding error occurred.")
    }
  }
}
