const MIN_AMOUNT = 5;
const MAX_AMOUNT = 10000;
const WORKER_VERSION = "DEBUG-2026-09-07-A";

const PAYPAL_TEST = "OAUTH-TEST-01";
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

async function paypalToken(env) {
  const clientId = String(env.PAYPAL_CLIENT_ID || "").trim();
  const clientSecret = String(env.PAYPAL_CLIENT_SECRET || "").trim();

  if (!clientId || !clientSecret) {
    throw new Error("PayPal credentials are missing");
  }

  const credentials = `${clientId}:${clientSecret}`;
  const auth = btoa(credentials);

  const response = await fetch(
    `${paypalBase(env)}/v1/oauth2/token`,
    {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json"
      },
      body: "grant_type=client_credentials"
    }
  );

  const data = await response.json();

  if (!response.ok || !data.access_token) {
    console.error("PAYPAL AUTH:", data);

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
    token: data.access_token,
    base: paypalBase(env)
  };
}

async function paypalConfig(env) {
  return json({
    clientId: env.PAYPAL_CLIENT_ID || "",
    mode: env.PAYPAL_MODE || "sandbox"
  });
}

async function paypalDebug(env) {
  const clientId = String(env.PAYPAL_CLIENT_ID || "");
  const secret = String(env.PAYPAL_CLIENT_SECRET || "");
  const mode = String(env.PAYPAL_MODE || "");

  let paypalStatus = null;
  let paypalError = null;
  let paypalDescription = null;

  if (clientId.trim() && secret.trim()) {
    try {
      const auth = btoa(
        `${clientId.trim()}:${secret.trim()}`
      );

      const response = await fetch(
        `${paypalBase(env)}/v1/oauth2/token`,
        {
          method: "POST",
          headers: {
            "Authorization": `Basic ${auth}`,
            "Content-Type":
              "application/x-www-form-urlencoded",
            "Accept": "application/json"
          },
          body:
            "grant_type=client_credentials"
        }
      );

      const data = await response.json();

      paypalStatus = response.status;
      paypalError = data.error || null;
      paypalDescription =
        data.error_description || null;

    } catch (error) {
      paypalError = error.message;
    }
  }

  return json({
    version: WORKER_VERSION,
    mode: mode || "missing",
    base: paypalBase(env),

    client_id_present:
      Boolean(clientId),

    client_id_length:
      clientId.trim().length,

    client_id_suffix:
      clientId.trim()
        ? clientId.trim().slice(-6)
        : null,

    secret_present:
      Boolean(secret),

    secret_length:
      secret.trim().length,

    secret_has_leading_or_trailing_whitespace:
      secret !== secret.trim(),

    paypal_status:
      paypalStatus,

    paypal_error:
      paypalError,

    paypal_description:
      paypalDescription
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
    worker: "DealRank",
    version: WORKER_VERSION,

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

async function createOrder(request, env) {
  try {
    const body = await request.json();

    const name =
      String(body.name || "").trim();

    const url =
      String(body.url || "").trim();

    const description =
      String(body.description || "").trim();

    const amount =
      Number(body.amount);

    if (!name || !url || !description) {
      return json({
        error: "Complete all fields."
      }, 400);
    }

    if (name.length > 80) {
      return json({
        error: "Deal name is too long."
      }, 400);
    }

    if (description.length > 160) {
      return json({
        error: "Description is too long."
      }, 400);
    }

    if (
      !Number.isFinite(amount) ||
      amount < MIN_AMOUNT ||
      amount > MAX_AMOUNT
    ) {
      return json({
        error:
          `Amount must be between €${MIN_AMOUNT} and €${MAX_AMOUNT}.`
      }, 400);
    }

    let parsedUrl;

    try {
      parsedUrl = new URL(url);
    } catch {
      return json({
        error: "Invalid URL."
      }, 400);
    }

    if (
      parsedUrl.protocol !== "http:" &&
      parsedUrl.protocol !== "https:"
    ) {
      return json({
        error:
          "Only HTTP and HTTPS URLs are allowed."
      }, 400);
    }

    const paypal =
      await paypalToken(env);

    const response = await fetch(
      `${paypal.base}/v2/checkout/orders`,
      {
        method: "POST",
        headers: {
          "Authorization":
            `Bearer ${paypal.token}`,
          "Content-Type":
            "application/json",
          "Accept":
            "application/json"
        },
        body: JSON.stringify({
          intent: "CAPTURE",
          purchase_units: [
            {
              description:
                "DealRank promotion",

              amount: {
                currency_code: "EUR",
                value:
                  amount.toFixed(2)
              }
            }
          ]
        })
      }
    );

    const data =
      await response.json();

    if (!response.ok || !data.id) {
      return json({
        error:
          data?.details?.[0]?.description ||
          data?.message ||
          "Unable to create PayPal order.",

        paypal_status:
          response.status
      }, 500);
    }

    await env.DB.prepare(`
      INSERT INTO pending_orders
      (
        paypal_order_id,
        name,
        url,
        description,
        amount
      )
      VALUES (?, ?, ?, ?, ?)
    `)
      .bind(
        data.id,
        name,
        url,
        description,
        amount
      )
      .run();

    return json({
      id: data.id
    });

  } catch (error) {
    console.error(
      "CREATE ORDER ERROR:",
      error
    );

    return json({
      error:
        error.message ||
        "Unable to create order."
    }, 500);
  }
}

async function captureOrder(request, env) {
  try {
    const body =
      await request.json();

    const orderID =
      String(body.orderID || "").trim();

    if (!orderID) {
      return json({
        error:
          "Missing PayPal order ID."
      }, 400);
    }

    const existing =
      await env.DB.prepare(`
        SELECT id
        FROM deals
        WHERE paypal_order_id = ?
        AND status = 'paid'
        LIMIT 1
      `)
        .bind(orderID)
        .first();

    if (existing) {
      return json({
        success: true,
        status: "paid",
        dealId: existing.id
      });
    }

    const pending =
      await env.DB.prepare(`
        SELECT
          paypal_order_id,
          name,
          url,
          description,
          amount
        FROM pending_orders
        WHERE paypal_order_id = ?
        LIMIT 1
      `)
        .bind(orderID)
        .first();

    if (!pending) {
      return json({
        error:
          "Pending listing not found."
      }, 404);
    }

    const paypal =
      await paypalToken(env);

    const response = await fetch(
      `${paypal.base}/v2/checkout/orders/${encodeURIComponent(orderID)}/capture`,
      {
        method: "POST",
        headers: {
          "Authorization":
            `Bearer ${paypal.token}`,
          "Content-Type":
            "application/json",
          "Accept":
            "application/json"
        }
      }
    );

    const data =
      await response.json();

    if (!response.ok) {
      return json({
        error:
          data?.details?.[0]?.description ||
          data?.message ||
          "Unable to capture PayPal order.",

        paypal_status:
          response.status
      }, 400);
    }

    if (data.status !== "COMPLETED") {
      return json({
        error:
          "PayPal payment was not completed.",

        status:
          data.status || "unknown"
      }, 400);
    }

    const capture =
      data.purchase_units?.[0]
        ?.payments
        ?.captures?.[0];

    const paidAmount =
      Number(
        capture?.amount?.value || 0
      );

    const expectedAmount =
      Number(pending.amount);

    if (
      !Number.isFinite(paidAmount) ||
      paidAmount.toFixed(2) !==
        expectedAmount.toFixed(2)
    ) {
      return json({
        error:
          "Payment amount does not match the listing."
      }, 400);
    }

    const result =
      await env.DB.prepare(`
        INSERT INTO deals
        (
          name,
          url,
          description,
          amount,
          status,
          paypal_order_id
        )
        VALUES (?, ?, ?, ?, 'paid', ?)
      `)
        .bind(
          pending.name,
          pending.url,
          pending.description,
          pending.amount,
          orderID
        )
        .run();

    await env.DB.prepare(`
      DELETE FROM pending_orders
      WHERE paypal_order_id = ?
    `)
      .bind(orderID)
      .run();

    return json({
      success: true,
      status: "paid",
      dealId:
        result.meta?.last_row_id ||
        null
    });

  } catch (error) {
    console.error(
      "CAPTURE ORDER ERROR:",
      error
    );

    return json({
      error:
        error.message ||
        "Unable to complete payment."
    }, 500);
  }
}

export default {

  async fetch(request, env) {

    try {

      const url =
        new URL(request.url);

      if (
        request.method === "GET" &&
        url.pathname ===
          "/api/health"
      ) {
        return health(env);
      }

      if (
        request.method === "GET" &&
        url.pathname ===
          "/api/paypal/config"
      ) {
        return paypalConfig(env);
      }

      if (
        request.method === "GET" &&
        url.pathname ===
          "/api/paypal/debug"
      ) {
        return paypalDebug(env);
      }

      if (
        request.method === "POST" &&
        url.pathname ===
          "/api/create-order"
      ) {
        return createOrder(
          request,
          env
        );
      }

      if (
        request.method === "POST" &&
        url.pathname ===
          "/api/capture-order"
      ) {
        return captureOrder(
          request,
          env
        );
      }

      return json({
        error: "Not found"
      }, 404);

    } catch (error) {

      console.error(
        "WORKER ERROR:",
        error
      );

      return json({
        error:
          error.message ||
          "Internal server error."
      }, 500);
    }
  }
};
