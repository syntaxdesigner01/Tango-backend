import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { internal } from "./_generated/api";

// --- Auth helper ---

async function getAuthUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Not authenticated");
  const user = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", identity.email!))
    .unique();
  if (!user) throw new ConvexError("User not found");
  return user;
}

export const get = query({
  args: {
    date: v.string(), // ISO date "2026-04-16"
  },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    return await ctx.db
      .query("reports")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", user._id).eq("date", args.date),
      )
      .unique();
  },
});

export const list = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    return await ctx.db
      .query("reports")
      .withIndex("by_user_date", (q) => q.eq("userId", user._id))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const create = mutation({
  args: {
    date: v.string(),
    // When prefill is true, fields are auto-populated from tasks + yesterday's report.
    // Explicit field values always take precedence over the pre-fill.
    prefill: v.optional(v.boolean()),
    tasksCompleted: v.optional(v.string()),
    blockers: v.optional(v.string()),
    workInProgress: v.optional(v.string()),
    nextSteps: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);

    // Prevent duplicates
    const existing = await ctx.db
      .query("reports")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", user._id).eq("date", args.date),
      )
      .unique();

    if (existing) {
      return existing._id;
    }

    let draft = {
      tasksCompleted: "",
      workInProgress: "",
      blockers: "",
      nextSteps: "",
    };

    if (args.prefill) {
      draft = await ctx.runQuery(internal.prefill.generateDraft, {
        userId: user._id,
        date: args.date,
      });
    }

    return await ctx.db.insert("reports", {
      userId: user._id,
      companyId: user.companyId,
      date: args.date,
      tasksCompleted: args.tasksCompleted ?? draft.tasksCompleted,
      blockers: args.blockers ?? draft.blockers,
      workInProgress: args.workInProgress ?? draft.workInProgress,
      nextSteps: args.nextSteps ?? draft.nextSteps,
      submitted: false,
    });
  },
});

export const update = mutation({
  args: {
    reportId: v.id("reports"),
    tasksCompleted: v.optional(v.string()),
    blockers: v.optional(v.string()),
    workInProgress: v.optional(v.string()),
    nextSteps: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    const report = await ctx.db.get(args.reportId);
    if (!report) throw new ConvexError("Report not found");
    if (report.userId !== user._id) throw new ConvexError("Unauthorized");

    const { reportId, ...fields } = args;
    const patch = Object.fromEntries(
      Object.entries(fields).filter(([, v]) => v !== undefined),
    );
    await ctx.db.patch(reportId, patch);
  },
});

export const submit = mutation({
  args: { reportId: v.id("reports") },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    const report = await ctx.db.get(args.reportId);
    if (!report) throw new ConvexError("Report not found");
    if (report.userId !== user._id) throw new ConvexError("Unauthorized");
    if (report.submitted) throw new ConvexError("Report already submitted.");

    await ctx.db.patch(args.reportId, { submitted: true });

    // Schedule Notion sync asynchronously so submission is not blocked
    await ctx.scheduler.runAfter(0, internal.notion.syncReport, {
      reportId: args.reportId,
    });
  },
});
