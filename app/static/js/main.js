/**
 * main.js — BIA Energy App
 * JavaScript vanilla para interactividad de la app Flask
 */

// ── Flash messages auto-dismiss ───────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".bia-flash").forEach((el) => {
    setTimeout(() => {
      el.style.transition = "opacity 0.4s";
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 400);
    }, 5000);
  });
});

// ── Wizard de Cargas (multi-step) ─────────────────────────────────────────────

window.BiaWizard = (() => {
  let paso = 0;
  let state = {
    anio: null,
    mes: null,
    tipoFuente: null,
    orId: null,
    nombreArchivo: null,
    filasCompletas: [],
    alertas: [],
    erroresCriticos: [],
    existeCargaPrevia: false,
    cargaPreviaId: null,
  };

  function mostrarPaso(n) {
    document.querySelectorAll("[data-paso]").forEach((el) => {
      el.style.display = el.dataset.paso == n ? "" : "none";
    });
    actualizarSteps(n);
    paso = n;
  }

  function actualizarSteps(n) {
    document.querySelectorAll(".bia-step-circle").forEach((el, i) => {
      el.classList.toggle("done", i < n);
      el.classList.toggle("current", i === n);
      if (i < n) el.textContent = "✓";
      else el.textContent = i + 1;
    });
    document.querySelectorAll(".bia-step-label").forEach((el, i) => {
      el.classList.toggle("current", i === n);
    });
    document.querySelectorAll(".bia-step-line").forEach((el, i) => {
      el.classList.toggle("done", i < n);
    });
  }

  function siguiente() {
    mostrarPaso(paso + 1);
  }

  function atras() {
    mostrarPaso(paso - 1);
  }

  function setState(data) {
    state = { ...state, ...data };
  }

  function getState() {
    return state;
  }

  return { mostrarPaso, siguiente, atras, setState, getState };
})();

// ── Dropzone ──────────────────────────────────────────────────────────────────

function initDropzone(dropzoneId, inputId, labelId) {
  const zone  = document.getElementById(dropzoneId);
  const input = document.getElementById(inputId);
  const label = document.getElementById(labelId);
  if (!zone || !input) return;

  zone.addEventListener("click", () => input.click());

  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("drag-over");
  });

  zone.addEventListener("dragleave", () => {
    zone.classList.remove("drag-over");
  });

  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("drag-over");
    const file = e.dataTransfer?.files[0];
    if (file) {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      if (label) label.textContent = file.name;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });

  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file && label) label.textContent = file.name;
  });
}

// ── Fuente card selector ──────────────────────────────────────────────────────

function initFuenteCards() {
  document.querySelectorAll(".bia-fuente-card").forEach((card) => {
    card.addEventListener("click", () => {
      document.querySelectorAll(".bia-fuente-card").forEach((c) =>
        c.classList.remove("selected")
      );
      card.classList.add("selected");

      const tipo = card.dataset.tipo;
      const hiddenInput = document.getElementById("tipo_fuente_input");
      if (hiddenInput) hiddenInput.value = tipo;

      // Mostrar/ocultar selector de OR
      const orSection = document.getElementById("or-section");
      const requiresOr = card.dataset.requiresOr === "true";
      if (orSection) {
        orSection.style.display = requiresOr ? "" : "none";
      }

      // Habilitar botón siguiente del paso 1
      checkPaso1();
    });
  });
}

function checkPaso1() {
  const tipoFuente = document.getElementById("tipo_fuente_input")?.value;
  const orSection  = document.getElementById("or-section");
  const orSelect   = document.getElementById("or_id");
  const btn        = document.getElementById("btn-paso1-siguiente");
  if (!btn) return;

  const orVisible  = orSection && orSection.style.display !== "none";
  const orOk       = !orVisible || (orSelect && orSelect.value !== "");

  btn.disabled = !(tipoFuente && orOk);
}

// ── Preview table renderer ────────────────────────────────────────────────────

function renderPreviewTable(filas, containerId) {
  const container = document.getElementById(containerId);
  if (!container || !filas || filas.length === 0) return;

  const keys  = Object.keys(filas[0]);
  const thead = `<thead><tr>${keys.map((k) => `<th>${k}</th>`).join("")}</tr></thead>`;
  const tbody = `<tbody>${filas
    .map((f) => `<tr>${keys.map((k) => `<td>${f[k] ?? "—"}</td>`).join("")}</tr>`)
    .join("")}</tbody>`;

  container.innerHTML = `<div class="bia-table-container"><table>${thead}${tbody}</table></div>`;
}

// ── Alerts renderer ───────────────────────────────────────────────────────────

function renderAlertas(alertas, errores, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const items = [
    ...errores.map((a) => ({ ...a, nivel: "error" })),
    ...alertas,
  ];

  if (items.length === 0) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = items
    .map((a) => {
      const cls = a.nivel === "error" ? "bia-alert-error" : "bia-alert-warning";
      const prefix = a.fila ? `Fila ${a.fila}${a.campo ? ` · ${a.campo}` : ""}: ` : "";
      return `<div class="bia-alert ${cls}">${prefix}${a.mensaje}</div>`;
    })
    .join("");
}

// ── Confirmar carga ───────────────────────────────────────────────────────────

async function confirmarCarga(payload) {
  const res = await fetch("/cargas/api/confirmar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}
