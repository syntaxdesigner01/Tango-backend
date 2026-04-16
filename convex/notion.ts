"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

// Set these in your Convex environment variables dashboard:
//   NOTION_API_KEY       — your Notion integration secret token
//   NOTION_DATABASE_ID   — the ID of the Notion database to write reports into
//
// The target Notion database must have these properties:
//   Name (title)         — report title e.g. "John Doe — 2026-04-16"
//   User (rich_text)     — staff member's name
//   Date (date)          — report date
//   Tasks Completed (rich_text)
//   Blockers (rich_text)
//   Work In Progress (rich_text)
//   Next Steps (rich_text)

function richText(content: string) {
  return [{ type: "text", text: { content } }];
}

export const syncReport = internalAction({
  args: { reportId: v.id("reports") },
  handler: async (ctx, args) => {
    const apiKey = process.env.NOTION_API_KEY;
    const databaseId = process.env.NOTION_DATABASE_ID;

    if (!apiKey || !databaseId) {
      throw new Error(
        "NOTION_API_KEY and NOTION_DATABASE_ID must be set in environment variables.",
      );
    }

    const report = await ctx.runQuery(internal.notionHelpers.getReportForSync, {
      reportId: args.reportId,
    });

    if (!report) throw new Error("Report not found.");

    const title = `${report.userName} — ${report.date}`;

    const res = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28",
      },
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties: {
          Name: { title: richText(title) },
          User: { rich_text: richText(report.userName) },
          Date: { date: { start: report.date } },
          "Tasks Completed": { rich_text: richText(report.tasksCompleted) },
          Blockers: { rich_text: richText(report.blockers) },
          "Work In Progress": { rich_text: richText(report.workInProgress) },
          "Next Steps": { rich_text: richText(report.nextSteps) },
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Notion sync failed: ${res.status} — ${body}`);
    }

    await ctx.runMutation(internal.notionHelpers.markSynced, {
      reportId: args.reportId,
      syncedAt: Date.now(),
    });
  },
});
