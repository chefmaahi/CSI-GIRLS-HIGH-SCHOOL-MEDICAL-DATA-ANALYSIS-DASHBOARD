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

  const fmtPct = (v, total) => (total ? Math.round((v / total) * 1000) / 10 : 0);

  /**
   * Built-in labelling plugin (no extra CDN needed):
   *  - bars: the student count at the end of every bar ("<5" for hidden cells)
   *  - doughnuts: count + percentage on each slice, and the total in the centre
   *  - any chart with nothing to draw: an explanatory message
   */
  const valueLabels = {
    id: "valueLabels",
    afterDatasetsDraw(chart) {
      const ds = chart.data.datasets[0];
      if (!ds) return;
      const { ctx, chartArea } = chart;
      const type = chart.config.type;
      const fontFamily = Chart.defaults.font.family;
      const small = chart.width < 420;
      ctx.save();
      ctx.textBaseline = "middle";

      const hasData = chart.data.labels.length > 0 && ds.data.some((v) => v !== null && v !== undefined);
      if (!hasData) {
        ctx.textAlign = "center";
        ctx.font = `500 13px ${fontFamily}`;
        const msg = "Not shown — fewer than 5 students in a group";
        const cx = (chartArea.left + chartArea.right) / 2;
        const cy = (chartArea.top + chartArea.bottom) / 2;
        const w = Math.min(ctx.measureText(msg).width + 24, chart.width - 8);
        ctx.fillStyle = "#fff";                       // clean backing so gridlines don't cross the text
        ctx.fillRect(cx - w / 2, cy - 16, w, 32);
        ctx.fillStyle = palette.inkSoft;
        ctx.fillText(msg, cx, cy, w - 12);
        ctx.restore();
        return;
      }

      const meta = chart.getDatasetMeta(0);

      if (type === "bar") {
        const horizontal = chart.options.indexAxis === "y";
        ctx.font = `700 ${small ? 11 : 12.5}px ${fontFamily}`;
        meta.data.forEach((bar, i) => {
          const v = ds.data[i];
          const hidden = v === null || v === undefined;
          ctx.fillStyle = hidden ? palette.inkSoft : palette.ink;
          const text = hidden ? "<5" : String(v);
          if (horizontal) {
            const x0 = hidden ? chart.scales.x.getPixelForValue(0) : bar.x;
            ctx.textAlign = "left";
            ctx.fillText(text, x0 + 7, bar.y);
          } else {
            const y0 = hidden ? chart.scales.y.getPixelForValue(0) : bar.y;
            ctx.textAlign = "center";
            ctx.fillText(text, bar.x, y0 - 11);
          }
        });
      } else if (type === "doughnut") {
        const total = ds.data.reduce((a, b) => a + (b || 0), 0);
        if (total > 0) {
          // count + % on each slice big enough to hold text
          meta.data.forEach((arc, i) => {
            const v = ds.data[i];
            const share = v / total;
            if (!v || share < 0.07) return;       // tiny slice: the legend carries its numbers
            const pos = arc.tooltipPosition();
            ctx.textAlign = "center";
            ctx.fillStyle = "#fff";
            ctx.shadowColor = "rgba(0,0,0,0.35)";
            ctx.shadowBlur = 3;
            ctx.font = `700 ${small ? 12 : 14}px ${fontFamily}`;
            ctx.fillText(String(v), pos.x, pos.y - 7);
            ctx.font = `600 ${small ? 10 : 11}px ${fontFamily}`;
            ctx.fillText(`${fmtPct(v, total)}%`, pos.x, pos.y + 8);
            ctx.shadowBlur = 0;
          });
          // total in the middle of the ring
          const cx = (chartArea.left + chartArea.right) / 2;
          const cy = (chartArea.top + chartArea.bottom) / 2;
          ctx.textAlign = "center";
          ctx.fillStyle = palette.ink;
          ctx.font = `700 ${small ? 20 : 24}px ${fontFamily}`;
          ctx.fillText(String(total), cx, cy - 8);
          ctx.fillStyle = palette.inkSoft;
          ctx.font = `500 ${small ? 10 : 11}px ${fontFamily}`;
          ctx.fillText("students", cx, cy + 12);
        }
      }
      ctx.restore();
    },
  };
  Chart.register(valueLabels);

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
          legend: {
            position: "bottom",
            labels: {
              padding: 14,
              font: { size: 12.5 },
              // legend text shows the numbers too, e.g. "Female: 94 (83.9%)"
              generateLabels(chart) {
                const base = Chart.overrides.doughnut.plugins.legend.labels.generateLabels(chart);
                const vals = chart.data.datasets[0].data;
                const total = vals.reduce((a, b) => a + (b || 0), 0);
                return base.map((item) => {
                  const v = vals[item.index];
                  item.text = `${item.text}: ${v} (${fmtPct(v, total)}%)`;
                  return item;
                });
              },
            },
          },
          tooltip: {
            callbacks: {
              label: (item) => {
                const total = item.dataset.data.reduce((a, b) => a + b, 0);
                return ` ${item.label}: ${item.raw} students (${fmtPct(item.raw, total)}%)`;
              },
            },
          },
        },
      },
    });
  }

  function axisTitle(text) {
    return text
      ? { display: true, text, color: palette.inkSoft, font: { size: 12, weight: "600" }, padding: 8 }
      : { display: false };
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
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (item) => ` ${item.raw ?? "<5"} students` } },
        },
        scales: {
          // headroom (grace) leaves space for the value written at the end of each bar
          x: {
            grid: opts.horizontal ? gridOpts() : { display: false },
            beginAtZero: true,
            grace: opts.horizontal ? "12%" : 0,
            title: axisTitle(opts.xTitle),
            ticks: opts.horizontal ? { precision: 0 } : {},
          },
          y: {
            grid: opts.horizontal ? { display: false } : gridOpts(),
            beginAtZero: true,
            grace: opts.horizontal ? 0 : "12%",
            title: axisTitle(opts.yTitle),
            ticks: opts.horizontal ? {} : { precision: 0 },
          },
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
      { color: palette.teal600, xTitle: "Age group (years)", yTitle: "Number of students" }
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
      { color: palette.teal500, label: "Students", xTitle: "BMI (kg/m²)", yTitle: "Number of students" }
    );

    // E. Vision
    charts.vision = makeBar(
      "chartVision",
      ["Normal", "Requires Attention", "Right-Eye Concern", "Left-Eye Concern", "Not Tested"],
      [d.vision.normal_count, d.vision.concern_count, d.vision.right_eye_concern_count, d.vision.left_eye_concern_count, d.vision.not_tested_count],
      { color: palette.marigold500, xTitle: "Vision result", yTitle: "Number of students" }
    );

    // F. Dental findings (horizontal)
    charts.dental = makeBar(
      "chartDental",
      d.dental.findings.map((f) => f.finding),
      d.dental.findings.map((f) => f.count),
      { horizontal: true, color: palette.teal600, xTitle: "Number of students", yTitle: "Dental finding" }
    );

    // G. Nutrition / general health
    if (d.nutrition_general_health.findings.length) {
      charts.nutrition = makeBar(
        "chartNutrition",
        d.nutrition_general_health.findings.map((f) => f.finding),
        d.nutrition_general_health.findings.map((f) => f.count),
        { color: palette.rose600, xTitle: "Nutrition / general-health finding", yTitle: "Number of students" }
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
    charts.illness = makeBar("chartIllness", illnessLabels, illnessData, { horizontal: true, color: illnessColors, xTitle: "Number of students", yTitle: "Illness (past month)" });
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
