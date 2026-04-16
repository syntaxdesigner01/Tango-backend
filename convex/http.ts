import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { auth } from "./auth";

const http = httpRouter();

auth.addHttpRoutes(http);

// Health check
http.route({
  path: "/hello",
  method: "GET",
  handler: httpAction(async (_ctx, _req) => {
    return new Response("Hello World", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }),
});

// Magic link validation — user clicks link from email, backend validates token
// and redirects them to the report page
http.route({
  path: "/magic",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");

    if (!token) {
      return new Response("Missing token.", { status: 400 });
    }

    try {
      const result = await ctx.runMutation(api.magicLinks.validate, { token });
      const appBase = process.env.APP_BASE_URL ?? "https://yourapp.com";
      const destination =
        result.purpose === "report"
          ? `${appBase}/report?userId=${result.userId}`
          : `${appBase}/dashboard?userId=${result.userId}`;

      return new Response(null, {
        status: 302,
        headers: { Location: destination },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Invalid token.";
      return new Response(message, { status: 401 });
    }
  }),
});

// Scheduler ping — allows GitHub Actions (or any external cron) to manually
// trigger reminders as a fallback. Protected by a shared secret.
http.route({
  path: "/scheduler/ping",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const authHeader = req.headers.get("authorization");
    const expected = `Bearer ${process.env.SCHEDULER_SECRET}`;

    if (!process.env.SCHEDULER_SECRET || authHeader !== expected) {
      return new Response("Unauthorized.", { status: 401 });
    }

    const body = (await req.json()) as { type?: string };
    const type = body.type;

    if (type === "morning") {
      await ctx.runMutation(internal.reminders.triggerMorning, {});
    } else if (type === "evening") {
      await ctx.runMutation(internal.reminders.triggerEvening, {});
    } else {
      return new Response('Body must include "type": "morning" | "evening".', {
        status: 400,
      });
    }

    return new Response(JSON.stringify({ ok: true, type }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

export default http;
