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
    throw new Error("PayPal authentication failed");
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

    if (!name || !url || !description || !Number.isFinite(amount) || amount < 5) {
      return json({
        error: "Complete all fields. Minimum is 5."
      }, 400);
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
              amount: {
                currency_code: "EUR",
                value: amount.toFixed(2)
              },
              custom_id: JSON.stringify({
                name,
                url,
                description,
                amount
              })
            }
          ]
        })
      }
    );

    const result = await order.json();

    if (!order.ok) {
      return json({
        error: "Could not create PayPal order."
      }, 500);
    }

    return json({
      id: result.id
    });

  } catch (error) {
    return json({
      error: "Could not create order."
    }, 500);
  }
}

async function captureOrder(request, env) {
  try {
    const { orderID } = await request.json();

    if (!orderID) {
      return json({
        error: "Missing orderID"
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
      return json({
        error: "Capture failed."
      }, 400);
    }

    const status =
      data.status ||
      data.purchase_units?.[0]?.payments?.captures?.[0]?.status;

    if (status !== "COMPLETED") {
      return json({
        error: "Payment was not completed."
      }, 400);
    }

    let meta = {};

    const custom =
      data.purchase_units?.[0]?.payments?.captures?.[0]?.custom_id;

    if (custom) {
      try {
        meta = JSON.parse(custom);
      } catch {}
    }

    if (!meta.name || !meta.url || !meta.amount) {
      return json({
        error: "Payment completed but listing data is missing."
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
    return json({
      error: "Could not complete listing."
    }, 500);
  }
}

async function leaderboard(env) {
  try {
    const result = await env.DB
      .prepare(
        `SELECT id, name, url, description, amount, created_at
         FROM deals
         WHERE status = 'paid'
         ORDER BY amount DESC, created_at DESC
         LIMIT 100`
      )
      .all();

    return json(result.results || []);

  } catch (error) {
    return json({
      error: "Could not load leaderboard."
    }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/create-order" && request.method === "POST") {
      return createOrder(request, env);
    }

    if (url.pathname === "/api/capture-order" && request.method === "POST") {
      return captureOrder(request, env);
    }

    if (url.pathname === "/api/leaderboard" && request.method === "GET") {
      return leaderboard(env);
    }

    return env.ASSETS.fetch(request);
  }
};
