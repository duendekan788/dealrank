
exports.handler = async event => {
  return {
    statusCode: 200,

    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    },

    body: JSON.stringify({
      clientId: process.env.PAYPAL_CLIENT_ID || "",
      mode: process.env.PAYPAL_MODE || "sandbox"
    })
  };
};
