const MIN_AMOUNT = 5;
const MAX_AMOUNT = 10000;
const WORKER_VERSION = "DEBUG-2026-09-07-B";
const PAYPAL_TEST = "OAUTH-TEST-02";

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

async function paypalTest(env) {
  try {
    const clientId = String(
      env.PAYPAL_CLIENT_ID || ""
    ).trim();

    const secret = String(
      env.PAYPAL_CLIENT_SECRET || ""
    ).trim();

    if (!clientId || !secret) {
      return json({
        test: PAYPAL_TEST,
        error: "PayPal credentials are missing"
      }, 500);
    }

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
          "Accept-Language": "en-US",
          "User-Agent": "DealRank/1.0"
        },

        body:
          "grant_type=client_credentials"
      }
    );

    const data =
      await response.json();

    return json({
      test: PAYPAL_TEST,
      status: response.status,
      ok: response.ok,
      error:
        data.error || null,
      description:
        data.error_description || null,
      debug_id:
        data.debug_id || null
    });

  } catch (error) {

    return json({
      test: PAYPAL_TEST,
      error:
        error.message
    }, 500);
  }
}

async function paypalToken(env) {

  const clientId = String(
    env.PAYPAL_CLIENT_ID || ""
  ).trim();

  const clientSecret = String(
    env.PAYPAL_CLIENT_SECRET || ""
  ).trim();

  if (!clientId || !clientSecret) {
    throw new Error(
      "PayPal credentials are missing"
    );
  }

  const credentials =
    `${clientId}:${clientSecret}`;

  const auth =
    btoa(credentials);

  const response = await fetch(
    `${paypalBase(env)}/v1/oauth2/token`,
    {
      method: "POST",

      headers: {
        "Authorization":
          `Basic ${auth}`,

        "Content-Type":
          "application/x-www-form-urlencoded",

        "Accept":
          "application/json",

        "Accept-Language":
          "en-US"
      },

      body:
        "grant_type=client_credentials"
    }
  );

  const data =
    await response.json();

  if (
    !response.ok ||
    !data.access_token
  ) {

    console.error(
      "PAYPAL AUTH:",
      data
    );

    throw new Error(
      `PayPal AUTH ${response.status}: ` +
      (
        data.error_description ||
        data.error ||
        "Unknown authentication error"
      )
    );
  }

  return {
    token:
      data.access_token,

    base:
      paypalBase(env)
  };
}

async function paypalConfig(env) {

  return json({
    clientId:
      env.PAYPAL_CLIENT_ID || "",

    mode:
      env.PAYPAL_MODE || "sandbox"
  });
}

async function health(env) {

  let database = "missing";

  try {

    await env.DB
      .prepare("SELECT 1")
      .first();

    database = "configured";

  } catch (error) {

    console.error(
      "DATABASE HEALTH ERROR:",
      error
    );
  }

  return json({

    ok: true,

    worker:
      "DealRank",

    version:
      WORKER_VERSION,

    paypal_mode:
      env.PAYPAL_MODE || "missing",

    paypal_client_id:
      env.PAYPAL_CLIENT_ID
        ? "configured"
        : "missing",

    paypal_secret:
      env.PAYPAL_CLIENT_SECRET
        ? "configured"
        : "missing",

    database
  });
}

async function createOrder(
  request,
  env
) {

  try {

    const body =
      await request.json();

    const name =
      String(body.name || "")
        .trim();

    const url =
      String(body.url || "")
        .trim();

    const description =
      String(body.description || "")
        .trim();

    const amount =
      Number(body.amount);

    if (
      !name ||
      !url ||
      !description
    ) {

      return json({
        error:
          "Complete all fields."
      }, 400);
    }

    if (name.length > 80) {

      return json({
        error:
          "Deal name is too long."
      }, 400);
    }

    if (description.length > 160) {

      return json({
        error:
          "Description is too long."
      }, 400);
    }

    if (
      !Number.isFinite
