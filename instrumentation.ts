// Runs once when a Next.js server starts, before it handles any request.
// With SEED_DEMO_ON_EMPTY=1 (set on Render, whose free disk is wiped on every restart), an empty
// database gets the demo meetings, so the deployed app always has data to show.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return; // SQLite needs Node, not the edge runtime
  if (process.env.NEXT_PHASE === "phase-production-build") return; // never during `next build`
  if (process.env.SEED_DEMO_ON_EMPTY !== "1") return;

  const { seedDemoIfEmpty } = await import("./lib/demo");
  try {
    if (seedDemoIfEmpty()) console.log("[startup] database was empty: loaded the demo data");
  } catch (err) {
    // Don't stop the server from starting; pages still work, just without demo data.
    console.error("[startup] could not load the demo data", err);
  }
}
