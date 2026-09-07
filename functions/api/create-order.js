const MIN = 5;

function json(x, s = 200) {
  return new Response(JSON.stringify(x), {
    status: s,
    headers: {
      "content-type": "application/json"
    }
  });
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();

    const name = String(body.name || "").trim();
    const url = String(body.url || "").trim();
    const description = String(body.description || "").trim();
    const amount = Number(body.amount);

    if (
      name.length < 1 ||
      name.length > 80 ||
      description.length < 1 ||
      description.length > 160 ||
      !Number.isFinite(amount) ||
      amount < MIN
    ) {
      return json({
        error: "Invalid listing or amount. Minimum is 5 EUR."
      }, 400);
    }

    const u = new URL(url);

    if (!["http:", "https:"].includes(u.protocol)) {
      return json({
        error: "URL must start with http:// or https://"
      }, 400);
    }

    const base =
      env.PAYPAL_MODE === "live"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com";

    const auth = btoa(
      `${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`
    );

    const tok = await fetch(
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

    const td = await tok.json();

    if (!tok.ok) {
      return json({
        error: "PayPal authentication failed."
      }, 500);
    }

    const order = await fetch(
      base + "/v2/checkout/orders",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + td.access_token,
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

    const od = await order.json();

    if (!order.ok) {
      return json({
        error: "Could not create PayPal order.",
        paypal_status: order.status,
        paypal_name: od.name || null,
        paypal_message: od.message || null,
        paypal_details: od.details || null
      }, 500);
    }

    await env.DB.prepare(`
      INSERT INTO pending_orders
      (paypal_order_id, name, url, description, amount)
      VALUES (?, ?, ?, ?, ?)
    `)
      .bind(
        od.id,
        name,
        url,
        description,
        amount
      )
      .run();

    return json({
      id: od.id
    });

  } catch (e) {
    console.error("CREATE ORDER ERROR:", e);

    return json({
      error: e.message || "Invalid request."
    }, 400);
  }
}
