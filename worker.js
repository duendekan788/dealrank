const PRICE_EUR = "5.00";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store"
    }
  });
}

async function paypalToken(env) {
  const mode = String(env.PAYPAL_MODE || "").toLowerCase();

  const base =
    mode === "live"
      ? "https://api-m.paypal.com"
      : "https://api-m.sandbox.paypal.com";

  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    throw new Error("PayPal credentials are missing");
  }

  const auth = btoa(
    `${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`
  );

  const response = await fetch(
    `${base}/v1/oauth2/token`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: "grant_type=client_credentials"
    }
  );

  const data = await response.json();

  if (!response.ok || !data.access_token) {
    throw new Error(
      `PayPal OAuth error: ${
        data.error_description ||
        data.error ||
        "Authentication failed"
      }`
    );
  }

  return {
    token: data.access_token,
    base
  };
}

async function paypalConfig(env) {
  const mode = String(
    env.PAYPAL_MODE || ""
  ).toLowerCase();

  return {
    clientId: env.PAYPAL_CLIENT_ID || "",
    mode
  };
}

async function createOrder(request, env) {
  try {
    const body = await request.json();

    const name = String(body.name || "").trim();
    const url = String(body.url || "").trim();
    const description = String(
      body.description || ""
    ).trim();

    if (!name || !url || !description) {
      return json(
        {
          error: "Complete all fields."
        },
        400
      );
    }

    if (name.length > 120) {
      return json(
        {
          error: "Name is too long."
        },
        400
      );
    }

    if (url.length > 2048) {
      return json(
        {
          error: "URL is too long."
        },
        400
      );
    }

    if (description.length > 1000) {
      return json(
        {
          error: "Description is too long."
        },
        400
      );
    }

    let parsedUrl;

    try {
      parsedUrl = new URL(url);
    } catch {
      return json(
        {
          error: "Invalid URL."
        },
        400
      );
    }

    if (
      parsedUrl.protocol !== "http:" &&
      parsedUrl.protocol !== "https:"
    ) {
      return json(
        {
          error:
            "Only HTTP and HTTPS URLs are allowed."
        },
        400
      );
    }

    const amount = PRICE_EUR;

    const paypal = await paypalToken(env);

    const response = await fetch(
      `${paypal.base}/v2/checkout/orders`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${paypal.token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          intent: "CAPTURE",
          purchase_units: [
            {
              amount: {
                currency_code: "EUR",
                value: amount
              },
              description: "DealRank listing"
            }
          ]
        })
      }
    );

    const data = await response.json();

    if (!response.ok || !data.id) {
      console.error(
        "PAYPAL CREATE ORDER ERROR:",
        data
      );

      return json(
        {
          error:
            data?.details?.[0]?.description ||
            data?.message ||
            "Unable to create PayPal order."
        },
        500
      );
    }

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
      VALUES (?, ?, ?, ?, 'pending', ?)
    `)
      .bind(
        name,
        url,
        description,
        Number(amount),
        data.id
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

    return json(
      {
        error:
          error.message ||
          "Unable to create order."
      },
      500
    );
  }
}

async function captureOrder(request, env) {
  try {
    const body = await request.json();

    const orderID = String(
      body.orderID || ""
    ).trim();

    if (!orderID) {
      return json(
        {
          error: "Missing PayPal order ID."
        },
        400
      );
    }

    const deal = await env.DB.prepare(`
      SELECT
        id,
        name,
        url,
        description,
        amount,
        status,
        paypal_order_id
      FROM deals
      WHERE paypal_order_id = ?
      LIMIT 1
    `)
      .bind(orderID)
      .first();

    if (!deal) {
      return json(
        {
          error: "Deal not found."
        },
        404
      );
    }

    if (deal.status === "paid") {
      return json({
        success: true,
        message: "Order already captured.",
        dealId: deal.id
      });
    }

    const paypal = await paypalToken(env);

    const response = await fetch(
      `${paypal.base}/v2/checkout/orders/${encodeURIComponent(
        orderID
      )}/capture`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${paypal.token}`,
          "Content-Type": "application/json"
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error(
        "PAYPAL CAPTURE ERROR:",
        data
      );

      return json(
        {
          error:
            data?.details?.[0]?.description ||
            data?.message ||
            "Unable to capture PayPal order."
        },
        500
      );
    }

    if (data.status !== "COMPLETED") {
      return json(
        {
          error:
            "PayPal payment was not completed.",
          status:
            data.status || "unknown"
        },
        400
      );
    }

    await env.DB.prepare(`
      UPDATE deals
      SET status = 'paid'
      WHERE id = ?
    `)
      .bind(deal.id)
      .run();

    return json({
      success: true,
      status: "paid",
      dealId: deal.id
    });

  } catch (error) {
    console.error(
      "CAPTURE ORDER ERROR:",
      error
    );

    return json(
      {
        error:
          error.message ||
          "Unable to capture order."
      },
      500
    );
  }
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
    paypal_mode:
      env.PAYPAL_MODE
        ? "configured"
        : "missing",
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

export default {
  async fetch(request, env) {
    try {
      const url = new URL(
        request.url
      );

      if (
        request.method === "GET" &&
        url.pathname === "/api/health"
      ) {
        return health(env);
      }

      if (
        request.method === "GET" &&
        url.pathname === "/api/paypal/config"
      ) {
        return json(
          await paypalConfig(env)
        );
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/create-order"
      ) {
        return createOrder(
          request,
          env
        );
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/capture-order"
      ) {
        return captureOrder(
          request,
          env
        );
      }

      return json(
        {
          error: "Not found"
        },
        404
      );

    } catch (error) {
      console.error(
        "WORKER ERROR:",
        error
      );

      return json(
        {
          error:
            error.message ||
            "Internal server error."
        },
        500
      );
    }
  }
};
