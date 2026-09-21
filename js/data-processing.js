/* ==========================================================================
   data-processing.js
   Loads the pre-aggregated, privacy-safe dashboard-data.json and looks up
   filter results in its "filter cube". This file NEVER touches the raw Excel
   file and NEVER receives any per-student record: dashboard-data.json holds
   only aggregate statistics. Every filter combination that matches fewer than
   `min_group_size` (5) students is absent from the cube, and small cells inside
   a published combination are null - the UI shows those as "<5".
   ========================================================================== */

const CampData = (() => {
  let raw = null;

  async function load() {
    const res = await fetch("data/dashboard-data.json", { cache: "no-store" });
    if (!res.ok) throw new Error("Could not load dashboard-data.json");
    raw = await res.json();
    return raw;
  }

  function all() {
    return raw;
  }

  const AGE_GROUP_ORDER = ["Up to 8", "9-11", "12-14", "15-17", "18+", "Unknown"];

  /** filters = { gender, ageGroup, bmiStatus, referral, finding } -> cube key */
  function cubeKey(f) {
    return [
      f.gender || "all",
      f.ageGroup || "all",
      f.bmiStatus || "all",
      f.referral || "all",
      f.finding || "all",
    ].join("|");
  }

  /**
   * Pre-computed stats for the current filter selection, or null when fewer
   * than the minimum group size (5) students match.
   */
  function lookup(filters) {
    return raw.filter_cube.combos[cubeKey(filters)] || null;
  }

  return { load, all, lookup, AGE_GROUP_ORDER };
})();
