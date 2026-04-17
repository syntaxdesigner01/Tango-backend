import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { getAuthUser } from "./auth";

// --- Auth helper ---


// --- Date helpers (ISO "YYYY-MM-DD") ---

function toISO(d: Date): string {
  return d.toISOString().split("T")[0];
}

/**
 * Gets the current date string in a specific timezone (YYYY-MM-DD).
 */
function getLocalISODate(timezone: string, date: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch (e) {
    // Fallback to UTC if timezone is invalid
    return toISO(date);
  }
}

function todayRange(timezone: string): { start: string; end: string } {
  const d = getLocalISODate(timezone);
  return { start: d, end: d };
}

function thisWeekRange(timezone: string): { start: string; end: string } {
  const now = new Date();
  const localDateStr = getLocalISODate(timezone, now);
  const localDate = new Date(localDateStr); // Local midnight

  const day = localDate.getUTCDay(); // 0 = Sunday
  const diffToMonday = (day + 6) % 7; // days since last Monday
  
  const monday = new Date(localDate);
  monday.setUTCDate(localDate.getUTCDate() - diffToMonday);
  
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  
  return { start: toISO(monday), end: toISO(sunday) };
}

function thisMonthRange(timezone: string): { start: string; end: string } {
  const now = new Date();
  const localDateStr = getLocalISODate(timezone, now);
  const localDate = new Date(localDateStr);

  const year = localDate.getUTCFullYear();
  const month = localDate.getUTCMonth();
  
  const firstDay = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  
  return { start: toISO(firstDay), end: toISO(lastDay) };
}

// Fetch tasks between two ISO dates (inclusive)
export const listByRange = query({
  args: {
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    return await ctx.db
      .query("tasks")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", user._id).gte("date", args.startDate).lte("date", args.endDate),
      )
      .take(500);
  },
});

// Fetch today's tasks
export const listToday = query({
  args: { timezone: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    const tz = args.timezone ?? user.timezone ?? "Africa/Lagos";
    const { start, end } = todayRange(tz);
    return await ctx.db
      .query("tasks")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", user._id).gte("date", start).lte("date", end),
      )
      .take(500);
  },
});

// Fetch tasks for the current week (Monday–Sunday)
export const listThisWeek = query({
  args: { timezone: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    const tz = args.timezone ?? user.timezone ?? "Africa/Lagos";
    const { start, end } = thisWeekRange(tz);
    return await ctx.db
      .query("tasks")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", user._id).gte("date", start).lte("date", end),
      )
      .take(500);
  },
});

// Fetch tasks for the current calendar month
export const listThisMonth = query({
  args: { timezone: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    const tz = args.timezone ?? user.timezone ?? "Africa/Lagos";
    const { start, end } = thisMonthRange(tz);
    return await ctx.db
      .query("tasks")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", user._id).gte("date", start).lte("date", end),
      )
      .take(500);
  },
});

export const list = query({
  args: {
    date: v.string(), // ISO date "2026-04-16"
  },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    return await ctx.db
      .query("tasks")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", user._id).eq("date", args.date),
      )
      .collect();
  },
});

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthUser(ctx);
    return await ctx.db
      .query("tasks")
      .withIndex("by_user_date", (q) => q.eq("userId", user._id))
      .collect();
  },
});

export const getProgress = query({
  args: {
    date: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", user._id).eq("date", args.date),
      )
      .take(500);

    const total = tasks.length;
    const completed = tasks.filter((t) => t.status === "completed").length;
    const inProgress = tasks.filter((t) => t.status === "inProgress").length;
    const pending = tasks.filter((t) => t.status === "pending").length;

    return { total, completed, inProgress, pending };
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    date: v.string(),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("inProgress"),
        v.literal("completed"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    return await ctx.db.insert("tasks", {
      userId: user._id,
      companyId: user.companyId,
      title: args.title,
      date: args.date,
      status: args.status ?? "pending",
    });
  },
});

export const update = mutation({
  args: {
    taskId: v.id("tasks"),
    title: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("inProgress"),
        v.literal("completed"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new ConvexError("Task not found");
    if (task.userId !== user._id) throw new ConvexError("Unauthorized");

    const { taskId, ...fields } = args;
    const patch = Object.fromEntries(
      Object.entries(fields).filter(([, v]) => v !== undefined),
    );
    await ctx.db.patch(taskId, patch);
  },
});

export const remove = mutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new ConvexError("Task not found");
    if (task.userId !== user._id) throw new ConvexError("Unauthorized");

    await ctx.db.delete(args.taskId);
  },
});
