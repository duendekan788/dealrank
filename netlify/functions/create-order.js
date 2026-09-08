const { getStore } = require("@netlify/blobs");

const MIN_AMOUNT = 5;
const MAX_AMOUNT = 10000;

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

  const text = await r.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = {};
  }

  if (!r.ok) {
    console.error("PAYPAL AUTH ERROR:", {
      status: r.status,
      error: data.error,
      description: data.error_description
    });

    throw new Error("PayPal authentication failed.");
  }

  if (!data.access_token) {
    throw new Error("PayPal did not return an access token.");
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

    const name =
      String(payload.name || "").trim();

    const url =
      String(payload.url || "").trim();

    const description =
      String(payload.description || "").trim();

    const amount =
      Number(payload.amount);


    if (!name) {
      return response(400, {
        error: "Deal name is required."
      });
    }

    if (name.length > 80) {
      return response(400, {
        error: "Deal name is too long."
      });
    }


    if (!description) {
      return response(400, {
        error: "Description is required."
      });
    }

    if (description.length > 160) {
      return response(400, {
        error: "Description is too long."
      });
    }


    let parsedUrl;

    try {
      parsedUrl = new URL(url);
    } catch {
      return response(400, {
        error: "Invalid URL."
      });
    }

    if (
      parsedUrl.protocol !== "http:" &&
      parsedUrl.protocol !== "https:"
    ) {
      return response(400, {
        error: "URL must use HTTP or HTTPS."
      });
    }


    if (
      !Number.isFinite(amount) ||
      amount < MIN_AMOUNT ||
      amount > MAX_AMOUNT
    ) {
      return response(400, {
        error:
          `Amount must be between €${MIN_AMOUNT} and €${MAX_AMOUNT}.`
      });
    }


    const paypalAmount =
      amount.toFixed(2);


    const token =
      await getPayPalToken();


    const orderResponse =
      await fetch(
        `${paypalBase()}/v2/checkout/orders`,
        {
          method: "POST",

          headers: {
            Authorization:
              `Bearer ${token}`,

            "Content-Type":
              "application/json",

            Accept:
              "application/json"
          },

          body: JSON.stringify({

            intent:
              "CAPTURE",

            purchase_units: [
              {
                amount: {
                  currency_code: "EUR",
                  value: paypalAmount
                },

                description:
                  `DealRank: ${name}`.slice(0, 127)
              }
            ],

            application_context: {
              brand_name: "DealRank",
              user_action: "PAY_NOW",
              shipping_preference: "NO_SHIPPING"
            }

          })
        }
      );


    const text =
      await orderResponse.text();

    let order;

    try {
      order = JSON.parse(text);
    } catch {
      order = {};
    }


    if (!orderResponse.ok) {

      console.error(
        "PAYPAL CREATE ORDER ERROR:",
        {
          status:
            orderResponse.status,

          data:
            order
        }
      );

      return response(502, {
        error:
          "Unable to create PayPal order."
      });
    }


    if (!order.id) {

      return response(502, {
        error:
          "PayPal did not return an order ID."
      });
    }


    /*
     * Save the deal information temporarily.
     *
     * It will be retrieved by capture-order.js
     * after PayPal confirms the payment.
     */

    const store =
      getStore("dealrank");

    await store.setJSON(
      `pending:${order.id}`,
      {
        orderID:
          order.id,

        name,
        url,
        description,

        amount,

        createdAt:
          new Date().toISOString()
      }
    );


    return response(200, {
      id:
        order.id
    });

  } catch (error) {

    console.error(
      "CREATE ORDER ERROR:",
      error
    );

    return response(500, {
      error:
        error.message ||
        "Unable to create payment."
    });
  }
};
