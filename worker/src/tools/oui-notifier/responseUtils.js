export const jsonHeaders = {
  "content-type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

export const okResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: jsonHeaders });
