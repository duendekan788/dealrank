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
    let x = new URL(u);
    return /^https?:$/.test(x.protocol) ? x.href : "#";
  } catch {
    return "#";
  }
}

async function loadBoard() {
  const b = $("board");
  b.innerHTML = '<div class="loading">Loading live board…</div>';

  try {
    const r = await fetch("/api/leaderboard");
    const d = await r.json();

    if (!r.ok) {
      throw Error(d.error || "Error");
    }

    $("count").textContent = d.length;

    $("value").textContent =
      "€" +
      d.reduce((s, x) => s + Number(x.amount), 0).toLocaleString();

    b.innerHTML = d.length
      ? d.map((x, i) => `
        <div class="row">
          <div class="rank">#${i + 1}</div>

          <div class="deal">
            <strong>${esc(x.name)}</strong>
            <p>${esc(x.description)}</p>

            <a href="${urlSafe(x.url)}"
               target="_blank"
               rel="noopener">
              ${esc(x.url.replace(/^https?:\/\//, ""))}
            </a>
          </div>

          <div class="amount">
            €${Number(x.amount).toLocaleString()}
          </div>

          <div class="visit">
            <a href="${urlSafe(x.url)}"
               target="_blank"
               rel="noopener">
              Visit →
            </a>
          </div>
        </div>
      `).join("")
      : '<div class="loading">No paid deals yet. Be the first.</div>';

  } catch (e) {
    console.error("LEADERBOARD ERROR:", e);
    b.innerHTML =
      '<div class="loading">Could not load the board.</div>';
  }
}


async function startPayPal() {

  const container = $("paypal-button-container");

  if (!container) {
    return;
  }

  if (!window.paypal) {
    container.innerHTML =
      '<p>PayPal could not be loaded.</p>';

    console.error("PayPal SDK is not available.");
    return;
  }

  container.innerHTML = "";

  try {

    paypal.Buttons({

      style: {
        layout: "vertical",
        shape: "rect",
        label: "paypal"
      },

      createOrder: async () => {

        const payload = {
          name: $("name").value.trim(),
          url: $("url").value.trim(),
          description: $("description").value.trim(),
          amount: Number($("amount").value)
        };

        if (
          !payload.name ||
          !payload.url ||
          !payload.description ||
          payload.amount < 5
        ) {
          throw Error(
            "Complete all fields. Minimum is €5."
          );
        }

        const r = await fetch(
          "/api/create-order",
          {
            method: "POST",
            headers: {
              "content-type": "application/json"
            },
            body: JSON.stringify(payload)
          }
        );

        const d = await r.json();

        if (!r.ok) {
          throw Error(
            d.error || "Unable to create payment"
          );
        }

        return d.id;
      },

      onApprove: async data => {

        $("msg").textContent =
          "Confirming payment…";

        const r = await fetch(
          "/api/capture-order",
          {
            method: "POST",
            headers: {
              "content-type": "application/json"
            },
            body: JSON.stringify({
              orderID: data.orderID
            })
          }
        );

        const d = await r.json();

        if (!r.ok) {
          throw Error(
            d.error || "Payment confirmation failed"
          );
        }

        $("msg").textContent =
          "Payment confirmed — your deal is live.";

        $("form").reset();

        $("amount").value = 5;

        loadBoard();
      },

      onError: e => {

        $("msg").textContent =
          "ERROR: " +
          (e?.message ||
           JSON.stringify(e) ||
           "Unknown error");

        console.error(
          "PAYPAL ERROR:",
          e
        );
      }

    }).render("#paypal-button-container");

  } catch (error) {

    container.innerHTML =
      '<p>Unable to initialize PayPal.</p>';

    $("msg").textContent =
      "ERROR: " +
      (error.message || "PayPal initialization failed.");

    console.error(
      "PAYPAL INITIALIZATION ERROR:",
      error
    );
  }
}


loadBoard();
