const { getStore } = require("@netlify/blobs");

const MIN_AMOUNT = 5;

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

    const orderID = String(
      body.orderID || ""
    ).trim();

    if (!orderID) {
      return json(400, {
        error: "orderID is required."
      });
    }

    const clientId =
      process.env.PAYPAL_CLIENT_ID;

    const secret =
      process.env.PAYPAL_SECRET;

    const mode =
      process.env.PAYPAL_MODE || "sandbox";

    if (!clientId || !secret) {
      return json(500, {
        error:
          "PayPal credentials are not configured."
      });
    }

    const paypalBase =
      mode === "live"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com";

    /*
      Netlify Blobs.
      Explicitly provide the site ID.
    */
    const store = getStore("dealrank", {
      siteID: process.env.NETLIFY_SITE_ID
    });

    /*
      Prevent duplicate captures.
    */
    const existing =
      await store.getJSON(
        `deal:${orderID}`
      );

    if (existing) {
      return json(200, {
        ok: true,
        deal: existing
      });
    }

    /*
      Retrieve the information saved
      when the PayPal order was created.
    */
    const pending =
      await store.getJSON(
        `pending:${orderID}`
      );

    if (!pending) {
      return json(404, {
        error:
          "Pending order not found."
      });
    }

    /*
      Authenticate with PayPal.
    */
    const auth = Buffer.from(
      `${clientId}:${secret}`
    ).toString("base64");

    const tokenResponse = await fetch(
      `${paypalBase}/v1/oauth2/token`,
      {
        method: "POST",
        headers: {
          Authorization:
            `Basic ${auth}`,
          "Content-Type":
            "application/x-www-form-urlencoded"
        },
        body:
          "grant_type=client_credentials"
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
        error:
          "Unable to authenticate with PayPal."
      });
    }

    /*
      Capture the PayPal order.
    */
    const captureResponse =
      await fetch(
        `${paypalBase}/v2/checkout/orders/${encodeURIComponent(orderID)}/capture`,
        {
          method: "POST",
          headers: {
            Authorization:
              `Bearer ${tokenData.access_token}`,
            "Content-Type":
              "application/json"
          }
        }
      );

    const captureData =
      await captureResponse.json();

    if (!captureResponse.ok) {
      console.error(
        "PAYPAL CAPTURE ERROR:",
        captureData
      );

      return json(500, {
        error:
          captureData?.message ||
          "Unable to capture PayPal payment."
      });
    }

    /*
      Verify PayPal payment status.
    */
    if (
      captureData.status !==
      "COMPLETED"
    ) {
      return json(400, {
        error:
          "PayPal payment was not completed."
      });
    }

    const purchaseUnit =
      captureData.purchase_units?.[0];

    const capture =
      purchaseUnit?.payments
        ?.captures?.[0];

    const paidAmount = Number(
      capture?.amount?.value
    );

    const currency =
      capture?.amount?.currency_code;

    if (
      !Number.isFinite(paidAmount) ||
      paidAmount < MIN_AMOUNT
    ) {
      return json(400, {
        error:
          "Invalid payment amount."
      });
    }

    if (currency !== "EUR") {
      return json(400, {
        error:
          "Payment currency must be EUR."
      });
    }

    /*
      Make sure the customer actually paid
      the amount originally requested.
    */
    const expectedAmount =
      Number(pending.amount);

    if (
      !Number.isFinite(expectedAmount) ||
      paidAmount !== expectedAmount
    ) {
      console.error(
        "AMOUNT MISMATCH:",
        {
          expectedAmount,
          paidAmount
        }
      );

      return json(400, {
        error:
          "Payment amount does not match the order."
      });
    }

    /*
      Create permanent leaderboard record.
    */
    const deal = {
      orderID,
      name: pending.name,
      url: pending.url,
      description:
        pending.description,
      amount: paidAmount,
      currency: "EUR",
      createdAt:
        pending.createdAt ||
        new Date().toISOString(),
      paidAt:
        new Date().toISOString()
    };

    await store.setJSON(
      `deal:${orderID}`,
      deal
    );

    /*
      Remove temporary order.
    */
    await store.delete(
      `pending:${orderID}`
    );

    return json(200, {
      ok: true,
      deal
    });

  } catch (error) {
    console.error(
      "CAPTURE ORDER ERROR:",
      error
    );

    return json(500, {
      error:
        error?.message ||
        "Internal server error."
    });
  }
};
