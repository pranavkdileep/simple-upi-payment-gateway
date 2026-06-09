export async function createOrder(
  requestedAmount: number,
  db: D1Database
): Promise<{ amount: number; orderId: number }> {
  const baseAmount = Math.round(requestedAmount * 100) / 100;
  const maxAmount = baseAmount + 1.00;
  let currentAmount = baseAmount;

  while (currentAmount <= maxAmount + 0.0001) {
    const rounded = Math.round(currentAmount * 100) / 100;

    const existing = await db.prepare(
      `SELECT 1 FROM Orders WHERE amount = ? AND status = 'waiting' LIMIT 1`
    ).bind(rounded).first();

    if (!existing) {
      const result = await db.prepare(
        `INSERT INTO Orders (amount, status) VALUES (?, 'waiting') RETURNING order_id`
      ).bind(rounded).first<{ order_id: number }>();
      return { amount: rounded, orderId: result!.order_id };
    }

    currentAmount = Math.round((currentAmount + 0.01) * 100) / 100;
  }

  throw new Error("No payment slots available. Please retry after a few minutes.");
}
