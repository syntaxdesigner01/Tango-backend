"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";

// Requires a Google service account or OAuth2 credentials.
// Set these in Convex environment variables:
//   GOOGLE_CLIENT_EMAIL   — service account email
//   GOOGLE_PRIVATE_KEY    — service account private key (PEM)
//   GOOGLE_CALENDAR_ID    — calendar ID to write events to (e.g. "primary" or a shared calendar)

async function getAccessToken(): Promise<string> {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!clientEmail || !privateKey) {
    throw new Error(
      "GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY must be set in environment variables.",
    );
  }

  // Build a JWT for the Google OAuth2 token endpoint
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = btoa(
    JSON.stringify({
      iss: clientEmail,
      scope: "https://www.googleapis.com/auth/calendar",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );

  // Import the private key using Web Crypto API (available in Node 18+)
  const keyData = privateKey
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    Buffer.from(keyData, "base64"),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signingInput = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    Buffer.from(signingInput),
  );

  const jwt = `${signingInput}.${Buffer.from(signature).toString("base64url")}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    throw new Error(`Failed to get Google access token: ${body}`);
  }

  const { access_token } = (await tokenRes.json()) as { access_token: string };
  return access_token;
}

export const createDailyEvent = internalAction({
  args: {
    userId: v.id("users"),
    type: v.union(v.literal("morning"), v.literal("evening")),
    title: v.string(),
    description: v.string(),
  },
  handler: async (_ctx, args) => {
    const calendarId = process.env.GOOGLE_CALENDAR_ID ?? "primary";
    const accessToken = await getAccessToken();

    // Set event time based on type
    const now = new Date();
    const dateStr = now.toISOString().split("T")[0];
    const startHour = args.type === "morning" ? "10:00:00" : "17:00:00";
    const endHour = args.type === "morning" ? "10:15:00" : "17:15:00";

    const event = {
      summary: args.title,
      description: args.description,
      start: { dateTime: `${dateStr}T${startHour}`, timeZone: "UTC" },
      end: { dateTime: `${dateStr}T${endHour}`, timeZone: "UTC" },
      reminders: { useDefault: false, overrides: [] },
    };

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
      },
    );

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to create calendar event: ${res.status} — ${body}`);
    }

    return await res.json();
  },
});
