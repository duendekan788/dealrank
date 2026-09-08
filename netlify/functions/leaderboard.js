import { getStore } from "@netlify/blobs";

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, OPTIONS"
      }
    });
  }

  if (req.method !== "GET") {
    return new Response(
      JSON.stringify({
        error: "Method not allowed"
      }),
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
    const store =
      getStore("dealrank");

    const result =
      await store.list({
        prefix: "deal:"
      });

    const deals = [];

    for (
      const item of result.blobs || []
    ) {
      const deal =
        await store.getJSON(item.key);

      if (!deal) continue;

      deals.push({
        orderID: deal.orderID,
        name: deal.name,
        url: deal.url,
        description:
          deal.description,
        amount:
          Number(deal.amount),
        currency:
          deal.currency || "EUR",
        createdAt:
          deal.createdAt,
        paidAt:
          deal.paidAt
      });
    }

    deals.sort((a, b) => {
      const difference =
        Number(b.amount) -
        Number(a.amount);

      if (difference !== 0) {
        return difference;
      }

      return (
        new Date(a.createdAt).getTime() -
        new Date(b.createdAt).getTime()
      );
    });

    return new Response(
      JSON.stringify(deals),
      {
        status: 200,
        headers: {
          "Content-Type":
            "application/json",
          "Cache-Control":
            "no-store",
          "Access-Control-Allow-Origin":
            "*"
        }
      }
    );

  } catch (error) {
    console.error(
      "LEADERBOARD ERROR:",
      error
    );

    return new Response(
      JSON.stringify({
        error:
          error?.message ||
          "Unable to load leaderboard."
      }),
      {
        status: 500,
        headers: {
          "Content-Type":
            "application/json",
          "Access-Control-Allow-Origin":
            "*"
        }
      }
    );
  }
};
