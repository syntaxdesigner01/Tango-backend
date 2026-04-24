import { internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { getAuthUser } from "./auth";

// Look up the currently authenticated user
export const getByIdentity = query({
  args: {},
  handler: async (ctx) => {
    try {
      return await getAuthUser(ctx);
    } catch {
      return null;
    }
  },
});

// Admin — add a new user to the company. Auto-generates a unique staffId.
// Returns { userId, staffId } so the admin can share the staffId with the user.
// The user activates their account by calling signIn("password", { email, password: staffId, flow: "signUp" })
export const addToCompany = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    companyId: v.id("companies"),
  },
  handler: async (ctx, args) => {
    const emailExists = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique();

    if (emailExists) {
      throw new Error("A user with this email already exists.");
    }

    // Generate a short, readable staff ID (e.g. "A3F9B21C")
    const staffId = crypto.randomUUID().slice(0, 8).toUpperCase();

    const userId = await ctx.db.insert("users", {
      companyId: args.companyId,
      staffId,
      email: args.email,
      name: args.name,
      notifyChannels: ["email"],
      morningTime: "10:00",
      eveningTime: "17:00",
      timezone: "Africa/Lagos",
    });

    const company = await ctx.db.get(args.companyId);
    await ctx.scheduler.runAfter(0, internal.email.sendWelcomeEmail, {
      email: args.email,
      name: args.name,
      staffId,
      companyName: company?.name ?? "Your Company",
    });

    return { userId, staffId };
  },
});

export const updatePreferences = mutation({
  args: {
    notifyChannels: v.optional(
      v.array(
        v.union(
          v.literal("email"),
          v.literal("calendar"),
          v.literal("push"),
        ),
      ),
    ),
    morningTime: v.optional(v.string()),
    eveningTime: v.optional(v.string()),
    timezone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);

    const patch = Object.fromEntries(
      Object.entries(args).filter(([, v]) => v !== undefined),
    );
    await ctx.db.patch(user._id, patch);
  },
});

// Used by the auth profile function to validate staffId during sign-up
export const getByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique();
  },
});

// Used internally by the reminder scheduler
export const listByCompany = internalQuery({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_company", (q) => q.eq("companyId", args.companyId))
      .take(500);
  },
});
