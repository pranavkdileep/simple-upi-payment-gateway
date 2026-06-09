export async function logToD1(db: D1Database, message: string, status: string = "Unknown") {
  try {
    await db.prepare("INSERT INTO Logs (message, status) VALUES (?, ?)")
      .bind(message, status)
      .run();
  } catch (error) {
    console.error("Failed to log to D1:", error);
  }
}