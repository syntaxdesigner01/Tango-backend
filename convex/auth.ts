import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile: (params) => ({
        email: params.email as string,
        // Thread the password through so createOrUpdateUser can validate it against
        // the admin-issued staffId (one-time credential used on first sign-up)
        password: params.password as string,
      }),
    }),
  ],
  callbacks: {
    /**
     * Called when a new auth account is being linked to a user record.
     * On first sign-up we validate that the password equals the admin-issued
     * staffId — only pre-created users can activate their account.
     */
    async createOrUpdateUser(ctx, args) {
      // Returning user — auth account already exists, nothing to validate
      if (args.existingUserId !== undefined && args.existingUserId !== null) {
        return args.existingUserId;
      }

      const profile = args.profile as { email: string; password?: string };

      // First sign-up — verify admin pre-created this user
      const user = await (ctx as unknown as MutationCtx).db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", profile.email))
        .unique();

      if (!user) {
        throw new ConvexError(
          "No account found for this email. Contact your company admin.",
        );
      }

      // Validate that the provided password matches the admin-issued staffId
      if (profile.password !== user.staffId) {
        throw new ConvexError(
          "Invalid staff ID. Use the staff ID provided by your company admin.",
        );
      }

      return user._id;
    },
  },
});

/**
 * Robust helper to get the currently authenticated user.
 * Supports a TEST_USER_ID bypass for the Convex Dashboard.
 */
export async function getAuthUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();

  // Dashboard/Manual Testing Bypass
  // To use this, find a user ID in the users table and add it to environment variables
  if (!identity && process.env.TEST_USER_ID) {
    const user = await ctx.db.get(process.env.TEST_USER_ID as Id<"users">);
    if (user) return user;
  }

  if (!identity) {
    throw new ConvexError(
      "Not authenticated. If testing from the Dashboard, set TEST_USER_ID in your environment variables.",
    );
  }

  // @convex-dev/auth sets the identity.subject to the user's _id
  const user = await ctx.db.get(identity.subject as Id<"users">);
  if (!user) {
    throw new ConvexError("User not found");
  }

  return user;
}
