/* ==========================================================================
   dashboard.js
   Orchestrates the dashboard: loads data, renders KPI counters, findings,
   priority list, mental-health summary, wires up filters, and builds the
   searchable/sortable summary table. No personally identifying data ever
   passes through this file.
   ========================================================================== */

(function () {
  "use strict";

  const ICONS = {
    tooth: "bi-emoji-smile",
    eye: "bi-eye",
    apple: "bi-apple",
    weight: "bi-speedometer2",
    thermometer: "bi-thermometer-half",
    hospital: "bi-hospital",
  };

  function animateCounter(el, target, opts = {}) {
    const duration = opts.duration || 1200;
    const decimals = opts.decimals || 0;
    const suffix = opts.suffix || "";
    const start = performance.now();
    const from = 0;
    // A newer value (e.g. from a filter change) cancels this count-up.
    const token = (el._animToken = (el._animToken || 0) + 1);
    function frame(now) {
      if (el._animToken !== token) return;
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const val = from + (target - from) * eased;
      el.textContent = val.toFixed(decimals) + suffix;
      if (t < 1) requestAnimationFrame(frame);
      else {
        el.textContent = target.toFixed(decimals) + suffix;
        el.dataset.done = "1";
      }
    }
    requestAnimationFrame(frame);
  }

  function renderKPIs(d) {
    const k = d.kpis;
    const cards = [
      { id: "kpiTotal", value: k.total_students, label: "Students Screened", icon: "bi-people-fill", tint: "teal" },
      { id: "kpiFemale", value: k.female_students, label: "Female Students", icon: "bi-gender-female", tint: "marigold" },
      { id: "kpiMale", value: k.male_students, label: "Male Students", icon: "bi-gender-male", tint: "teal" },
      { id: "kpiAvgBmi", value: k.average_bmi, label: "Average BMI", icon: "bi-clipboard2-pulse", tint: "teal", decimals: 1 },
      { id: "kpiNormalBmi", value: k.normal_bmi_percent, label: "Normal BMI", icon: "bi-heart-pulse", tint: "good", suffix: "%", decimals: 1 },
      { id: "kpiAttention", value: k.students_requiring_attention, label: "Require Attention", icon: "bi-exclamation-triangle", tint: "warn", hint: "Students with at least one BMI, vision, dental, nutrition, illness or referral finding" },
      { id: "kpiDental", value: k.dental_findings, label: "Dental Findings", icon: "bi-emoji-smile", tint: "marigold" },
      { id: "kpiVision", value: k.vision_concerns, label: "Vision Concerns", icon: "bi-eye", tint: "teal", hint: `Among the ${k.vision_tested} students with a recorded distance-vision reading` },
      { id: "kpiReferrals", value: k.referrals_required, label: "Referrals Advised", icon: "bi-hospital", tint: "alert", hint: "Specialist opinion or referral advised (formal referral field, or clinician remark)" },
    ];

    const grid = document.getElementById("kpiGrid");
    grid.innerHTML = cards.map((card) => `
      <div class="kpi-card reveal" title="${card.hint || ""}" style="--kpi-bg:var(--${card.tint === "good" ? "good-100" : card.tint === "warn" ? "warn-100" : card.tint === "alert" ? "alert-100" : card.tint === "marigold" ? "marigold-100" : "teal-100"}); --kpi-fg:var(--${card.tint === "good" ? "good-600" : card.tint === "warn" ? "warn-600" : card.tint === "alert" ? "alert-600" : card.tint === "marigold" ? "marigold-600" : "teal-700"});">
        <div class="kpi-icon"><i class="bi ${card.icon}"></i></div>
        <div class="kpi-value" data-target="${card.value ?? ""}" data-done="${card.value == null ? 1 : 0}" data-decimals="${card.decimals || 0}" data-suffix="${card.suffix || ""}" id="${card.id}">${card.value == null ? "&lt;5" : 0}</div>
        <div class="kpi-label">${card.label}</div>
      </div>
    `).join("");

    // animate when visible
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const el = entry.target;
          observer.unobserve(el);
          // Skip if a filter already set this value (or it is a hidden "<5" cell).
          if (el.dataset.done === "1") return;
          animateCounter(el, parseFloat(el.dataset.target), { decimals: parseInt(el.dataset.decimals), suffix: el.dataset.suffix });
        }
      });
    }, { threshold: 0.4 });
    document.querySelectorAll(".kpi-value").forEach((el) => observer.observe(el));
  }

  function renderKeyFindings(d) {
    const wrap = document.getElementById("keyFindings");
    wrap.innerHTML = d.key_findings.map((f) =>
      `<div class="finding-card reveal"><div class="emoji">📊</div><p>${escapeHtml(f)}</p></div>`
    ).join("");
  }

  function renderPriorityAreas(d) {
    const wrap = document.getElementById("priorityAreas");
    const max = Math.max(...d.priority_areas.map((p) => p.percent), 1);
    wrap.innerHTML = d.priority_areas.map((p) => `
      <div class="priority-row reveal">
        <div class="priority-icon"><i class="bi ${ICONS[p.icon] || "bi-clipboard-pulse"}"></i></div>
        <div>
          <div style="display:flex; justify-content:space-between; font-weight:600;">
            <span>${escapeHtml(p.area)}</span>
            <span class="text-body-secondary" style="font-weight:500; font-size:0.85rem;">${p.count} students</span>
          </div>
          <div class="priority-bar-track"><div class="priority-bar-fill" data-width="${(p.percent / max) * 100}"></div></div>
        </div>
        <div class="priority-pct">${p.percent}%</div>
      </div>
    `).join("");

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.querySelectorAll(".priority-bar-fill").forEach((bar) => {
            bar.style.width = bar.dataset.width + "%";
          });
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.3 });
    observer.observe(wrap);
  }

  function renderMentalHealth(d) {
    const mh = d.mental_health;
    const wrap = document.getElementById("mentalHealthCard");
    if (mh.status === "no_responses_recorded") {
      wrap.innerHTML = `
        <span class="mh-badge"><i class="bi bi-shield-lock"></i> Screening indicator — not a clinical diagnosis</span>
        <h3>Mental Health Screening Summary</h3>
        <p style="max-width:60ch; color:rgba(255,255,255,0.85);">${escapeHtml(mh.message)}</p>
        <p style="color:rgba(255,255,255,0.6); font-size:0.85rem;">Individual responses, if collected in future camps, will only ever be shown here as suppressed, aggregate totals — never as identifiable records.</p>
      `;
      return;
    }
    const cats = mh.categories || {};
    const statRow = (label, val) => `
      <div class="mh-stat">
        <b>${val === null || val === undefined ? "—" : val}</b>
        <span>${label}</span>
      </div>`;
    wrap.innerHTML = `
      <span class="mh-badge"><i class="bi bi-shield-lock"></i> Screening indicator — not a clinical diagnosis</span>
      <h3>Mental Health Screening Summary</h3>
      <p style="color:rgba(255,255,255,0.85);">${mh.students_with_recorded_responses} of ${d.kpis.total_students} students had recorded screening responses.</p>
      <div class="mh-stat-grid">
        ${statRow("No immediate concern (0–2 flagged)", cats.no_immediate_concern)}
        ${statRow("Mild concern (3–5 flagged)", cats.mild_concern)}
        ${statRow("Strong indication (6+ flagged)", cats.strong_concern)}
      </div>
      <p style="color:rgba(255,255,255,0.6); font-size:0.8rem; margin-top:1rem;">${escapeHtml(mh.suppressed_note || "")}</p>
    `;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ------------------------------------------------------------------------
  // Summary table: search, sort, pagination
  // ------------------------------------------------------------------------
  let tableRows = [];
  let sortState = { col: null, dir: 1 };
  let currentPage = 1;
  const PAGE_SIZE = 8;

  function renderTable() {
    const searchTerm = (document.getElementById("tableSearch").value || "").toLowerCase();
    let rows = tableRows.filter((r) => r.indicator.toLowerCase().includes(searchTerm));

    if (sortState.col) {
      rows = [...rows].sort((a, b) => {
        const av = a[sortState.col];
        const bv = b[sortState.col];
        if (typeof av === "number") return (av - bv) * sortState.dir;
        return String(av).localeCompare(String(bv)) * sortState.dir;
      });
    }

    const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    currentPage = Math.min(currentPage, totalPages);
    const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

    const tbody = document.querySelector("#summaryTable tbody");
    tbody.innerHTML = pageRows.map((r) => `
      <tr>
        <td>${escapeHtml(r.indicator)}</td>
        <td>${r.students}</td>
        <td>${r.percent}%</td>
        <td><span class="status-pill ${r.status === "Good" ? "status-good" : "status-attention"}">${r.status}</span></td>
      </tr>
    `).join("") || `<tr><td colspan="4" class="text-center text-body-secondary py-4">No matching indicators.</td></tr>`;

    document.getElementById("tablePageInfo").textContent = `Page ${currentPage} of ${totalPages}`;
    document.getElementById("prevPage").disabled = currentPage <= 1;
    document.getElementById("nextPage").disabled = currentPage >= totalPages;
  }

  function initTable(d) {
    tableRows = d.summary_table;
    renderTable();

    document.getElementById("tableSearch").addEventListener("input", () => { currentPage = 1; renderTable(); });
    document.getElementById("prevPage").addEventListener("click", () => { currentPage--; renderTable(); });
    document.getElementById("nextPage").addEventListener("click", () => { currentPage++; renderTable(); });

    document.querySelectorAll("#summaryTable thead th[data-col]").forEach((th) => {
      th.addEventListener("click", () => {
        const col = th.dataset.col;
        sortState.dir = sortState.col === col ? -sortState.dir : 1;
        sortState.col = col;
        document.querySelectorAll("#summaryTable thead th").forEach((h) => h.querySelector(".sort-icon")?.remove());
        th.insertAdjacentHTML("beforeend", ` <i class="bi ${sortState.dir === 1 ? "bi-caret-up-fill" : "bi-caret-down-fill"} sort-icon" style="font-size:0.7rem;"></i>`);
        renderTable();
      });
    });
  }

  // ------------------------------------------------------------------------
  // Filters
  // ------------------------------------------------------------------------
  function currentFilters() {
    return {
      gender: document.getElementById("filterGender").value,
      ageGroup: document.getElementById("filterAge").value,
      bmiStatus: document.getElementById("filterBmi").value,
      referral: document.getElementById("filterReferral").value,
      finding: document.getElementById("filterFinding").value,
    };
  }

  function isDefaultFilters(f) {
    return Object.values(f).every((v) => v === "all");
  }

  const KPI_IDS = ["kpiTotal", "kpiFemale", "kpiMale", "kpiAvgBmi", "kpiNormalBmi",
    "kpiAttention", "kpiDental", "kpiVision", "kpiReferrals"];

  function applyFiltersAndRender(d) {
    const filters = currentFilters();
    const stats = CampData.lookup(filters);   // pre-computed; null when < 5 students match
    const statusEl = document.getElementById("filterStatus");

    if (!stats) {
      KPI_IDS.forEach((id) => setKpi(id, undefined));
      CampCharts.updateFiltered(null, CampData.AGE_GROUP_ORDER);
      statusEl.textContent = "Fewer than 5 students match these filters — figures are hidden to protect privacy.";
      return;
    }

    const g = stats.gender_counts;
    setKpi("kpiTotal", stats.n);
    setKpi("kpiFemale", g ? g.Female : null);
    setKpi("kpiMale", g ? g.Male : null);
    setKpi("kpiAvgBmi", stats.avg_bmi, { decimals: 1 });
    setKpi("kpiNormalBmi", stats.normal_bmi_pct, { decimals: 1, suffix: "%" });
    setKpi("kpiAttention", stats.requiring_attention);
    setKpi("kpiDental", stats.dental_finding);
    setKpi("kpiVision", stats.vision_concern);
    setKpi("kpiReferrals", stats.referral);

    CampCharts.updateFiltered(stats, CampData.AGE_GROUP_ORDER);

    const hidden = [stats.gender_counts, stats.age_counts, stats.bmi_status_counts, stats.avg_bmi,
      stats.normal_bmi_pct, stats.requiring_attention, stats.dental_finding, stats.vision_concern,
      stats.referral].some((v) => v === null);
    let msg = isDefaultFilters(filters)
      ? `Showing all ${stats.n} students`
      : `Showing ${stats.n} of ${d.kpis.total_students} students matching filters`;
    if (hidden) msg += " · figures for groups of fewer than 5 students are hidden (shown as “<5”)";
    statusEl.textContent = msg;
  }

  /** Set a KPI card. null = suppressed small cell ("<5"); undefined = no data ("—"). */
  function setKpi(id, value, opts = {}) {
    const el = document.getElementById(id);
    if (!el) return;
    el._animToken = (el._animToken || 0) + 1;   // cancel any running count-up
    el.dataset.done = "1";                       // and stop the scroll-in animation overwriting this value
    const decimals = opts.decimals || 0;
    const suffix = opts.suffix || "";
    if (value === undefined) el.textContent = "—";
    else if (value === null) el.textContent = "<5";
    else el.textContent = Number(value).toFixed(decimals) + suffix;
  }

  function initFilters(d) {
    ["filterGender", "filterAge", "filterBmi", "filterReferral", "filterFinding"].forEach((id) => {
      document.getElementById(id).addEventListener("change", () => applyFiltersAndRender(d));
    });
    document.getElementById("resetFilters").addEventListener("click", () => {
      ["filterGender", "filterAge", "filterBmi", "filterReferral", "filterFinding"].forEach((id) => {
        document.getElementById(id).value = "all";
      });
      applyFiltersAndRender(d);
    });
  }

  // ------------------------------------------------------------------------
  // Scroll reveal
  // ------------------------------------------------------------------------
  function initReveal() {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });
    document.querySelectorAll(".reveal:not(.reveal-init)").forEach((el) => {
      el.classList.add("reveal-init");
      // Force a reflow so the browser registers the initial (hidden) state
      // before we start observing, otherwise the transition can be skipped.
      void el.offsetWidth;
      observer.observe(el);
    });
  }

  // ------------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------------
  async function boot() {
    const d = await CampData.load();

    document.getElementById("footerYear").textContent = new Date().getFullYear();
    document.getElementById("recordCount").textContent = d.meta.unique_students_analyzed;
    document.getElementById("heroLocations").textContent = d.meta.camp_locations.length;
    document.getElementById("heroDomains").textContent = d.meta.screening_domains_reported.length;
    const visionNote = document.getElementById("visionNote");
    if (visionNote) visionNote.textContent = d.vision.color_vision_note || "";

    renderKPIs(d);
    CampCharts.initAll(d);
    renderKeyFindings(d);
    renderPriorityAreas(d);
    renderMentalHealth(d);
    initTable(d);
    initFilters(d);
    initReveal();

    // second pass to catch elements added after initial reveal wiring
    setTimeout(initReveal, 50);
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
