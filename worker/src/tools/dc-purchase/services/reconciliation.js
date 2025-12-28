import { listPendingOrders, triggerProcess } from "./orders.js";

export async function runReconciliation(env) {
  const pending = await listPendingOrders(env);
  for (const order of pending) {
    await triggerProcess(env, null, order.id);
  }
}
