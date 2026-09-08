const { getStore } = require("@netlify/blobs");

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
        Authorization:
          `Basic ${credentials}`,

        "Content-Type":
          "application/x-www-form-urlencoded"
      },

      body:
        "grant_type=client_credentials"
    }
  );

  const text =
    await r.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = {};
  }

  if (
    !r.ok ||
    !data.access_token
  ) {
    console.error(
      "PAYPAL AUTH ERROR:",
      {
        status: r.status,
        data
      }
    );

    throw new Error(
      "PayPal authentication failed."
    );
  }

  return data.access_token;
}


exports.handler = async event => {

  if (
    event.httpMethod === "OPTIONS"
  ) {
    return response(200, {
      ok: true
    });
  }


  if (
    event.httpMethod !== "POST"
  ) {
    return response(405, {
      error:
        "Method not allowed."
    });
  }


  try {

    if (!event.body) {
      return response(400, {
        error:
          "Missing request body."
      });
    }


    let payload;

    try {
      payload =
        JSON.parse(event.body);
    } catch {
      return response(400, {
        error:
          "Invalid JSON."
      });
    }


    const orderID =
      String(
        payload.orderID || ""
      ).trim();


    if (!orderID) {
      return response(400, {
        error:
          "Missing PayPal order ID."
      });
    }


    const store =
      getStore("dealrank");


    /*
     * Check whether this order was already processed.
     */

    const existingDeal =
      await store.getJSON(
        `deal:${orderID}`
      );


    if (existingDeal) {

      return response(200, {
        ok: true,
        status:
          "COMPLETED",
        orderID,
        amount:
          existingDeal.amount,
        currency:
          "EUR",
        alreadyProcessed:
          true
      });
    }


    /*
     * Retrieve the information submitted
     * when the PayPal order was created.
     */

    const pending =
      await store.getJSON(
        `pending:${orderID}`
      );


    if (!pending) {

      return response(404, {
        error:
          "Pending deal was not found."
      });
    }


    const token =
      await getPayPalToken();


    const captureResponse =
      await fetch(
        `${paypalBase()}/v2/checkout/orders/${encodeURIComponent(orderID)}/capture`,
        {
          method: "POST",

          headers: {
            Authorization:
              `Bearer ${token}`,

            "Content-Type":
              "application/json",

            Accept:
              "application/json"
          }
        }
      );


    const text =
      await captureResponse.text();

    let data;

    try {
      data =
        JSON.parse(text);
    } catch {
      data = {};
    }


    if (!captureResponse.ok) {

      console.error(
        "PAYPAL CAPTURE ERROR:",
        {
          status:
            captureResponse.status,

          data
        }
      );

      return response(502, {
        error:
          "Unable to capture PayPal payment."
      });
    }


    if (
      data.status !==
      "COMPLETED"
    ) {

      return response(400, {
        error:
          "Payment was not completed.",

        status:
          data.status ||
          "UNKNOWN"
      });
    }


    const capture =
      data
        .purchase_units?.[0]
        ?.payments
        ?.captures?.[0];


    if (!capture) {

      return response(400, {
        error:
          "PayPal capture information is missing."
      });
    }


    if (
      capture.status !==
      "COMPLETED"
    ) {

      return response(400, {
        error:
          "Payment capture is not completed."
      });
    }


    const paidAmount =
      Number(
        capture.amount?.value
      );


    const currency =
      capture.amount?.currency_code;


    if (
      !Number.isFinite(
        paidAmount
      ) ||
      paidAmount < MIN_AMOUNT
    ) {

      return response(400, {
        error:
          "Invalid payment amount."
      });
    }


    if (
      currency !== "EUR"
    ) {

      return response(400, {
        error:
          "Invalid payment currency."
      });
    }


    /*
     * IMPORTANT:
     * Verify that PayPal actually charged
     * the amount originally requested.
     */

    const expectedAmount =
      Number(
        pending.amount
      );


    if (
      !Number.isFinite(
        expectedAmount
      ) ||
      Math.abs(
        paidAmount -
        expectedAmount
      ) > 0.001
    ) {

      console.error(
        "PAYMENT AMOUNT MISMATCH:",
        {
          expected:
            expectedAmount,

          paid:
            paidAmount
        }
      );

      return response(400, {
        error:
          "Payment amount does not match the deal."
      });
    }


    /*
     * Create the permanent Deal.
     *
     * The leaderboard will use these records.
     */

    const deal = {

      orderID,

      name:
        pending.name,

      url:
        pending.url,

      description:
        pending.description,

      amount:
        paidAmount,

      currency:
        "EUR",

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
     * Remove the temporary pending order.
     */

    await store.delete(
      `pending:${orderID}`
    );


    return response(200, {

      ok: true,

      status:
        "COMPLETED",

      orderID,

      amount:
        paidAmount,

      currency:
        "EUR"

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
