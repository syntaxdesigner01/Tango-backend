import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

const APP_BASE_URL = process.env.APP_BASE_URL ?? "https://yourapp.com";

// Called by the 10AM cron — fans out a morning action per user
export const triggerMorning = internalMutation({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").take(500);

    for (const user of users) {
      await ctx.scheduler.runAfter(0, internal.reminders.sendMorningToUser, {
        userId: user._id,
      });
    }
  },
});

// Called by the 5PM cron — fans out an evening action per user
export const triggerEvening = internalMutation({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").take(500);

    for (const user of users) {
      await ctx.scheduler.runAfter(0, internal.reminders.sendEveningToUser, {
        userId: user._id,
      });
    }
  },
});

// Per-user morning reminder — runs as a separate scheduled job
export const sendMorningToUser = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return;

    const taskPageUrl = `${APP_BASE_URL}/tasks`;

    if (user.notifyChannels.includes("email")) {
      await ctx.scheduler.runAfter(0, internal.email.sendMorningEmail, {
        email: user.email,
        name: user.name,
        taskPageUrl,
      });
    }

    if (user.notifyChannels.includes("calendar")) {
      await ctx.scheduler.runAfter(0, internal.googleCalendar.createDailyEvent, {
        userId: user._id,
        type: "morning",
        title: "Plan your day — Tango",
        description: `Open your task board: ${taskPageUrl}`,
      });
    }

    await ctx.db.insert("notificationLogs", {
      userId: user._id,
      type: "morning",
      channel: user.notifyChannels.join(","),
      status: "sent",
      sentAt: Date.now(),
    });
  },
});

// Per-user evening reminder — generates magic link then dispatches notifications
export const sendEveningToUser = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return;

    // Generate a single-use magic link for the report
    const token = await ctx.runMutation(internal.magicLinks.generate, {
      userId: user._id,
      purpose: "report",
    });
    const magicLink = `${APP_BASE_URL}/report?token=${token}`;

    if (user.notifyChannels.includes("email")) {
      await ctx.scheduler.runAfter(0, internal.email.sendEveningEmail, {
        email: user.email,
        name: user.name,
        magicLink,
      });
    }

    if (user.notifyChannels.includes("calendar")) {
      await ctx.scheduler.runAfter(0, internal.googleCalendar.createDailyEvent, {
        userId: user._id,
        type: "evening",
        title: "Submit your report — Tango",
        description: `Open your report: ${magicLink}`,
      });
    }

    await ctx.db.insert("notificationLogs", {
      userId: user._id,
      type: "evening",
      channel: user.notifyChannels.join(","),
      status: "sent",
      sentAt: Date.now(),
    });
  },
});
