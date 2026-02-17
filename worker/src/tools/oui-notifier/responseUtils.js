import { corsHeaders } from "../../lib/response.js";

export const jsonHeaders = {
  "Content-Type": "application/json",
  ...corsHeaders,
};
