const API_BASE = "https://dealrank.pmorata000.workers.dev";

const $ = id => document.getElementById(id);

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function urlSafe(u) {
  try {
    const x = new URL(u);

    return /^https?:$/.test(x.protocol)
      ? x.href
      : "#";

  } catch {
    return "#";
  }
}

async function loadBoard() {

  const b = $("board");

  if (!b) return;

  b.innerHTML =
    '<div class="loading">Loading live board…</div>';

  try {

    const r = await fetch(
      `${API_BASE}/api/leaderboard`,
      {
        cache: "no-store"
      }
    );

    const d = await r.json();

    if (!r.ok) {
      throw Error(d.error || "Error");
    }

    $("count").textContent = d.length;

    $("value").textContent =
      "€" +
      d
        .reduce(
          (s, x) => s + Number(x.amount),
          0
        )
        .toLocaleString();

    b.innerHTML = d.length

      ? d.map((x, i) => `

        <div class="row">

          <div class="rank">
            #${i + 1}
          </div>

          <div class="deal">

            <strong>
              ${esc(x.name)}
            </strong>

            <p>
              ${esc(x.description)}
            </p>

            <a
              href="${urlSafe(x.url)}"
              target="_blank"
              rel="noopener"
            >
              ${esc(
                x.url.replace(/^https?:\/\//, "")
              )}
            </a>

          </div>

          <div class="amount">
            €${Number(x.amount).toLocaleString()}
          </div>

          <div class="visit">

            <a
              href="${urlSafe(x.url)}"
              target="_blank"
              rel="noopener"
            >
              Visit →
            </a>

          </div>

        </div>

      `).join("")

      : '<div class="loading">No paid deals yet. Be the first.</div>';

  } catch (e) {

    console.error(
      "LEADERBOARD ERROR:",
      e
    );

    b.innerHTML =
      '<div class="loading">Could not load the board.</div>';
  }
}


async function startPayPal() {

  const container =
    $("paypal-button-container");

  const msg =
    $("msg");

  if (!container) {
    return;
  }

  if (!window.paypal) {

    container.innerHTML =
      "<p>PayPal could not be loaded.</p>";

    if (msg) {
      msg.textContent =
        "ERROR: PayPal SDK is not available.";
    }

    return;
  }

  container.innerHTML = "";

  try {

    const buttons = paypal.Buttons({

      style: {
        layout: "vertical",
        shape: "rect",
        label: "paypal"
      },

      createOrder: async () => {

        const payload = {

          name:
            $("name").value.trim(),

          url:
            $("url").value.trim(),

          description:
            $("description").value.trim(),

          amount:
            Number($("amount").value)
        };

        if (
          !payload.name ||
          !payload.url ||
          !payload.description ||
          !Number.isFinite(payload.amount) ||
          payload.amount < 5
        ) {

          throw Error(
            "Complete all fields. Minimum is €5."
          );
        }

        if (msg) {
          msg.textContent =
            "Creating PayPal order…";
        }

        const r = await fetch(
          `${API_BASE}/api/create-order`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify(payload)
          }
        );

        const d =
          await r.json();

        if (!r.ok) {

          throw Error(
            d.error ||
            "Unable to create payment."
          );
        }

        if (!d.id) {

          throw Error(
            "PayPal did not return an order ID."
          );
        }

        return d.id;
      },

      onApprove: async data => {

        if (msg) {
          msg.textContent =
            "Confirming payment…";
        }

        const r = await fetch(
          `${API_BASE}/api/capture-order`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify({
                orderID:
                  data.orderID
              })
          }
        );

        const d =
          await r.json();

        if (!r.ok) {

          throw Error(
            d.error ||
            "Payment confirmation failed."
          );
        }

        if (msg) {

          msg.textContent =
            "Payment confirmed — your deal is live.";
        }

        $("form").reset();

        $("amount").value = 5;

        await loadBoard();
      },

      onCancel: data => {

        console.log(
          "PAYPAL CANCELLED:",
          data
        );

        if (msg) {
          msg.textContent =
            "Payment cancelled.";
        }
      },

      onError: e => {

        console.error(
          "PAYPAL ERROR:",
          e
        );

        if (msg) {

          msg.textContent =
            "PAYPAL ERROR: " +
            (
              e?.message ||
              JSON.stringify(e) ||
              "Unknown error"
            );
        }
      }

    });

    if (!buttons) {
      throw Error(
        "PayPal Buttons could not be created."
      );
    }

    await buttons.render(
      "#paypal-button-container"
    );

    if (msg) {
      msg.textContent =
        "PayPal ready.";
    }

  } catch (error) {

    container.innerHTML =
      "<p>Unable to initialize PayPal.</p>";

    if (msg) {

      msg.textContent =
        "ERROR: " +
        (
          error?.message ||
          "PayPal initialization failed."
        );
    }

    console.error(
      "PAYPAL INITIALIZATION ERROR:",
      error
    );
  }
}


loadBoard();
