import { handleRequest } from "./httpHandlers.js";
import { runDailyJob } from "./jobs/dailyJob.js";
import {
  handleGetUser,
  handleDeleteSubscription,
  handleUpdateSubscription,
  handleDeleteUser,
} from "./handlers/user.js";

export async function handleOuiNotifierRequest(request, env, ctx) {
  const url = new URL(request.url);

  if (url.pathname.startsWith("/api/user/")) {
    if (request.method === "GET") {
      return handleGetUser(request, env);
    } else if (request.method === "DELETE") {
      return handleDeleteUser(request, env);
    }
  } else if (url.pathname.startsWith("/api/subscription/")) {
    if (request.method === "DELETE") {
      return handleDeleteSubscription(request, env);
    } else if (request.method === "POST") {
      return handleUpdateSubscription(request, env);
    }
  }

  return handleRequest(request, env, ctx);
}

export async function runOuiNotifierDaily(env) {
  return runDailyJob(env);
}
