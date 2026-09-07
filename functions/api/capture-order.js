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
    const { orderID } = await request.json();

    if (!orderID) {
      return json({
        error: "Missing orderID"
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
          "Content-Type":
            "application/x-www-form-urlencoded"
        },
        body:
          "grant_type=client_credentials"
      }
    );

    const td = await tok.json();

    if (!tok.ok) {
      return json({
        error: "PayPal authentication failed."
      }, 500);
    }

    const cap = await fetch(
      base +
        `/v2/checkout/orders/${encodeURIComponent(orderID)}/capture`,
      {
        method: "POST",
        headers: {
          Authorization:
            "Bearer " + td.access_token,
          "Content-Type":
            "application/json"
        }
      }
    );

    const cd = await cap.json();

    if (!cap.ok) {
      return json({
        error: "Capture failed.",
        paypal_status: cap.status,
        paypal_name: cd.name || null,
        paypal_message: cd.message || null
      }, 400);
    }

    const capture =
      cd.purchase_units?.[0]?.payments?.captures?.[0];

    if (
      cd.status !== "COMPLETED" &&
      capture?.status !== "COMPLETED"
    ) {
      return json({
        error: "Payment was not completed."
      }, 400);
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
      `)
        .bind(orderID)
        .first();

    if (!pending) {
      return json({
        error:
          "Payment completed but pending listing was not found."
      }, 500);
    }

    const paidAmount =
      Number(
        capture?.amount?.value ||
        cd.purchase_units?.[0]?.amount?.value ||
        0
      );

    if (
      !Number.isFinite(paidAmount) ||
      paidAmount !== Number(pending.amount)
    ) {
      return json({
        error:
          "Payment amount does not match the listing."
      }, 400);
    }

    await env.DB.prepare(`
      INSERT INTO deals
      (name, url, description, amount, status, paypal_order_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
      .bind(
        pending.name,
        pending.url,
        pending.description,
        pending.amount,
        "paid",
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
      ok: true
    });

  } catch (e) {
    console.error(
      "CAPTURE ORDER ERROR:",
      e
    );

    return json({
      error:
        e.message ||
        "Could not complete listing."
    }, 500);
  }
}
