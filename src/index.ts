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
      logToD1(env.prod_d1_db_slice_upi_gateway, JSON.stringify(parsed), "Received");

      await message.forward("pkdartyt@gmail.com")
    } catch (error) {
      logToD1(env.prod_d1_db_slice_upi_gateway, error as string, "Error");
      console.error("Email forwarding failed:", error)
      message.setReject("Internal forwarding error occurred.")
    }
  }
}
