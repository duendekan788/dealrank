function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

async function paypalToken(env) {
  const base =
    env.PAYPAL_MODE === "live"
      ? "https://api-m.paypal.com"
      : "https://api-m.sandbox.paypal.com";

  if (!env.PAYPAL_CLIENT_ID) {
    throw new Error("PAYPAL_CLIENT_ID is missing");
  }

  if (!env.PAYPAL_CLIENT_SECRET) {
    throw new Error("PAYPAL_CLIENT_SECRET is missing");
  }

  const auth = btoa(
    `${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`
  );

  const response = await fetch(base + "/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + auth,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `PayPal OAuth error: ${
        data.error_description || data.error || "unknown"
      }`
    );
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
      !url ||
      !description ||
      !Number.isFinite(amount) ||
      amount < 5
    ) {
      return json(
        {
          error: "Complete all fields. Minimum is 5 EUR."
        },
        400
      );
    }

    try {
      new URL(url);
    } catch {
      return json(
        {
          error: "Invalid URL."
        },
        400
      );
    }

    const paypal = await paypalToken(env);

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
      console.error("PayPal create order error:", result);

      return json(
        {
          error: "PayPal could not create the order.",
          paypal_status: order.status,
          paypal_name: result.name || null,
          paypal_message: result.message || null,
          paypal_details: result.details || null
        },
        500
      );
    }

    return json({
      id: result.id
    });
  } catch (error) {
    console.error("createOrder error:", error);

    return json(
      {
        error: error.message || "Could not create order."
      },
      500
    );
  }
}

async function captureOrder(request, env) {
  try {
    const data = await request.json();
    const orderID = data.orderID;

    if (!orderID) {
      return json(
        {
          error: "Missing orderID"
        },
        400
      );
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

    const result = await capture.json();

    if (!capture.ok) {
      console.error("PayPal capture error:", result);

      return json(
        {
          error: "PayPal capture failed.",
          paypal_status: capture.status,
          paypal_name: result.name || null,
          paypal_message: result.message || null,
          paypal_details: result.details || null
        },
        400
      );
    }

    const captureStatus =
      result.purchase_units?.[0]?.payments?.captures?.[0]?.status;

    if (
      result.status !== "COMPLETED" &&
      captureStatus !== "COMPLETED"
    ) {
      return json(
        {
          error: "Payment was not completed.",
          paypal_status: result.status,
          capture_status: captureStatus || null
        },
        400
      );
    }

    const meta =
      result.purchase_units?.[0]?.payments?.captures?.[0]
        ?.custom_id;

    /*
      PayPal
