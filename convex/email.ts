"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";

// Configure your email provider here.
// This uses Resend (https://resend.com) — install with: npm install resend
// Replace RESEND_API_KEY in your Convex environment variables dashboard.

async function sendEmail(to: string, subject: string, html: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY environment variable is not set.");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM ?? "noreply@yourdomain.com",
      to,
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Email send failed: ${res.status} — ${body}`);
  }
}

export const sendMorningEmail = internalAction({
  args: {
    email: v.string(),
    name: v.string(),
    taskPageUrl: v.string(),
  },
  handler: async (_ctx, args) => {
    const subject = "Good morning, plan your day 🌅";
    const html = `
      <div style="font-family:sans-serif;max-width:600px;margin:auto">
        <h2>Good morning, ${args.name}!</h2>
        <p>It's time to plan your tasks for today. Head over to your task board and set your priorities.</p>
        <a href="${args.taskPageUrl}"
           style="display:inline-block;padding:12px 24px;background:#4f46e5;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">
          Plan My Day
        </a>
        <p style="color:#6b7280;font-size:13px;margin-top:24px">
          You're receiving this because you're part of the Tango productivity system.
        </p>
      </div>
    `;
    await sendEmail(args.email, subject, html);
  },
});

export const sendEveningEmail = internalAction({
  args: {
    email: v.string(),
    name: v.string(),
    magicLink: v.string(),
  },
  handler: async (_ctx, args) => {
    const subject = "Time to submit your daily report 📋";
    const html = `
      <div style="font-family:sans-serif;max-width:600px;margin:auto">
        <h2>Great work today, ${args.name}!</h2>
        <p>It's time to submit your end-of-day report. Click the button below — your report will be pre-filled with your task progress.</p>
        <a href="${args.magicLink}"
           style="display:inline-block;padding:12px 24px;background:#4f46e5;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">
          Submit My Report
        </a>
        <p style="color:#6b7280;font-size:13px;margin-top:24px">
          This link expires in 1 hour and can only be used once.
        </p>
      </div>
    `;
    await sendEmail(args.email, subject, html);
  },
});
