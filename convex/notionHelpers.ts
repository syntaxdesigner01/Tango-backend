import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

export const getReportForSync = internalQuery({
  args: { reportId: v.id("reports") },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report) return null;
    const user = await ctx.db.get(report.userId);
    return {
      ...report,
      userName: user?.name ?? "Unknown",
    };
  },
});

export const markSynced = internalMutation({
  args: { reportId: v.id("reports"), syncedAt: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.reportId, { notionSyncedAt: args.syncedAt });
  },
});
