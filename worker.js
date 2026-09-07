const MIN_AMOUNT = 5;
const MAX_AMOUNT = 10000;
const WORKER_VERSION = "DEBUG-2026-09-07-D";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-store"
    }
  });
}

function paypalBase(env) {
  return String(env.PAYPAL_MODE || "").toLowerCase() === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

async function health(env) {
  let database = "missing";

  try {
    await env.DB.prepare("SELECT 1").first();
    database = "configured";
  } catch (e) {
    database = "error";
  }

  return json({
    ok: true,
    worker: "DealRank",
    version: WORKER_VERSION,
    paypal_mode: env.PAYPAL_MODE || "missing",
    paypal_client_id: env.PAYPAL_CLIENT_ID
      ? "configured"
      : "missing",
    paypal_secret: env.PAYPAL_CLIENT_SECRET
      ? "configured"
      : "missing",
    database
  });
}

async function paypalTest(env) {
  try {
    const clientId = String(
      env.PAYPAL_CLIENT_ID || ""
    ).trim();

    const secret = String(
      env.PAYPAL_CLIENT_SECRET || ""
    ).trim();

    const auth = btoa(
      `${clientId}:${secret}`
    );

    const response = await fetch(
      `${paypalBase(env)}/v1/oauth2/token`,
      {
        method: "POST",
        headers: {
          "Authorization": `Basic ${auth}`,
          "Content-Type":
            "application/x-www-form-urlencoded",
          "Accept": "application/json",
          "Accept-Language": "en-US"
        },
        body:
          "grant_type=client_credentials"
      }
    );

    const data =
      await response.json();

    return json({
      version: WORKER_VERSION,
      status: response.status,
      ok: response.ok,
      error: data.error || null,
      description:
        data.error_description || null
    });

  } catch (error) {

    return json({
      version: WORKER_VERSION,
      error: error.message
    }, 500);
  }
}

export default {
  async fetch(request, env) {

    const url =
      new URL(request.url);

    if (
      request.method === "GET" &&
      url.pathname === "/api/health"
    ) {
      return health(env);
    }

    if (
      request.method === "GET" &&
      url.pathname === "/api/paypal/test"
    ) {
      return paypalTest(env);
    }

    return json({
      error: "Not found"
    }, 404);
  }
};
