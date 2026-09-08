const { getStore } = require("@netlify/blobs");

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, OPTIONS"
    },
    body: JSON.stringify(body)
  };
}

exports.handler = async event => {

  if (event.httpMethod === "OPTIONS") {
    return response(200, {
      ok: true
    });
  }

  if (event.httpMethod !== "GET") {
    return response(405, {
      error: "Method not allowed."
    });
  }

  try {

    const store =
      getStore("dealrank");

    /*
     * Get every permanent Deal.
     */

    const result =
      await store.list({
        prefix: "deal:"
      });

    const deals = [];

    /*
     * Read each Deal.
     */

    for (const item of result.blobs || []) {

      try {

        const deal =
          await store.getJSON(
            item.key
          );

        if (
          deal &&
          deal.name &&
          deal.url &&
          Number.isFinite(
            Number(deal.amount)
          )
        ) {
          deals.push(deal);
        }

      } catch (error) {

        console.error(
          "DEAL READ ERROR:",
          item.key,
          error
        );

      }

    }


    /*
     * Highest paid Deal first.
     *
     * If two Deals have the same amount,
     * the older one keeps the higher position.
     */

    deals.sort(
      (a, b) => {

        const amountDifference =
          Number(b.amount) -
          Number(a.amount);

        if (
          amountDifference !== 0
        ) {
          return amountDifference;
        }

        return String(
          a.paidAt ||
          a.createdAt ||
          ""
        ).localeCompare(
          String(
            b.paidAt ||
            b.createdAt ||
            ""
          )
        );

      }
    );


    /*
     * Return a clean public version.
     */

    const publicDeals =
      deals.map(
        deal => ({
          name:
            deal.name,

          url:
            deal.url,

          description:
            deal.description,

          amount:
            Number(
              deal.amount
            ),

          currency:
            deal.currency ||
            "EUR",

          createdAt:
            deal.createdAt,

          paidAt:
            deal.paidAt
        })
      );


    return response(
      200,
      publicDeals
    );


  } catch (error) {

    console.error(
      "LEADERBOARD ERROR:",
      error
    );

    return response(500, {
      error:
        error.message ||
        "Unable to load leaderboard."
    });

  }
};
