const { getStore } = require("@netlify/blobs");

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, OPTIONS"
    },
    body: JSON.stringify(body)
  };
}

exports.handler = async event => {
  if (event.httpMethod === "OPTIONS") {
    return json(200, { ok: true });
  }

  if (event.httpMethod !== "GET") {
    return json(405, {
      error: "Method not allowed"
    });
  }

  try {
    const store = getStore("dealrank", {
      siteID: process.env.NETLIFY_SITE_ID
    });

    const result = await store.list({
      prefix: "deal:"
    });

    const deals = [];

    for (const key of result.blobs || []) {
      const deal = await store.getJSON(key.key);

      if (!deal) continue;

      deals.push({
        orderID: deal.orderID,
        name: deal.name,
        url: deal.url,
        description: deal.description,
        amount: Number(deal.amount),
        currency: deal.currency || "EUR",
        createdAt: deal.createdAt,
        paidAt: deal.paidAt
      });
    }

    deals.sort((a, b) => {
      const amountDifference =
        Number(b.amount) -
        Number(a.amount);

      if (amountDifference !== 0) {
        return amountDifference;
      }

      return (
        new Date(a.createdAt).getTime() -
        new Date(b.createdAt).getTime()
      );
    });

    return json(200, deals);

  } catch (error) {
    console.error(
      "LEADERBOARD ERROR:",
      error
    );

    return json(500, {
      error:
        error?.message ||
        "Unable to load leaderboard."
    });
  }
};
