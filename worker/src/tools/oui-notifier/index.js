import { handleRequest } from "./httpHandlers.js";
import { runDailyJob } from "./jobs/dailyJob.js";

export async function handleOuiNotifierRequest(request, env, ctx) {
  return handleRequest(request, env, ctx);
}

export async function runOuiNotifierDaily(env) {
  return runDailyJob(env);
}
