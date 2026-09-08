exports.handler = async event => {

  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({
        error: "Method not allowed."
      })
    };
  }

  /*
   * Temporary response.
   *
   * The permanent database/storage layer will be
   * connected in the next step.
   */

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    },
    body: JSON.stringify([])
  };
};
