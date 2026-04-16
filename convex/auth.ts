import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { MutationCtx } from "./_generated/server";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password()],
  callbacks: {
    /**
     * Called when a new auth account is being created (first sign-up).
     * We reject sign-ups for emails not already in the users table —
     * only admin-created users can activate their account.
     */
    async createOrUpdateUser(ctx, args) {
      // Returning user with a valid existing record
      if (args.existingUserId !== undefined && args.existingUserId !== null) {
        return args.existingUserId;
      }

      // First time signing up (or user record was deleted) —
      // verify admin pre-created this user
      const user = await (ctx as unknown as MutationCtx).db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", args.profile.email!))
        .unique();
      if (!user) {
        throw new ConvexError(
          "No account found for this email. Contact your company admin.",
        );
      }
      return user._id;
    },
  },
});
