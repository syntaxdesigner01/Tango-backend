import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// 10AM UTC daily — morning "plan your day" reminder
crons.cron(
  "morning reminder",
  "0 10 * * *",
  internal.reminders.triggerMorning,
  {},
);

// 5PM UTC daily — evening "submit your report" reminder
crons.cron(
  "evening reminder",
  "0 17 * * *",
  internal.reminders.triggerEvening,
  {},
);

export default crons;
