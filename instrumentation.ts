// Opens (and on a new database, fills) the database when the server starts, before the first page renders.
// A failure here must not stop the server: the first request opens the database again and shows any error there.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try { const { db } = await import("./lib/db"); await db(); }
    catch (e) { console.error("Database not ready at start; will retry on the first request", e); }
  }
}
