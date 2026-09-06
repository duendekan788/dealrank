function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

async function paypalToken(env) {
  const mode = String(env.PAYPAL_MODE || "").trim().toLowerCase();

  const base =
    mode === "live"
      ? "https://api-m.paypal.com"
      : "https://api-m.sandbox.paypal.com";

  if (!env.PAYPAL_CLIENT_ID) {
    throw new Error("PAYPAL_CLIENT_ID is missing in Cloudflare.");
  }

  if (!env.PAYPAL_CLIENT_SECRET) {
    throw new Error("PAYPAL_CLIENT_SECRET is missing in Cloudflare.");
  }

  if (!["live", "sandbox"].includes(mode)) {
    throw new Error(
      "PAYPAL_MODE must be exactly 'live' or 'sandbox'."
    );
  }

  const auth = btoa(
    `${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`
  );

  const response = await fetch(
    base + "/v1/oauth2/token",
    {
      method: "POST",
      headers: {
        Authorization: "Basic " + auth,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: "grant_type=client_credentials"
    }
  );

  const data = await response.json();

  if (!response.ok) {
    console.error("PAYPAL OAUTH ERROR:", {
      status: response.status,
      data
    });

    throw new Error(
      `PayPal authentication failed: ${
        data.error_description ||
        data.error ||
        `HTTP ${response.status}`
      }`
    );
  }

  if (!data.access_token) {
    throw new Error("PayPal did not return an access token.");
  }

  return {
    base,
    token: data.access_token
  };
}

async function createOrder(request, env) {
  try {
    const data = await request.json();

    const name = String(data.name || "").trim();
    const url = String(data.url || "").trim();
    const description = String(data.description || "").trim();
    const amount = Number(data.amount);

    if (
      !name ||
      name.length > 80 ||
      !url ||
      !description ||
      description.length > 160 ||
      !Number.isFinite(amount) ||
      amount < 5
    ) {
      return json({
        error: "Complete all fields correctly. Minimum is 5 EUR."
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
        error: "URL must start with http:// or https://"
      }, 400);
    }

    const paypal = await paypalToken(env);

    const customData = JSON.stringify({
      name,
      url,
      description,
      amount
    });

    const order = await fetch(
      paypal.base + "/v2/checkout/orders",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + paypal.token,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          intent: "CAPTURE",
          purchase_units: [
            {
              description: "DealRank promotion",
              custom_id: customData.slice(0, 127),
              amount: {
                currency_code: "EUR",
                value: amount.toFixed(2)
              }
            }
          ]
        })
      }
    );

    const result = await order.json();

    if (!order.ok) {
      console.error("PAYPAL CREATE ORDER ERROR:", {
        status: order.status,
        data: result
      });

      return json({
        error: "PayPal could not create the order.",
        paypal_status: order.status,
        paypal_name: result.name || null,
        paypal_message: result.message || null,
        paypal_details: result.details || null
      }, 500);
    }

    if (!result.id) {
      return json({
        error: "PayPal returned an order without an ID."
      }, 500);
    }

    return json({
      id: result.id
    });

  } catch (error) {
    console.error("CREATE ORDER ERROR:", error);

    return json({
      error: error.message || "Could not create PayPal order."
    }, 500);
  }
}

async function captureOrder(request, env) {
  try {
    const body = await request.json();
    const orderID = String(body.orderID || "").trim();

    if (!orderID) {
      return json({
        error: "Missing PayPal order ID."
      }, 400);
    }

    const paypal = await paypalToken(env);

    const capture = await fetch(
      paypal.base +
      `/v2/checkout/orders/${encodeURIComponent(orderID)}/capture`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + paypal.token,
          "Content-Type": "application/json"
        }
      }
    );

    const data = await capture.json();

    if (!capture.ok) {
      console.error("PAYPAL CAPTURE ERROR:", {
        status: capture.status,
        data
      });

      return json({
        error: "PayPal capture failed.",
        paypal_status: capture.status,
        paypal_name: data.name || null,
        paypal_message: data.message || null,
        paypal_details: data.details || null
      }, 400);
    }

    const status =
      data.status ||
      data.purchase_units?.[0]?.payments?.captures?.[0]?.status;

    if (status !== "COMPLETED") {
      return json({
        error: "Payment was not completed.",
        paypal_status: status || null
      }, 400);
    }

    let meta = {};

    const custom =
      data.purchase_units?.[0]?.payments?.captures?.[0]?.custom_id;

    if (custom) {
      try {
        meta = JSON.parse(custom);
      } catch (error) {
        console.error("CUSTOM ID PARSE ERROR:", error);
      }
    }

    if (!meta.name || !meta.url || !meta.amount) {
      return json({
        error: "Payment completed but listing data is missing."
      }, 500);
    }

    if (!env.DB) {
      return json({
        error: "D1 database binding DB is missing."
      }, 500);
    }

    await env.DB
      .prepare(
        `INSERT INTO deals
        (name, url, description, amount, status, paypal_order_id)
        VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(
        meta.name,
        meta.url,
        meta.description || "",
        Number(meta.amount),
        "paid",
        orderID
      )
      .run();

    return json({
      ok: true
    });

  } catch (error) {
    console.error("CAPTURE ORDER ERROR:", error);

    return json({
      error: error.message || "Could not complete payment."
    }, 500);
  }
}

async function leaderboard(env) {
  try {
    if (!env.DB) {
      return json({
        error: "D1 database binding DB is missing."
      }, 500);
    }

    const result = await env.DB
      .prepare(
        `SELECT id, name, url, description, amount, created_at
         FROM deals
         WHERE status = 'paid'
         ORDER BY amount DESC, created_at DESC
         LIMIT 100`
      )
      .all();

   
