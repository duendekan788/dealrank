const { getStore } = require("@netlify/blobs");

const MIN_AMOUNT = 5;
const MAX_AMOUNT = 10000;

function json(statusCode, body) {
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

exports.handler = async event => {
  if (event.httpMethod === "OPTIONS") {
    return json(200, { ok: true });
  }

  if (event.httpMethod !== "POST") {
    return json(405, {
      error: "Method not allowed"
    });
  }

  try {
    const body = JSON.parse(event.body || "{}");

    const name = String(body.name || "").trim();
    const url = String(body.url || "").trim();
    const description = String(body.description || "").trim();
    const amount = Number(body.amount);

    if (!name) {
      return json(400, {
        error: "Name is required."
      });
    }

    if (!url) {
      return json(400, {
        error: "URL is required."
      });
    }

    let parsedUrl;

    try {
      parsedUrl = new URL(url);
    } catch {
      return json(400, {
        error: "Invalid URL."
      });
    }

    if (!/^https?:$/.test(parsedUrl.protocol)) {
      return json(400, {
        error: "URL must use http or https."
      });
    }

    if (!description) {
      return json(400, {
        error: "Description is required."
      });
    }

    if (
      !Number.isFinite(amount) ||
      amount < MIN_AMOUNT ||
      amount > MAX_AMOUNT
    ) {
      return json(400, {
        error: `Amount must be between €${MIN_AMOUNT} and €${MAX_AMOUNT}.`
      });
    }

    const clientId = process.env.PAYPAL_CLIENT_ID;
    const secret = process.env.PAYPAL_SECRET;
    const mode = process.env.PAYPAL_MODE || "sandbox";

    if (!clientId || !secret) {
      return json(500, {
        error: "PayPal credentials are not configured."
      });
    }

    const paypalBase =
      mode === "live"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com";

    const auth = Buffer.from(
      `${clientId}:${secret}`
    ).toString("base64");

    const tokenResponse = await fetch(
      `${paypalBase}/v1/oauth2/token`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type":
            "application/x-www-form-urlencoded"
        },
        body: "grant_type=client_credentials"
      }
    );

    const tokenData =
      await tokenResponse.json();

    if (
      !tokenResponse.ok ||
      !tokenData.access_token
    ) {
      console.error(
        "PAYPAL AUTH ERROR:",
        tokenData
      );

      return json(500, {
        error: "Unable to authenticate with PayPal."
      });
    }

    const orderResponse = await fetch(
      `${paypalBase}/v2/checkout/orders`,
      {
        method: "POST",
        headers: {
          Authorization:
            `Bearer ${tokenData.access_token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          intent: "CAPTURE",
          purchase_units: [
            {
              amount: {
                currency_code: "EUR",
                value: amount.toFixed(2)
              }
            }
          ]
        })
      }
    );

    const orderData =
      await orderResponse.json();

    if (
      !orderResponse.ok ||
      !orderData.id
    ) {
      console.error(
        "PAYPAL CREATE ORDER ERROR:",
        orderData
      );

      return json(500, {
        error: "Unable to create PayPal order."
      });
    }

    /*
      Netlify Blobs:
      We explicitly provide the site ID.
    */
    const store = getStore("dealrank", {
      siteID: process.env.NETLIFY_SITE_ID
    });

    await store.setJSON(
      `pending:${orderData.id}`,
      {
        orderID: orderData.id,
        name,
        url: parsedUrl.href,
        description,
        amount,
        currency: "EUR",
        createdAt:
          new Date().toISOString()
      }
    );

    return json(200, {
      id: orderData.id
    });

  } catch (error) {
    console.error(
      "CREATE ORDER ERROR:",
      error
    );

    return json(500, {
      error:
        error?.message ||
        "Internal server error."
    });
  }
};
