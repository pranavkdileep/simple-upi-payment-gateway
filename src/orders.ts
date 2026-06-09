export async function createOrder(
  requestedAmount: number,
  db: D1Database
): Promise<{ amount: number; orderId: number }> {
  const basePaise = Math.round(requestedAmount * 100);

  const result = await db.prepare(
    `WITH RECURSIVE slots(offset) AS (
      SELECT 0
      UNION ALL
      SELECT offset + 1 FROM slots WHERE offset < 100
    ),
    available AS (
      SELECT ? + offset AS amount_paise
      FROM slots
      WHERE NOT EXISTS (
        SELECT 1
        FROM Orders
        WHERE status = 'waiting'
          AND CAST(ROUND(amount * 100) AS INTEGER) = ? + offset
      )
      ORDER BY offset
      LIMIT 1
    )
    INSERT INTO Orders (amount, status)
    SELECT amount_paise / 100.0, 'waiting' FROM available
    RETURNING amount, order_id`
  ).bind(basePaise, basePaise).first<{ amount: number; order_id: number }>();

  if (!result) {
    throw new Error("No payment slots available. Please retry after a few minutes.");
  }

  return { amount: result.amount, orderId: result.order_id };
}
