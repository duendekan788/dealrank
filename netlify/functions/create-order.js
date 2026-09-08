import { getStore } from "@netlify/blobs";

const MIN_AMOUNT = 5;
const MAX_AMOUNT = 10000;

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

    const name = String(body.name || "").trim();
    const url = String(body.url || "").trim();
    const description = String(body.description || "").trim();
    const amount = Number(body.amount);

    if (!name) {
      return new Response(
        JSON.stringify({ error: "Name is required." }),
        { status: 400 }
      );
    }

    if (!url) {
      return new Response(
        JSON.stringify({ error: "URL is required." }),
        { status: 400 }
      );
    }

    let parsedUrl;

    try {
      parsedUrl = new URL(url);
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid URL." }),
        { status: 400 }
      );
    }

    if (!/^https?:$/.test(parsedUrl.protocol)) {
      return new Response(
        JSON.stringify({
          error: "URL must use http or https."
        }),
        { status: 400 }
      );
    }

    if (!description) {
      return new Response(
        JSON.stringify({
          error: "Description is required."
        }),
        { status: 400 }
      );
    }

    if (
      !Number.isFinite(amount) ||
      amount < MIN_AMOUNT ||
      amount > MAX_AMOUNT
    ) {
      return new Response(
        JSON.stringify({
          error:
            `Amount must be between €${MIN_AMOUNT} and €${MAX_AMOUNT}.`
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

    const orderResponse = await fetch(
      `${paypalBase}/v2/checkout/orders`,
      {
        method: "POST",
        headers: {
          Authorization:
            `Bearer ${tokenData.access_token}`,
          "Content-Type":
            "application/json"
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

      return new Response(
        JSON.stringify({
          error:
            "Unable to create PayPal order."
        }),
        { status: 500 }
      );
    }

    const store =
      getStore("dealrank");

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

    return new Response(
      JSON.stringify({
        id: orderData.id
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
      "CREATE ORDER ERROR:",
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
