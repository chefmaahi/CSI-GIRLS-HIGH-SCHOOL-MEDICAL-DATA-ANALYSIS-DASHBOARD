/* ==========================================================================
   charts.js
   Chart.js instances for the School Health Monitoring Camp dashboard.
   Colors are pulled from the CSS custom properties so charts stay in sync
   with the design system (and dark mode, if the host page enables it).
   ========================================================================== */

const CampCharts = (() => {
  const css = getComputedStyle(document.documentElement);
  const c = (name, fallback) => (css.getPropertyValue(name) || fallback).trim();

  const palette = {
    teal900: c("--teal-900", "#06403F"),
    teal700: c("--teal-700", "#0B6E6A"),
    teal600: c("--teal-600", "#0E8983"),
    teal500: c("--teal-500", "#14A39B"),
    teal100: c("--teal-100", "#DBF1EE"),
    marigold600: c("--marigold-600", "#E07B23"),
    marigold500: c("--marigold-500", "#F2954A"),
    marigold100: c("--marigold-100", "#FDEBDA"),
    rose600: c("--rose-600", "#C4462B"),
    ink: c("--ink", "#0E2A2A"),
    inkSoft: c("--ink-soft", "#4C6663"),
    border: c("--border", "#DCE9E6"),
  };

  Chart.defaults.font.family = "Inter, -apple-system, sans-serif";
  Chart.defaults.color = palette.inkSoft;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.legend.labels.boxWidth = 8;
  Chart.defaults.plugins.legend.labels.boxHeight = 8;

  const charts = {};

  const categoricalColors = [
    palette.teal600, palette.marigold500, palette.rose600,
    palette.teal900, palette.marigold600, palette.teal500, "#8A6BBE", "#4C8FCB",
  ];

  // Colours are tied to the category NAME, so a category keeps the same colour
  // whatever order the filtered data arrives in.
  const genderColors = { Female: palette.marigold500, Male: palette.teal600, Other: palette.rose600 };
  const bmiColors = { Normal: palette.teal600, Overweight: palette.marigold500, Underweight: palette.rose600 };
  const colorsFor = (map, labels) => labels.map((l) => map[l] || palette.teal900);

  function gridOpts() {
    return { color: palette.border, drawTicks: false };
  }

  function makeDoughnut(ctxId, labels, data, colors) {
    const ctx = document.getElementById(ctxId);
    if (!ctx) return null;
    return new Chart(ctx, {
      type: "doughnut",
      data: {
        labels,
        datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: "#fff", hoverOffset: 6 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "62%",
        animation: { animateRotate: true, duration: 900 },
        plugins: {
          legend: { position: "bottom" },
          tooltip: {
            callbacks: {
              label: (item) => {
                const total = item.dataset.data.reduce((a, b) => a + b, 0);
                const p = total ? Math.round((item.raw / total) * 1000) / 10 : 0;
                return ` ${item.label}: ${item.raw} (${p}%)`;
              },
            },
          },
        },
      },
    });
  }

  function makeBar(ctxId, labels, data, opts = {}) {
    const ctx = document.getElementById(ctxId);
    if (!ctx) return null;
    return new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: opts.label || "Students",
          data,
          backgroundColor: opts.color || palette.teal600,
          borderRadius: 8,
          maxBarThickness: 46,
        }],
      },
      options: {
        indexAxis: opts.horizontal ? "y" : "x",
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 800, easing: "easeOutQuart" },
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: opts.horizontal ? gridOpts() : { display: false }, beginAtZero: true },
          y: { grid: opts.horizontal ? { display: false } : gridOpts(), beginAtZero: true },
        },
      },
    });
  }

  function updateChart(chart, labels, data, colors) {
    if (!chart) return;
    chart.data.labels = labels;
    chart.data.datasets[0].data = data;
    if (colors) chart.data.datasets[0].backgroundColor = colors;
    chart.update();
  }

  function initAll(d) {
    // A. Gender distribution
    const genderLabels = d.demographics.gender_distribution.map((g) => g.gender);
    const genderCounts = d.demographics.gender_distribution.map((g) => g.count);
    charts.gender = makeDoughnut("chartGender", genderLabels, genderCounts, colorsFor(genderColors, genderLabels));

    // B. Age distribution
    charts.age = makeBar(
      "chartAge",
      d.demographics.age_distribution.map((a) => a.group + " yrs"),
      d.demographics.age_distribution.map((a) => a.count),
      { color: palette.teal600 }
    );

    // C. BMI status
    const bmiLabels = d.bmi.status_distribution.map((b) => b.status);
    const bmiCounts = d.bmi.status_distribution.map((b) => b.count);
    charts.bmiStatus = makeDoughnut("chartBmiStatus", bmiLabels, bmiCounts, colorsFor(bmiColors, bmiLabels));

    // D. BMI histogram
    charts.bmiHist = makeBar(
      "chartBmiHist",
      d.bmi.histogram.map((b) => b.range),
      d.bmi.histogram.map((b) => b.count),
      { color: palette.teal500, label: "Students" }
    );

    // E. Vision
    charts.vision = makeBar(
      "chartVision",
      ["Normal", "Requires Attention", "Right-Eye Concern", "Left-Eye Concern", "Not Tested"],
      [d.vision.normal_count, d.vision.concern_count, d.vision.right_eye_concern_count, d.vision.left_eye_concern_count, d.vision.not_tested_count],
      { color: palette.marigold500 }
    );

    // F. Dental findings (horizontal)
    charts.dental = makeBar(
      "chartDental",
      d.dental.findings.map((f) => f.finding),
      d.dental.findings.map((f) => f.count),
      { horizontal: true, color: palette.teal600 }
    );

    // G. Nutrition / general health
    if (d.nutrition_general_health.findings.length) {
      charts.nutrition = makeBar(
        "chartNutrition",
        d.nutrition_general_health.findings.map((f) => f.finding),
        d.nutrition_general_health.findings.map((f) => f.count),
        { color: palette.rose600 }
      );
    }

    // I. Acute / chronic illness
    const illnessLabels = [];
    const illnessData = [];
    const illnessColors = [];
    d.illness.acute.conditions.forEach((cItem, i) => {
      illnessLabels.push(`${cItem.condition} (acute)`);
      illnessData.push(cItem.count);
      illnessColors.push(palette.marigold500);
    });
    d.illness.chronic.conditions.forEach((cItem) => {
      illnessLabels.push(`${cItem.condition} (chronic)`);
      illnessData.push(cItem.count);
      illnessColors.push(palette.teal700);
    });
    charts.illness = makeBar("chartIllness", illnessLabels, illnessData, { horizontal: true, color: illnessColors });
  }

  /**
   * Redraw the filter-sensitive charts from a pre-computed filter-cube entry.
   * `stats` is null when fewer than 5 students match; any partition whose
   * cells would reveal a group under 5 arrives as null and is drawn empty.
   */
  function updateFiltered(stats, order) {
    const empty = (chart) => updateChart(chart, [], []);
    if (!stats) {
      empty(charts.gender); empty(charts.age); empty(charts.bmiStatus); empty(charts.bmiHist);
      return;
    }
    if (charts.gender) {
      const g = stats.gender_counts;
      if (g) {
        const labels = Object.keys(g);
        updateChart(charts.gender, labels, labels.map((k) => g[k]), colorsFor(genderColors, labels));
      } else empty(charts.gender);
    }
    if (charts.age) {
      const a = stats.age_counts;
      if (a) {
        const labels = order.filter((k) => a[k]);
        updateChart(charts.age, labels.map((k) => k + " yrs"), labels.map((k) => a[k]));
      } else empty(charts.age);
    }
    if (charts.bmiStatus) {
      const b = stats.bmi_status_counts;
      if (b) {
        const labels = Object.keys(b).filter((k) => b[k]);
        updateChart(charts.bmiStatus, labels, labels.map((k) => b[k]), colorsFor(bmiColors, labels));
      } else empty(charts.bmiStatus);
    }
    if (charts.bmiHist) {
      updateChart(charts.bmiHist, stats.bmi_histogram.map((b) => b.range), stats.bmi_histogram.map((b) => b.count));
    }
  }

  return { initAll, updateFiltered, palette };
})();
