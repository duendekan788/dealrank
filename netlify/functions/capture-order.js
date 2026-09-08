import { getStore } from "@netlify/blobs";

const MIN_AMOUNT = 5;

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      }
    });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      }
    );
  }

  try {
    const body = await req.json();

    const orderID = String(
      body.orderID || ""
    ).trim();

    if (!orderID) {
      return new Response(
        JSON.stringify({
          error: "orderID is required."
        }),
        { status: 400 }
      );
    }

    const clientId =
      process.env.PAYPAL_CLIENT_ID;

    const secret =
      process.env.PAYPAL_SECRET;

    const mode =
      process.env.PAYPAL_MODE || "sandbox";

    if (!clientId || !secret) {
      return new Response(
        JSON.stringify({
          error:
            "PayPal credentials are not configured."
        }),
        { status: 500 }
      );
    }

    const paypalBase =
      mode === "live"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com";

    const store =
      getStore("dealrank");

    const existing =
      await store.getJSON(
        `deal:${orderID}`
      );

    if (existing) {
      return new Response(
        JSON.stringify({
          ok: true,
          deal: existing
        }),
        {
          status: 200,
          headers: {
            "Content-Type":
              "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        }
      );
    }

    const pending =
      await store.getJSON(
        `pending:${orderID}`
      );

    if (!pending) {
      return new Response(
        JSON.stringify({
          error:
            "Pending order not found."
        }),
        { status: 404 }
      );
    }

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

      return new Response(
        JSON.stringify({
          error:
            "Unable to authenticate with PayPal."
        }),
        { status: 500 }
      );
    }

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

      return new Response(
        JSON.stringify({
          error:
            captureData?.message ||
            "Unable to capture PayPal payment."
        }),
        { status: 500 }
      );
    }

    if (
      captureData.status !==
      "COMPLETED"
    ) {
      return new Response(
        JSON.stringify({
          error:
            "PayPal payment was not completed."
        }),
        { status: 400 }
      );
    }

    const purchaseUnit =
      captureData.purchase_units?.[0];

    const capture =
      purchaseUnit?.payments
        ?.captures?.[0];

    const paidAmount =
      Number(capture?.amount?.value);

    const currency =
      capture?.amount?.currency_code;

    if (
      !Number.isFinite(paidAmount) ||
      paidAmount < MIN_AMOUNT
    ) {
      return new Response(
        JSON.stringify({
          error:
            "Invalid payment amount."
        }),
        { status: 400 }
      );
    }

    if (currency !== "EUR") {
      return new Response(
        JSON.stringify({
          error:
            "Payment currency must be EUR."
        }),
        { status: 400 }
      );
    }

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

      return new Response(
        JSON.stringify({
          error:
            "Payment amount does not match the order."
        }),
        { status: 400 }
      );
    }

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

    await store.delete(
      `pending:${orderID}`
    );

    return new Response(
      JSON.stringify({
        ok: true,
        deal
      }),
      {
        status: 200,
        headers: {
          "Content-Type":
            "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      }
    );

  } catch (error) {
    console.error(
      "CAPTURE ORDER ERROR:",
      error
    );

    return new Response(
      JSON.stringify({
        error:
          error?.message ||
          "Internal server error."
      }),
      {
        status: 500,
        headers: {
          "Content-Type":
            "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      }
    );
  }
};
