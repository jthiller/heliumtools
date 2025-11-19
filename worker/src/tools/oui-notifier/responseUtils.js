export const jsonHeaders = {
  "content-type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-User-Uuid",
};

export const okResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: jsonHeaders });
