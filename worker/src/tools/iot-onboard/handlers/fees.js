import { jsonResponse } from "../../../lib/response.js";
import { getOnboardFees } from "../services/fees.js";

export async function handleGetFees(env) {
  const fees = await getOnboardFees(env);
  return jsonResponse(fees);
}
