import { internalMutation, mutation } from "./_generated/server";
import { v } from "convex/values";

const ONE_HOUR_MS = 60 * 60 * 1000;

export const generate = internalMutation({
  args: {
    userId: v.id("users"),
    purpose: v.union(v.literal("login"), v.literal("report")),
  },
  handler: async (ctx, args) => {
    // Invalidate any existing unused tokens for this user + purpose
    const existing = await ctx.db
      .query("magicLinks")
      .withIndex("by_token")
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), args.userId),
          q.eq(q.field("purpose"), args.purpose),
          q.eq(q.field("used"), false),
        ),
      )
      .collect();

    for (const link of existing) {
      await ctx.db.patch(link._id, { used: true });
    }

    const token = crypto.randomUUID();
    await ctx.db.insert("magicLinks", {
      userId: args.userId,
      token,
      expiresAt: Date.now() + ONE_HOUR_MS,
      used: false,
      purpose: args.purpose,
    });

    return token;
  },
});

export const validate = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const link = await ctx.db
      .query("magicLinks")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();

    if (!link) throw new Error("Invalid token.");
    if (link.used) throw new Error("Token already used.");
    if (Date.now() > link.expiresAt) throw new Error("Token expired.");

    await ctx.db.patch(link._id, { used: true });

    return { userId: link.userId, purpose: link.purpose };
  },
});
