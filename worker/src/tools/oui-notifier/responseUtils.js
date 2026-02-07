import { corsHeaders, jsonResponse } from "../../lib/response.js";

export const jsonHeaders = {
  "Content-Type": "application/json",
  ...corsHeaders,
};

export const okResponse = jsonResponse;
