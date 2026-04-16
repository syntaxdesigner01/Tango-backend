import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  ...authTables,

  companies: defineTable({
    name: v.string(),
    domain: v.optional(v.string()),
  }),

  users: defineTable({
    companyId: v.id("companies"),
    staffId: v.string(),
    email: v.string(),
    name: v.string(),
    notifyChannels: v.array(
      v.union(
        v.literal("email"),
        v.literal("calendar"),
        v.literal("push"),
      ),
    ),
    morningTime: v.string(), // "10:00"
    eveningTime: v.string(), // "17:00"
    timezone: v.string(),
  })
    .index("by_company", ["companyId"])
    .index("by_email", ["email"])
    .index("by_staff_id", ["staffId"]),

  tasks: defineTable({
    userId: v.id("users"),
    companyId: v.id("companies"),
    title: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("inProgress"),
      v.literal("completed"),
    ),
    date: v.string(), // ISO date "2026-04-16"
  })
    .index("by_user_date", ["userId", "date"])
    .index("by_company_date", ["companyId", "date"]),

  reports: defineTable({
    userId: v.id("users"),
    companyId: v.id("companies"),
    date: v.string(), // ISO date "2026-04-16"
    tasksCompleted: v.string(),
    blockers: v.string(),
    workInProgress: v.string(),
    nextSteps: v.string(),
    submitted: v.boolean(),
    notionSyncedAt: v.optional(v.number()),
  })
    .index("by_user_date", ["userId", "date"])
    .index("by_company_date", ["companyId", "date"]),

  magicLinks: defineTable({
    userId: v.id("users"),
    token: v.string(),
    expiresAt: v.number(),
    used: v.boolean(),
    purpose: v.union(v.literal("login"), v.literal("report")),
  }).index("by_token", ["token"]),

  notificationLogs: defineTable({
    userId: v.id("users"),
    type: v.union(v.literal("morning"), v.literal("evening")),
    channel: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
    sentAt: v.number(),
    error: v.optional(v.string()),
  }).index("by_user", ["userId"]),
});
