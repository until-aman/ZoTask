// Opens (and on a brand-new database, builds) the database when the server starts, outside any request.
// Building the sample data inside a page render is very slow in development, where React tracks every promise.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { db } = await import("./lib/db");
    await db();
  }
}
