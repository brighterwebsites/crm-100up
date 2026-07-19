import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Notification-hook scaffolding (deliberately a no-op for now).
// Future: point a Database Webhook at this function for inserts on
// public.job_events, then fan out email/SMS per event_type
// (stage_advanced, stage_moved_back, booking_rescheduled).
Deno.serve(async (req: Request) => {
  let payload: unknown = null;
  try {
    payload = await req.json();
  } catch {
    // fine — health checks send no body
  }
  console.log("job-events-hook received:", JSON.stringify(payload));
  return new Response(JSON.stringify({ ok: true, handled: false }), {
    headers: { "Content-Type": "application/json" },
  });
});
