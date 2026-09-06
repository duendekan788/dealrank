export default {
  async fetch(request, env) {
    return new Response(
      JSON.stringify({
        ok: true,
        message: "DealRank Worker funciona"
      }),
      {
        headers: {
          "content-type": "application/json"
        }
      }
    );
  }
};
