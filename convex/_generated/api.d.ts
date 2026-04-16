/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as companies from "../companies.js";
import type * as crons from "../crons.js";
import type * as email from "../email.js";
import type * as googleCalendar from "../googleCalendar.js";
import type * as http from "../http.js";
import type * as magicLinks from "../magicLinks.js";
import type * as notion from "../notion.js";
import type * as notionHelpers from "../notionHelpers.js";
import type * as prefill from "../prefill.js";
import type * as reminders from "../reminders.js";
import type * as reports from "../reports.js";
import type * as tasks from "../tasks.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  companies: typeof companies;
  crons: typeof crons;
  email: typeof email;
  googleCalendar: typeof googleCalendar;
  http: typeof http;
  magicLinks: typeof magicLinks;
  notion: typeof notion;
  notionHelpers: typeof notionHelpers;
  prefill: typeof prefill;
  reminders: typeof reminders;
  reports: typeof reports;
  tasks: typeof tasks;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
