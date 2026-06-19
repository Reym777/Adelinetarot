/* AdelineTarot — lógica del cliente (reserva + pago PayPal + enlace de videollamada) */
(function () {
  "use strict";

  // Mismo origen cuando lo sirve el backend; respaldo en file://
  var API_BASE = location.protocol === "file:" ? "http://127.0.0.1:8000" : "";

  var state = {
    publicToken: "",
    reference: "",
    fullName: "",
    birthDate: "",
    plan: "mxn",
    currency: "MXN",
    amount: 100,
    chargeCurrency: "MXN",
    chargeAmount: 100,
    paypalClientId: "",
    paypalMeUrl: "",
    paid: false,
  };

  var paypalScriptLoaded = "";

  // -------------------- utilidades --------------------
  function $(id) { return document.getElementById(id); }

  function alertBox(container, message, kind) {
    container.innerHTML =
      '<div class="alert alert-' + (kind || "error") + '">' + message + "</div>";
  }
  function clearAlert(container) { container.innerHTML = ""; }

  function api(path, options) {
    options = options || {};
    options.headers = Object.assign(
      { "Content-Type": "application/json", Accept: "application/json" },
      options.headers || {}
    );
    return fetch(API_BASE + path, options).then(function (res) {
      return res
        .json()
        .catch(function () { return {}; })
        .then(function (body) {
          if (!res.ok) {
            var msg = body && body.detail ? body.detail : "Ocurrió un error (" + res.status + ").";
            if (body && body.errors && body.errors.length) {
              msg = body.errors.map(function (e) { return e.msg; }).join(" · ");
            }
            throw new Error(typeof msg === "string" ? msg : "Error de validación.");
          }
          return body;
        });
    });
  }

  // signo solar (sólo para el detalle de cortesía al confirmar)
  var SIGNS = [
    { n: "Aries", s: "♈" }, { n: "Tauro", s: "♉" }, { n: "Géminis", s: "♊" },
    { n: "Cáncer", s: "♋" }, { n: "Leo", s: "♌" }, { n: "Virgo", s: "♍" },
    { n: "Libra", s: "♎" }, { n: "Escorpio", s: "♏" }, { n: "Sagitario", s: "♐" },
    { n: "Capricornio", s: "♑" }, { n: "Acuario", s: "♒" }, { n: "Piscis", s: "♓" },
  ];
  function sunSign(iso) {
    var p = iso.split("-");
    var m = parseInt(p[1], 10), d = parseInt(p[2], 10);
    var ranges = [
      [3, 21, 0], [4, 20, 1], [5, 21, 2], [6, 21, 3], [7, 23, 4], [8, 23, 5],
      [9, 23, 6], [10, 23, 7], [11, 22, 8], [12, 22, 9], [1, 20, 10], [2, 19, 11],
    ];
    var chosen = 9;
    ranges
      .slice()
      .sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; })
      .forEach(function (r) {
        if (m > r[0] || (m === r[0] && d >= r[1])) chosen = r[2];
      });
    return SIGNS[chosen];
  }

  // -------------------- config inicial --------------------
  function loadConfig() {
    api("/api/config", { method: "GET" })
      .then(function (cfg) {
        if (cfg.prices) {
          $("amtMxn").textContent = String(cfg.prices.mxn);
          $("amtPen").textContent = String(cfg.prices.pen);
        }
      })
      .catch(function () { /* valores por defecto del HTML */ });
  }

  // -------------------- selección de plan --------------------
  function wirePlans() {
    var plans = document.querySelectorAll("#plans .plan");
    plans.forEach(function (p) {
      p.addEventListener("click", function () {
        plans.forEach(function (x) { x.classList.remove("selected"); });
        p.classList.add("selected");
        p.querySelector("input").checked = true;
        state.plan = p.getAttribute("data-plan");
      });
    });
  }

  // -------------------- envío del formulario --------------------
  function handleSubmit(e) {
    e.preventDefault();
    var alertC = $("formAlert");
    clearAlert(alertC);

    var payload = {
      full_name: $("full_name").value.trim(),
      email: $("email").value.trim(),
      birth_date: $("birth_date").value,
      birth_place: $("birth_place").value.trim(),
      plan: state.plan,
      website: $("website").value,
    };
    var timeVal = $("birth_time").value;
    if (timeVal) payload.birth_time = timeVal;

    if (!payload.full_name || !payload.email || !payload.birth_date || !payload.birth_place) {
      alertBox(alertC, "Por favor completa todos los campos obligatorios.");
      return;
    }

    var btn = $("submitBtn");
    btn.disabled = true;
    btn.textContent = "Preparando tu carta…";

    api("/api/bookings", { method: "POST", body: JSON.stringify(payload) })
      .then(function (res) {
        state.publicToken = res.public_token;
        state.reference = res.reference;
        state.fullName = payload.full_name;
        state.birthDate = payload.birth_date;
        state.currency = res.currency;
        state.amount = res.amount;
        state.chargeCurrency = res.charge_currency;
        state.chargeAmount = res.charge_amount;
        state.paypalClientId = res.paypal_client_id;
        state.paypalMeUrl = res.paypal_me_url;
        goToPayment();
      })
      .catch(function (err) {
        alertBox(alertC, err.message || "No se pudo registrar la reserva.");
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = "Continuar al pago";
      });
  }

  // -------------------- paso de pago --------------------
  function goToPayment() {
    $("stepForm").classList.add("hidden");
    $("stepDone").classList.add("hidden");
    $("stepPay").classList.remove("hidden");

    $("payAmount").textContent = state.amount + " " + state.currency;
    $("payName").textContent = state.fullName;
    $("payRef").textContent = state.reference;

    var link = $("paypalMeLink");
    link.href = state.paypalMeUrl || "#";

    var note = $("paypalNote");
    note.innerHTML = "";

    if (state.paypalClientId) {
      renderPayPalButtons();
    } else {
      alertBox(
        note,
        "Pago en vivo de PayPal no configurado. Usa <strong>PayPal.Me</strong> y luego pulsa “Ya pagué”.",
        "ok"
      );
    }
    $("stepPay").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function loadPayPalSDK(clientId, currency) {
    return new Promise(function (resolve, reject) {
      if (paypalScriptLoaded === currency && window.paypal) { resolve(); return; }
      // Si ya había un SDK con otra divisa, lo quitamos para recargar.
      var old = document.getElementById("paypal-sdk");
      if (old) { old.remove(); try { delete window.paypal; } catch (e) { window.paypal = undefined; } }
      var s = document.createElement("script");
      s.id = "paypal-sdk";
      s.src =
        "https://www.paypal.com/sdk/js?client-id=" +
        encodeURIComponent(clientId) +
        "&currency=" + encodeURIComponent(currency) +
        "&intent=capture&components=buttons";
      s.onload = function () { paypalScriptLoaded = currency; resolve(); };
      s.onerror = function () { reject(new Error("No se pudo cargar PayPal.")); };
      document.head.appendChild(s);
    });
  }

  function renderPayPalButtons() {
    var container = $("paypal-buttons");
    container.innerHTML = "";
    loadPayPalSDK(state.paypalClientId, state.chargeCurrency)
      .then(function () {
        window.paypal
          .Buttons({
            style: { color: "gold", shape: "pill", label: "paypal" },
            createOrder: function (data, actions) {
              return actions.order.create({
                purchase_units: [
                  {
                    description: "AdelineTarot · Carta astral + Tarot",
                    amount: {
                      value: Number(state.chargeAmount).toFixed(2),
                      currency_code: state.chargeCurrency,
                    },
                  },
                ],
              });
            },
            onApprove: function (data, actions) {
              return actions.order.capture().then(function (details) {
                confirmPayment("paypal", (details && details.id) || data.orderID);
              });
            },
            onError: function () {
              alertBox($("payAlert"), "PayPal devolvió un error. Intenta con PayPal.Me.");
            },
          })
          .render("#paypal-buttons");
      })
      .catch(function (err) {
        alertBox($("paypalNote"), err.message + " Usa PayPal.Me y “Ya pagué”.");
      });
  }

  function confirmPayment(method, orderId) {
    if (state.paid) { return; }
    var alertC = $("payAlert");
    clearAlert(alertC);
    var btn = $("confirmPaidBtn");
    btn.disabled = true;
    btn.textContent = "Verificando…";

    api("/api/bookings/" + encodeURIComponent(state.publicToken) + "/pay", {
      method: "POST",
      body: JSON.stringify({ method: method, paypal_order_id: orderId || null, website: "" }),
    })
      .then(function (res) {
        state.paid = true;
        showConfirmation(res);
      })
      .catch(function (err) {
        alertBox(alertC, err.message || "No se pudo confirmar el pago.");
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = "Ya pagué — generar mi enlace";
      });
  }

  // -------------------- confirmación --------------------
  function showConfirmation(res) {
    $("stepPay").classList.add("hidden");
    $("stepDone").classList.remove("hidden");

    $("videoRoom").textContent = res.video_url || "";
    var enter = $("enterCall");
    enter.href = res.video_url || "#";

    if (state.birthDate) {
      var sign = sunSign(state.birthDate);
      $("teaserBox").innerHTML =
        '<div class="teaser">' + sign.s + " Tu signo solar: <strong>&nbsp;" +
        sign.n + "</strong></div>";
    }
    $("stepDone").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // -------------------- enlaces / arranque --------------------
  function wireControls() {
    $("bookingForm").addEventListener("submit", handleSubmit);
    $("confirmPaidBtn").addEventListener("click", function () {
      confirmPayment("paypalme", null);
    });
    $("backToForm").addEventListener("click", function (e) {
      e.preventDefault();
      $("stepPay").classList.add("hidden");
      $("stepForm").classList.remove("hidden");
      $("stepForm").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    var y = $("year");
    if (y) y.textContent = new Date().getFullYear();
  }

  document.addEventListener("DOMContentLoaded", function () {
    wireControls();
    wirePlans();
    loadConfig();
  });
})();
