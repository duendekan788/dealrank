const MIN_AMOUNT = 5;

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    },
    body: JSON.stringify(body)
  };
}

function paypalBase() {
  return process.env.PAYPAL_MODE === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

async function getPayPalToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_SECRET;

  if (!clientId || !secret) {
    throw new Error("PayPal credentials are not configured.");
  }

  const credentials = Buffer
    .from(`${clientId}:${secret}`)
    .toString("base64");

  const r = await fetch(
    `${paypalBase()}/v1/oauth2/token`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: "grant_type=client_credentials"
    }
  );

  const data = await r.json();

  if (!r.ok || !data.access_token) {
    throw new Error("PayPal authentication failed.");
  }

  return data.access_token;
}

exports.handler = async event => {

  if (event.httpMethod === "OPTIONS") {
    return response(200, { ok: true });
  }

  if (event.httpMethod !== "POST") {
    return response(405, {
      error: "Method not allowed."
    });
  }

  try {

    if (!event.body) {
      return response(400, {
        error: "Missing request body."
      });
    }

    let payload;

    try {
      payload = JSON.parse(event.body);
    } catch {
      return response(400, {
        error: "Invalid JSON."
      });
    }

    const orderID = String(
      payload.orderID || ""
    ).trim();

    if (!orderID) {
      return response(400, {
        error: "Missing PayPal order ID."
      });
    }

    const token = await getPayPalToken();

    const captureResponse = await fetch(
      `${paypalBase()}/v2/checkout/orders/${encodeURIComponent(orderID)}/capture`,
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        }
      }
    );

    const text = await captureResponse.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      data = {};
    }

    if (!captureResponse.ok) {

      console.error(
        "PAYPAL CAPTURE ERROR:",
        {
          status: captureResponse.status,
          data
        }
      );

      return response(502, {
        error: "Unable to capture PayPal payment."
      });
    }

    if (data.status !== "COMPLETED") {

      return response(400, {
        error: "Payment was not completed.",
        status: data.status || "UNKNOWN"
      });
    }

    const capture =
      data.purchase_units?.[0]
        ?.payments
        ?.captures?.[0];

    if (!capture) {
      return response(400, {
        error: "PayPal capture information is missing."
      });
    }

    if (capture.status !== "COMPLETED") {
      return response(400, {
        error: "Payment capture is not completed."
      });
    }

    const paidAmount =
      Number(
        capture.amount?.value
      );

    const currency =
      capture.amount?.currency_code;

    if (
      !Number.isFinite(paidAmount) ||
      paidAmount < MIN_AMOUNT
    ) {
      return response(400, {
        error: "Invalid payment amount."
      });
    }

    if (currency !== "EUR") {
      return response(400, {
        error: "Invalid payment currency."
      });
    }

    /*
     * Payment successfully captured.
     *
     * The next database step will store the
     * deal permanently and make it appear
     * on the leaderboard.
     */

    return response(200, {
      ok: true,
      status: "COMPLETED",
      orderID,
      amount: paidAmount,
      currency
    });

  } catch (error) {

    console.error(
      "CAPTURE ORDER ERROR:",
      error
    );

    return response(500, {
      error:
        error.message ||
        "Payment confirmation failed."
    });
  }
};
