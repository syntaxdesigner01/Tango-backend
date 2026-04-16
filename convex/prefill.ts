import { internalQuery } from "./_generated/server";
import { v } from "convex/values";

function yesterday(isoDate: string): string {
  const d = new Date(isoDate);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split("T")[0];
}

// Generates a pre-filled report draft for a user on a given date.
// - tasksCompleted  ← today's completed tasks
// - workInProgress  ← today's in-progress tasks
// - nextSteps       ← yesterday's nextSteps (carry forward)
// - blockers        ← blank (user fills in)
export const generateDraft = internalQuery({
  args: {
    userId: v.id("users"),
    date: v.string(), // ISO date "2026-04-16"
  },
  handler: async (ctx, args) => {
    const prevDate = yesterday(args.date);

    // Fetch today's tasks (bounded to 500)
    const todayTasks = await ctx.db
      .query("tasks")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", args.userId).eq("date", args.date),
      )
      .take(500);

    // Fetch yesterday's submitted report for carry-forward context
    const prevReport = await ctx.db
      .query("reports")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", args.userId).eq("date", prevDate),
      )
      .unique();

    const completed = todayTasks
      .filter((t) => t.status === "completed")
      .map((t) => `• ${t.title}`)
      .join("\n");

    const inProgress = todayTasks
      .filter((t) => t.status === "inProgress")
      .map((t) => `• ${t.title}`)
      .join("\n");

    return {
      tasksCompleted: completed,
      workInProgress: inProgress,
      blockers: "",
      nextSteps: prevReport?.nextSteps ?? "",
    };
  },
});
