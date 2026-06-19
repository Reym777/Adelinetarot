/* AdelineTarot — panel privado (lista de consultas + carta natal + informe) */
(function () {
  "use strict";

  var API_BASE = location.protocol === "file:" ? "http://127.0.0.1:8000" : "";
  var TOKEN_KEY = "adeline_admin_token";
  var token = sessionStorage.getItem(TOKEN_KEY) || "";

  function $(id) { return document.getElementById(id); }

  // Escapa todo dato de usuario antes de insertarlo en el DOM (anti-XSS).
  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function alertBox(container, message, kind) {
    container.innerHTML =
      '<div class="alert alert-' + (kind || "error") + '">' + esc(message) + "</div>";
  }

  function api(path) {
    return fetch(API_BASE + path, {
      method: "GET",
      headers: { Accept: "application/json", "X-Admin-Token": token },
    }).then(function (res) {
      if (res.status === 401) { throw new Error("401"); }
      return res.json().then(function (body) {
        if (!res.ok) {
          throw new Error((body && body.detail) || "Error " + res.status);
        }
        return body;
      });
    });
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return esc(iso);
    return d.toLocaleString("es-ES", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }
  function fmtBirth(iso) {
    if (!iso) return "—";
    var p = String(iso).split("-");
    return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : esc(iso);
  }

  // -------------------- autenticación --------------------
  function showLogin() {
    $("loginView").classList.remove("hidden");
    $("dashView").classList.add("hidden");
    $("logoutLink").classList.add("hidden");
  }
  function showDash() {
    $("loginView").classList.add("hidden");
    $("dashView").classList.remove("hidden");
    $("logoutLink").classList.remove("hidden");
  }

  function attemptLogin(candidate) {
    token = candidate;
    return api("/api/admin/me").then(function () {
      sessionStorage.setItem(TOKEN_KEY, token);
      showDash();
      loadBookings();
    });
  }

  function doLogin() {
    var btn = $("loginBtn");
    var val = $("tokenInput").value.trim();
    if (!val) { alertBox($("loginAlert"), "Introduce tu clave."); return; }
    btn.disabled = true; btn.textContent = "Entrando…";
    attemptLogin(val)
      .catch(function () {
        token = "";
        alertBox($("loginAlert"), "Clave incorrecta.");
      })
      .finally(function () { btn.disabled = false; btn.textContent = "Entrar"; });
  }

  function logout() {
    sessionStorage.removeItem(TOKEN_KEY);
    token = "";
    showLogin();
  }

  // -------------------- listado --------------------
  function badge(status) {
    var cls = status === "paid" ? "paid" : "pending";
    var label = status === "paid" ? "Pagado" : "Pendiente";
    return '<span class="badge ' + cls + '">' + label + "</span>";
  }

  function loadBookings() {
    api("/api/admin/bookings")
      .then(function (rows) {
        var paid = rows.filter(function (r) { return r.status === "paid"; }).length;
        $("statsLine").textContent =
          rows.length + " consultas · " + paid + " pagadas";
        var body = $("bookingsBody");
        if (!rows.length) {
          body.innerHTML = '<tr><td colspan="7" class="muted">Aún no hay consultas.</td></tr>';
          return;
        }
        body.innerHTML = rows
          .map(function (r) {
            return (
              '<tr data-id="' + r.id + '">' +
              "<td>" + esc(r.reference) + "</td>" +
              "<td>" + esc(r.full_name) + "</td>" +
              "<td>" + fmtBirth(r.birth_date) + "</td>" +
              "<td>" + esc(r.birth_place) + "</td>" +
              "<td>" + esc(r.amount) + " " + esc(r.currency) + "</td>" +
              "<td>" + badge(r.status) + "</td>" +
              "<td>" + fmtDate(r.created_at) + "</td>" +
              "</tr>"
            );
          })
          .join("");
        Array.prototype.forEach.call(body.querySelectorAll("tr[data-id]"), function (tr) {
          tr.addEventListener("click", function () { openDetail(tr.getAttribute("data-id")); });
        });
      })
      .catch(function (err) {
        if (err.message === "401") { logout(); return; }
        alertBox($("dashAlert"), err.message || "No se pudo cargar.");
      });
  }

  // -------------------- detalle --------------------
  function planetChips(planets) {
    if (!planets) return "";
    return Object.keys(planets)
      .map(function (name) {
        var p = planets[name];
        return '<div class="chip">' + esc(name) + ": <b>" + esc(p.sign) + " " +
          esc(p.symbol || "") + "</b> <span class=\"muted\">≈" + esc(p.degree) + "°</span></div>";
      })
      .join("");
  }

  function tarotCards(tarot) {
    if (!tarot || !tarot.length) return "";
    return (
      '<div class="tarot-row">' +
      tarot
        .map(function (c) {
          return (
            '<div class="tarot-mini">' +
            '<div class="pos">' + esc(c.position) + "</div>" +
            '<div class="name">' + esc(c.name) + "</div>" +
            '<div class="muted">' + esc(c.orientation) + "</div>" +
            "<p>" + esc(c.meaning) + ".</p>" +
            "</div>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function chartBlock(chart) {
    if (!chart) return '<p class="muted">La carta se genera al confirmar el pago.</p>';
    var sun = chart.sun || {}, moon = chart.moon || {}, asc = chart.ascendant;
    var html =
      '<div class="chips">' +
      '<div class="chip">☉ Sol: <b>' + esc(sun.sign) + " " + esc(sun.symbol || "") + "</b></div>" +
      '<div class="chip">☾ Luna: <b>' + esc(moon.sign) + " " + esc(moon.symbol || "") + "</b></div>" +
      (asc
        ? '<div class="chip">↑ Asc.: <b>' + esc(asc.sign) + " " + esc(asc.symbol || "") + "</b></div>"
        : '<div class="chip muted">Asc.: sin hora exacta</div>') +
      "</div>" +
      '<div class="chips" style="margin-top:10px">' + planetChips(chart.planets) + "</div>" +
      "<h3 style=\"color:var(--lilac);margin:18px 0 6px;font-size:1rem;letter-spacing:.1em\">TIRADA DE TAROT</h3>" +
      tarotCards(chart.tarot);
    return html;
  }

  function openDetail(id) {
    api("/api/admin/bookings/" + encodeURIComponent(id))
      .then(function (b) {
        $("mName").textContent = b.full_name;
        var video = b.video_url
          ? '<a href="' + esc(b.video_url) + '" target="_blank" rel="noopener" class="btn btn-primary" style="margin-top:8px">🎥 Entrar a la videollamada</a>'
          : '<p class="muted">Enlace pendiente de pago.</p>';

        var left =
          '<div class="kv"><span class="k">Referencia</span><span>' + esc(b.reference) + "</span></div>" +
          '<div class="kv"><span class="k">Correo</span><span>' + esc(b.email) + "</span></div>" +
          '<div class="kv"><span class="k">Nacimiento</span><span>' + fmtBirth(b.birth_date) +
          (b.birth_time ? " · " + esc(b.birth_time) : " · hora no indicada") + "</span></div>" +
          '<div class="kv"><span class="k">Lugar</span><span>' + esc(b.birth_place) + "</span></div>" +
          '<div class="kv"><span class="k">Plan</span><span>' + esc(b.amount) + " " + esc(b.currency) +
          " (cobro " + esc(b.charge_amount) + " " + esc(b.charge_currency) + ")</span></div>" +
          '<div class="kv"><span class="k">Estado</span><span>' + badge(b.status) + "</span></div>" +
          '<div class="kv"><span class="k">Pago</span><span>' + esc(b.payment_method || "—") +
          (b.paypal_order_id ? " · " + esc(b.paypal_order_id) : "") + "</span></div>" +
          '<div class="kv"><span class="k">Pagada</span><span>' + fmtDate(b.paid_at) + "</span></div>" +
          '<div style="margin-top:12px">' + video + "</div>" +
          '<h3 style="color:var(--lilac);margin:20px 0 8px;font-size:1rem;letter-spacing:.1em">CARTA NATAL</h3>' +
          chartBlock(b.chart);

        var right =
          '<h3 style="color:var(--lilac);margin:0 0 8px;font-size:1rem;letter-spacing:.1em">INFORME PARA LA SESIÓN</h3>' +
          '<div class="report-box">' + esc(b.report_text || "El informe se genera al confirmar el pago.") + "</div>";

        $("modalBody").innerHTML =
          '<div class="detail-grid"><div>' + left + "</div><div>" + right + "</div></div>";
        $("detailModal").classList.remove("hidden");
      })
      .catch(function (err) {
        if (err.message === "401") { logout(); return; }
        alertBox($("dashAlert"), err.message || "No se pudo abrir el detalle.");
      });
  }

  function closeModal() { $("detailModal").classList.add("hidden"); }

  // -------------------- arranque --------------------
  document.addEventListener("DOMContentLoaded", function () {
    $("loginBtn").addEventListener("click", doLogin);
    $("tokenInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter") doLogin();
    });
    $("refreshBtn").addEventListener("click", loadBookings);
    $("logoutLink").addEventListener("click", function (e) { e.preventDefault(); logout(); });
    $("closeModal").addEventListener("click", closeModal);
    $("detailModal").addEventListener("click", function (e) {
      if (e.target === $("detailModal")) closeModal();
    });

    if (token) {
      attemptLogin(token).catch(function () { logout(); });
    } else {
      showLogin();
    }
  });
})();
