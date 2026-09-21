#!/usr/bin/env python3
"""
School Health Monitoring Camp - Madanapalle
Data Processing Pipeline

Reads the raw screening Excel export, cleans and normalizes it, and writes an
AGGREGATED, ANONYMISED JSON file (data/dashboard-data.json) for the public
dashboard.

PRIVACY: This script must never write patient names, UHIDs, visit/admission
IDs, or ANY individual-level row into the output JSON. Only counts,
percentages and grouped statistics are exported, and every group/cell of
fewer than SUPPRESSION_THRESHOLD students is withheld. The dashboard's
interactive filters read a pre-computed "filter cube" (one entry per filter
combination, only for combinations with >= 5 students) instead of per-student
rows. Individual mental-health responses are never exported at all.

Usage:
    python3 process-data.py [path-to-excel-or-csv]

If no path is given, it defaults to ../raw/Merged_Camp_Data.xlsx relative to
this script. Re-run this script any time the raw file is replaced.
"""

import sys
import re
import json
import itertools
from pathlib import Path
from collections import Counter

import pandas as pd

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent
DEFAULT_RAW_PATH = PROJECT_DIR / "raw" / "Merged_Camp_Data.xlsx"
OUTPUT_PATH = PROJECT_DIR / "data" / "dashboard-data.json"

# Small-cell suppression threshold: any aggregate group smaller than this is
# suppressed from mental-health / sensitive outputs to prevent re-identification.
SUPPRESSION_THRESHOLD = 5

AGE_GROUP_ORDER = ["Up to 8", "9-11", "12-14", "15-17", "18+", "Unknown"]

# Distance-vision readings treated as normal. Anything else that is recorded
# (6/9, 6/12, 6/18 ...) is counted as "requires attention". Change here if the
# clinical team prefers a different screening threshold (e.g. add "6/9").
VISION_NORMAL_READINGS = ("6/5", "6/6")

# Values for the filter cube. Must match the <option> values in index.html.
FILTER_VALUES = {
    "gender": ["Female", "Male"],
    "age_group": ["Up to 8", "9-11", "12-14", "15-17"],
    "bmi_status": ["Normal", "Overweight", "Underweight"],
    "referral": ["yes", "no"],
    "finding": ["vision_concern", "dental_finding", "nutrition_finding", "acute_illness"],
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def norm_text(val):
    """Normalize free-text Yes/No-ish fields: trims, fixes case, unifies NaN."""
    if pd.isnull(val):
        return None
    s = str(val).strip()
    if s == "" or s.lower() in ("nan", "none", "null", "n/a", "na"):
        return None
    return s


def norm_yesno(val):
    """Normalize a Yes/No style field to 'Yes', 'No' or None."""
    s = norm_text(val)
    if s is None:
        return None
    low = s.lower()
    if low.startswith("yes"):
        return "Yes"
    if low.startswith("no"):
        return "No"
    return s  # keep original for anything unexpected (e.g. free text)


def parse_age(age_gender):
    """'13 Y / Female' / '10 Y,1 D / Male' -> 13 (int years)."""
    s = norm_text(age_gender)
    if s is None:
        return None
    m = re.match(r"\s*(\d+)\s*Y", s)
    return int(m.group(1)) if m else None


def parse_gender(age_gender):
    s = norm_text(age_gender)
    if s is None:
        return None
    m = re.search(r"/\s*(Male|Female|Other)", s, flags=re.IGNORECASE)
    return m.group(1).title() if m else None


def parse_bmi(val):
    """Handles values like '19.3', '16,0' (comma decimal), blanks."""
    s = norm_text(val)
    if s is None:
        return None
    s = s.replace(",", ".")
    try:
        return round(float(s), 1)
    except ValueError:
        return None


def age_group(age):
    if age is None:
        return "Unknown"
    if age <= 8:
        return "Up to 8"
    if age <= 11:
        return "9-11"
    if age <= 14:
        return "12-14"
    if age <= 17:
        return "15-17"
    return "18+"


def tooth_findings_count(series):
    """For dental fields storing FDI tooth codes (e.g. '46, 47'), count
    the number of STUDENTS with a non-blank entry (not the number of teeth)."""
    return int(series.apply(lambda v: norm_text(v) is not None).sum())


def suppress(count):
    """Apply small-cell suppression for sensitive categories."""
    if count is None:
        return None
    return count if count >= SUPPRESSION_THRESHOLD else None


def bmi_from_height_weight(h_cm, w_kg):
    """Fallback BMI (kg/m2) when the recorded BMI cell is blank."""
    if h_cm is None or w_kg is None or pd.isna(h_cm) or pd.isna(w_kg):
        return None
    if not (50 <= h_cm <= 220) or w_kg <= 0:
        return None
    return round(w_kg / (h_cm / 100) ** 2, 1)


def suppress_small(count):
    """Hide counts of 1..(threshold-1). Zero and large counts are kept."""
    if count is None:
        return None
    count = int(count)
    return None if 0 < count < SUPPRESSION_THRESHOLD else count


def suppress_partition(counts, keys):
    """Counts for a set of mutually exclusive groups (gender, age band, BMI
    status). If ANY cell is 1..4 the whole partition is withheld, otherwise the
    hidden cell could be recovered by subtracting from the total."""
    vals = [int(counts.get(k, 0)) for k in keys]
    if any(0 < v < SUPPRESSION_THRESHOLD for v in vals):
        return None
    return dict(zip(keys, vals))


def merged_histogram(values, bin_width=2):
    """BMI histogram in 2-unit bins, with neighbouring bins merged until every
    bar holds at least SUPPRESSION_THRESHOLD students (so an outlier BMI can
    never appear as a bar of 1)."""
    vals = [float(v) for v in values if v is not None and not pd.isna(v)]
    if len(vals) < SUPPRESSION_THRESHOLD:
        return []
    lo = int(min(vals) // bin_width * bin_width)
    hi = int(max(vals) // bin_width * bin_width + bin_width)
    bins, acc_start, acc, acc_end = [], None, 0, None
    for a in range(lo, hi, bin_width):
        b = a + bin_width
        c = sum(1 for v in vals if a <= v < b)
        if acc_start is None:
            if c == 0:
                continue
            acc_start = a
        acc += c
        acc_end = b
        if acc >= SUPPRESSION_THRESHOLD:
            bins.append([acc_start, acc_end, acc])
            acc_start, acc = None, 0
    if acc > 0:
        if bins:
            bins[-1][1] = acc_end
            bins[-1][2] += acc
        else:
            bins.append([acc_start, acc_end, acc])
    return [{"range": f"{a}-{b}", "count": c} for a, b, c in bins]


def pct(n, total):
    if not total:
        return 0.0
    return round(100 * n / total, 1)


# ---------------------------------------------------------------------------
# Load
# ---------------------------------------------------------------------------

def load_raw(path):
    path = Path(path)
    if path.suffix.lower() in (".xlsx", ".xlsm", ".xls"):
        xl = pd.ExcelFile(path)
        sheet = "Merged Data" if "Merged Data" in xl.sheet_names else xl.sheet_names[0]
        df = pd.read_excel(path, sheet_name=sheet)
    else:
        df = pd.read_csv(path)
    return df


def clean_nans(obj):
    """Recursively replace float NaN with None so json.dump produces valid JSON."""
    if isinstance(obj, float) and pd.isna(obj):
        return None
    if isinstance(obj, dict):
        return {k: clean_nans(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [clean_nans(v) for v in obj]
    return obj


def build_filter_cube(flags, gender_keys, age_keys, status_keys):
    """Pre-compute the dashboard's filter results (5 dropdowns) so the browser
    never needs per-student rows. Combinations with fewer than
    SUPPRESSION_THRESHOLD students are omitted; inside a published combination
    any small cell is withheld (None)."""
    combos = {}
    dims = [
        [None] + FILTER_VALUES["gender"],
        [None] + FILTER_VALUES["age_group"],
        [None] + FILTER_VALUES["bmi_status"],
        [None] + FILTER_VALUES["referral"],
        [None] + FILTER_VALUES["finding"],
    ]
    for g, a, b, r, f in itertools.product(*dims):
        mask = pd.Series(True, index=flags.index)
        if g:
            mask &= flags["gender"] == g
        if a:
            mask &= flags["age_group"] == a
        if b:
            mask &= flags["bmi_status"] == b
        if r:
            mask &= flags["referral_required"] == (r == "yes")
        if f:
            mask &= flags[f]
        sub = flags[mask]
        nn = len(sub)
        if nn < SUPPRESSION_THRESHOLD:
            continue

        bmi_vals = sub["bmi"].dropna()
        status_counts = Counter(sub["bmi_status"].dropna())
        normal_n = suppress_small(status_counts.get("Normal", 0))
        combos["|".join(x or "all" for x in (g, a, b, r, f))] = {
            "n": nn,
            "gender_counts": suppress_partition(Counter(sub["gender"].fillna("Other")), gender_keys),
            "age_counts": suppress_partition(Counter(sub["age_group"]), age_keys),
            "bmi_status_counts": suppress_partition(status_counts, status_keys),
            "avg_bmi": round(float(bmi_vals.mean()), 1) if len(bmi_vals) >= SUPPRESSION_THRESHOLD else None,
            "normal_bmi_pct": pct(normal_n, nn) if normal_n is not None else None,
            "vision_concern": suppress_small(sub["vision_concern"].sum()),
            "dental_finding": suppress_small(sub["dental_finding"].sum()),
            "nutrition_finding": suppress_small(sub["nutrition_finding"].sum()),
            "acute_illness": suppress_small(sub["acute_illness"].sum()),
            "referral": suppress_small(sub["referral_required"].sum()),
            "requiring_attention": suppress_small(sub["attention"].sum()),
            "bmi_histogram": merged_histogram(sub["bmi"]),
        }
    return combos


def main():
    raw_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_RAW_PATH
    if not raw_path.exists():
        print(f"ERROR: raw data file not found at {raw_path}")
        sys.exit(1)

    df = load_raw(raw_path)
    total_records = len(df)

    # --- De-duplicate on UHID (kept in-memory only, never exported) --------
    # Rows with a blank UHID are kept (they are not duplicates of each other).
    uhid_col = "UHID"
    duplicate_count = 0
    if uhid_col in df.columns:
        dup_mask = df[uhid_col].notna() & df[uhid_col].duplicated()
        duplicate_count = int(dup_mask.sum())
        df = df[~dup_mask].reset_index(drop=True)

    n = len(df)  # analytical N after de-dup

    # --- Demographics --------------------------------------------------------
    df["_age"] = df["Age/Gender"].apply(parse_age)
    df["_gender"] = df["Age/Gender"].apply(parse_gender)
    df["_age_group"] = df["_age"].apply(age_group)

    gender_counts = Counter(df["_gender"].dropna())
    female_n = int(gender_counts.get("Female", 0))
    male_n = int(gender_counts.get("Male", 0))
    other_gender_n = int(n - female_n - male_n)
    gender_keys = ["Female", "Male"] + (["Other"] if other_gender_n > 0 else [])
    gender_part = suppress_partition(
        {"Female": female_n, "Male": male_n, "Other": other_gender_n}, gender_keys)

    age_group_counts = Counter(df["_age_group"])
    age_keys = [g for g in AGE_GROUP_ORDER if age_group_counts.get(g, 0) > 0]
    age_part = suppress_partition(age_group_counts, age_keys)

    # --- BMI -------------------------------------------------------------
    # Recorded BMI is used; if that cell is blank it is calculated from the
    # measured height (cm) and weight (kg).
    df["_bmi_recorded"] = df["BMI"].apply(parse_bmi)
    df["_h"] = df["Height (cm):"].apply(parse_bmi)
    df["_w"] = df["Weight (kg)"].apply(parse_bmi)
    df["_bmi"] = [
        rec if (rec is not None and not pd.isna(rec)) else bmi_from_height_weight(h, w)
        for rec, h, w in zip(df["_bmi_recorded"], df["_h"], df["_w"])
    ]
    df["_bmi_status"] = df["BMI Status:"].apply(norm_text)

    bmi_valid = df["_bmi"].dropna()
    avg_bmi = round(float(bmi_valid.mean()), 1) if len(bmi_valid) else None

    bmi_status_counts = Counter(df["_bmi_status"].dropna())
    status_keys = [k for k, _ in sorted(bmi_status_counts.items(), key=lambda x: -x[1])]
    status_part = suppress_partition(bmi_status_counts, status_keys)
    bmi_status_dist = (
        [{"status": k, "count": v, "percent": pct(v, n)} for k, v in status_part.items()]
        if status_part else []
    )
    normal_bmi_n = int(bmi_status_counts.get("Normal", 0))
    normal_bmi_pct = pct(normal_bmi_n, n)
    bmi_histogram = merged_histogram(df["_bmi"])

    # --- Vision ------------------------------------------------------------
    right_eye_col = [c for c in df.columns if "Right Eye" in c][0]
    left_eye_col = "Left Eye"
    color_vision_col = "Color Vision (Ishihara):"

    def vision_is_normal(v):
        s = norm_text(v)
        if s is None:
            return None
        return s in VISION_NORMAL_READINGS

    df["_right_eye_normal"] = df[right_eye_col].apply(vision_is_normal)
    df["_left_eye_normal"] = df[left_eye_col].apply(vision_is_normal)

    right_concern = (df["_right_eye_normal"] == False)  # noqa: E712
    left_concern = (df["_left_eye_normal"] == False)  # noqa: E712
    vision_flag = right_concern | left_concern
    vision_tested = df["_right_eye_normal"].notna() | df["_left_eye_normal"].notna()

    vision_tested_n = int(vision_tested.sum())
    vision_not_tested_n = int(n - vision_tested_n)      # blank readings: NOT "normal"
    vision_any_concern_n = int(vision_flag.sum())
    vision_normal_n = int(vision_tested_n - vision_any_concern_n)
    right_concern_n = int(right_concern.sum())
    left_concern_n = int(left_concern.sum())

    # Free-text clinician remarks (never exported verbatim).
    remarks = df["Others (Chronic Illness)"].apply(norm_text).fillna("")

    # Colour vision: the sheet holds "Normal" and "No". "No" is not an
    # interpretable Ishihara result (it is mostly young children / students with
    # no distance-vision reading), so it is reported as "result unclear" and NOT
    # counted as a concern. A concern is counted only for an explicit defect
    # label or a clinician remark about not identifying colours.
    cv_vals = df[color_vision_col].apply(norm_text).fillna("")
    cv_low = cv_vals.str.lower()
    cv_normal_n = int((cv_low == "normal").sum())
    cv_defect = (cv_low != "") & ~cv_low.isin(["normal", "no"])
    cv_remark = remarks.str.contains(r"colou?r", case=False, regex=True)
    color_concern_n = int((cv_defect | cv_remark).sum())
    cv_unclear_n = int(n - cv_normal_n - int(cv_defect.sum()))
    colour_note = None
    if cv_unclear_n:
        colour_note = (
            f"Colour vision (Ishihara): {cv_normal_n} students had a normal result. "
            f"{cv_unclear_n} students have an entry of \"No\", which is not an interpretable "
            "Ishihara result, so they are shown as unclear and not counted as concerns."
        )

    # --- Hearing -------------------------------------------------------------
    # Confirmed by the screening team: an entry of "No" means "not tested /
    # unclear". Almost every hearing entry is "No" (only a couple of right-ear
    # "Normal" results, none for the left ear), so there are too few usable
    # results to report. Hearing is therefore left out of the dashboard.
    ear_cols = [c for c in df.columns if "Ear" in str(c)]
    hearing_usable_n = int(max(
        (df[c].apply(norm_text).fillna("").str.lower() == "normal").sum() for c in ear_cols
    )) if ear_cols else 0
    hearing_summary = {
        "status": "not_reported",
        "students_with_usable_result": suppress_small(hearing_usable_n),
        "note": "\"No\" entries mean not tested/unclear. Too few usable hearing results to report.",
    }

    # --- Dental ---------------------------------------------------------------
    dental_binary_fields = {
        "Calculus": "Calculus",
        "Stains": "Stains",
        "Fluorosis": "Flourosis",
        "Tongue tie": "Tongue tie",
        "Bald tongue": "Bald Tongue",
        "Geographic tongue": "Geographic tongue",
        "Cleft lip": "Cleft lip",
        "Cleft palate": "Cleft palate",
        "Halitosis": "Halitosis",
        "Thumb sucking": "Thumb Sucking ",
        "Diastema": "Diastema",
        "Pockets": "Pockets ",
    }
    dental_tooth_code_fields = {
        "Dental caries": "Dental Caries:",
        "Pit & fissure caries": "Pit & Fissure Caries:",
        "Deep dental caries": "Deep Dental Caries:",
        "Grossly decayed": "Grossly Decayed:",
        "Over-retained tooth": "Over Retained tooth:",
    }

    dental_findings = []
    for label, col in dental_tooth_code_fields.items():
        c = tooth_findings_count(df[col])
        if c >= SUPPRESSION_THRESHOLD:
            dental_findings.append({"finding": label, "count": c, "percent": pct(c, n)})
    for label, col in dental_binary_fields.items():
        vals = df[col].apply(norm_text)
        c = int((vals.notna() & (vals.str.lower() != "no")).sum())
        if c >= SUPPRESSION_THRESHOLD:
            dental_findings.append({"finding": label, "count": c, "percent": pct(c, n)})
    dental_findings.sort(key=lambda x: -x["count"])

    dental_flag = pd.Series(False, index=df.index)
    for col in dental_tooth_code_fields.values():
        dental_flag = dental_flag | df[col].apply(lambda v: norm_text(v) is not None)
    for col in dental_binary_fields.values():
        vals = df[col].apply(norm_text)
        dental_flag = dental_flag | (vals.notna() & (vals.str.lower() != "no"))
    students_with_any_dental_finding = int(dental_flag.sum())

    # --- Nutrition / general health -------------------------------------------
    nutrition_col = "Nutritional & General Health:"
    nutrition_vals = df[nutrition_col].apply(norm_text)
    nutrition_flag = nutrition_vals.notna()
    nutrition_flag_n = int(nutrition_flag.sum())
    nutrition_findings = [
        {"finding": k, "count": int(v), "percent": pct(v, n)}
        for k, v in sorted(Counter(nutrition_vals.dropna()).items(), key=lambda x: -x[1])
        if v >= SUPPRESSION_THRESHOLD
    ]

    # --- Acute / chronic illness -----------------------------------------------
    def split_multi(val):
        s = norm_text(val)
        if s is None:
            return []
        return [p.strip() for p in re.split(r",|;", s) if p.strip()]

    acute_col = "Acute Illness (Past Month):"
    acute_flag = df[acute_col].apply(norm_text).notna()
    acute_illness_n = int(acute_flag.sum())
    acute_counter = Counter()
    for v in df[acute_col]:
        for item in split_multi(v):
            acute_counter[item] += 1
    acute_illness = [
        {"condition": k, "count": int(v), "percent": pct(v, n)}
        for k, v in sorted(acute_counter.items(), key=lambda x: -x[1])
        if v >= SUPPRESSION_THRESHOLD
    ]

    # "Chronic Illness:" is the real chronic-illness field. The separate free-text
    # "Others (Chronic Illness)" column actually holds clinician remarks (mostly
    # "needs X-specialist opinion"), so it is used ONLY to detect referrals /
    # colour-vision remarks above and below - never as a chronic-illness count.
    chronic_col = "Chronic Illness:"
    chronic_flag = df[chronic_col].apply(norm_text).notna()
    chronic_illness_n = int(chronic_flag.sum())
    chronic_counter = Counter()
    for v in df[chronic_col]:
        for item in split_multi(v):
            chronic_counter[item] += 1
    chronic_illness, chronic_suppressed_total = [], 0
    for k, v in sorted(chronic_counter.items(), key=lambda x: -x[1]):
        if v >= SUPPRESSION_THRESHOLD:
            chronic_illness.append({"condition": k, "count": int(v), "percent": pct(v, n)})
        else:
            chronic_suppressed_total += v
    if chronic_suppressed_total:
        chronic_illness.append({
            "condition": "Other findings (individually below reporting threshold)",
            "count": int(chronic_suppressed_total),
            "percent": pct(chronic_suppressed_total, n),
        })

    # --- Physical disability ---------------------------------------------------
    disability_col = "Physical Disability (if any): "
    disability_vals = df[disability_col].apply(norm_text)
    disability_n = int((disability_vals.notna() & (disability_vals.str.lower() != "no")).sum())

    # --- Referrals ---------------------------------------------------------------
    # The formal "Referral Needed" field is blank for every student in this
    # export, so blank = "not recorded" (NOT "no referral"). A referral is
    # therefore counted when the field says Yes OR a clinician remark advises a
    # specialist opinion / evaluation.
    referral_col = "Referral Needed: "
    referral_vals = df[referral_col].apply(norm_yesno)
    referral_field_recorded_n = int(referral_vals.notna().sum())
    specialist_flag = remarks.str.contains(r"opinion|evaluat|refer", case=False, regex=True)
    referral_flag = (referral_vals == "Yes") | specialist_flag
    referral_n = int(referral_flag.sum())
    referral_pct = pct(referral_n, n)

    # --- Regular treatment -------------------------------------------------------
    treatment_vals = df["Receiving Regular Treatment"].apply(norm_yesno)
    treatment_yes_n = suppress_small(int((treatment_vals == "Yes").sum()))

    # --- Mental health (HIGH SENSITIVITY - aggregate & suppress only) -----------
    mh_question_cols = [c for c in df.columns if re.match(r"^\s*\d{1,2}\.", str(c))]
    instructions_col = [c for c in df.columns if c.startswith("Instructions:")]
    if instructions_col:
        mh_question_cols = instructions_col + mh_question_cols

    mh_yes_counts_per_student = pd.Series([0] * n)
    any_response_recorded = pd.Series([False] * n)
    self_harm_col = None
    for col in mh_question_cols:
        yn = df[col].apply(norm_yesno)
        any_response_recorded = any_response_recorded | yn.notna()
        mh_yes_counts_per_student = mh_yes_counts_per_student + (yn == "Yes").astype(int)
        if "hurting yourself" in col.lower() or "giving up" in col.lower():
            self_harm_col = col

    students_with_responses = int(any_response_recorded.sum())

    mental_health_summary = {
        "screening_tool_administered": bool(mh_question_cols),
        "students_with_recorded_responses": students_with_responses,
        "note": "Screening indicator - not a clinical diagnosis.",
    }

    if students_with_responses == 0:
        mental_health_summary["status"] = "no_responses_recorded"
        mental_health_summary["message"] = (
            "The mental health screening questionnaire was included in the camp "
            "protocol, but no individual responses were captured in this dataset."
        )
    else:
        no_concern_n = int(((mh_yes_counts_per_student <= 2) & any_response_recorded).sum())
        mild_concern_n = int(((mh_yes_counts_per_student >= 3) & (mh_yes_counts_per_student <= 5)).sum())
        strong_concern_n = int((mh_yes_counts_per_student >= 6).sum())

        mental_health_summary["categories"] = {
            "no_immediate_concern": suppress(no_concern_n),
            "mild_concern": suppress(mild_concern_n),
            "strong_concern": suppress(strong_concern_n),
        }
        if self_harm_col is not None:
            sh_yes = int((df[self_harm_col].apply(norm_yesno) == "Yes").sum())
            mental_health_summary["self_harm_indicator_flagged"] = suppress(sh_yes)
        mental_health_summary["suppressed_note"] = (
            f"Any category with fewer than {SUPPRESSION_THRESHOLD} students is "
            "withheld to protect individual privacy."
        )

    # --- Per-student flags (IN MEMORY ONLY - used to build the filter cube) -----
    bmi_nonnormal = df["_bmi_status"].notna() & (df["_bmi_status"] != "Normal")
    attention_flag = (
        bmi_nonnormal | vision_flag | dental_flag | nutrition_flag
        | acute_flag | chronic_flag | referral_flag
    )
    students_requiring_attention = int(attention_flag.sum())

    flags = pd.DataFrame({
        "gender": df["_gender"],
        "age_group": df["_age_group"],
        "bmi_status": df["_bmi_status"],
        "bmi": df["_bmi"],
        "vision_concern": vision_flag,
        "dental_finding": dental_flag,
        "nutrition_finding": nutrition_flag,
        "acute_illness": acute_flag,
        "referral_required": referral_flag,
        "attention": attention_flag,
    })
    filter_cube = build_filter_cube(flags, gender_keys, age_keys, status_keys)

    # --- Which screening domains actually have reportable data ------------------
    domains = []
    if len(bmi_valid):
        domains.append("BMI & growth")
    if vision_tested_n:
        domains.append("Vision")
    if students_with_any_dental_finding or dental_findings:
        domains.append("Dental")
    if nutrition_flag_n:
        domains.append("Nutrition")
    if acute_illness_n or chronic_illness_n:
        domains.append("Illness")
    if students_with_responses:
        domains.append("Mental health")

    # --- Key findings (auto-generated, dynamic) -----------------------------------
    key_findings = []
    key_findings.append(
        f"{normal_bmi_pct}% of screened students ({normal_bmi_n} of {n}) were classified as having a normal BMI."
    )
    key_findings.append(
        f"{students_requiring_attention} students ({pct(students_requiring_attention, n)}%) had at least one screening "
        "finding (BMI, vision, dental, nutrition, illness or referral)."
    )
    if vision_tested_n:
        msg = (
            f"Vision screening identified {vision_any_concern_n} of {vision_tested_n} tested students "
            f"({pct(vision_any_concern_n, vision_tested_n)}%) requiring further attention."
        )
        if vision_not_tested_n:
            msg += f" {vision_not_tested_n} students had no distance-vision reading recorded."
        key_findings.append(msg)
    if students_with_any_dental_finding:
        key_findings.append(
            f"Dental screening recorded findings in {students_with_any_dental_finding} students "
            f"({pct(students_with_any_dental_finding, n)}%)."
        )
    if referral_n:
        msg = (
            f"{referral_n} students ({referral_pct}%) were advised a specialist opinion or referral "
            "in clinician remarks."
        )
        if referral_field_recorded_n == 0:
            msg += " The formal \"Referral Needed\" field was not filled in for any student."
        key_findings.append(msg)
    elif referral_field_recorded_n == 0:
        key_findings.append("Referral status was not recorded in this dataset.")
    else:
        key_findings.append("No students were flagged for referral in this dataset.")
    if nutrition_flag_n:
        top = f" (most commonly: {nutrition_findings[0]['finding']})" if nutrition_findings else ""
        key_findings.append(
            f"Nutritional/general health screening recorded {nutrition_flag_n} students "
            f"({pct(nutrition_flag_n, n)}%) with a noted finding{top}."
        )
    if acute_illness_n:
        key_findings.append(
            f"{acute_illness_n} students ({pct(acute_illness_n, n)}%) reported an acute illness in the past month."
        )
    if disability_n:
        if disability_n >= SUPPRESSION_THRESHOLD:
            key_findings.append(f"{disability_n} students ({pct(disability_n, n)}%) were recorded with a physical disability finding.")
        else:
            key_findings.append(
                "A small number of students were recorded with a physical disability finding; "
                "the exact count is withheld here to protect individual privacy."
            )

    # --- Areas requiring attention (ranked) -----------------------------------------
    priority_areas = [
        {"area": "Dental", "icon": "tooth", "count": students_with_any_dental_finding, "percent": pct(students_with_any_dental_finding, n)},
        {"area": f"Vision (of {vision_tested_n} tested)", "icon": "eye", "count": vision_any_concern_n, "percent": pct(vision_any_concern_n, vision_tested_n)},
        {"area": "Nutrition", "icon": "apple", "count": nutrition_flag_n, "percent": pct(nutrition_flag_n, n)},
        {"area": "BMI (non-normal)", "icon": "weight", "count": int(bmi_nonnormal.sum()), "percent": pct(int(bmi_nonnormal.sum()), n)},
        {"area": "Acute Illness", "icon": "thermometer", "count": acute_illness_n, "percent": pct(acute_illness_n, n)},
        {"area": "Specialist opinion / referral advised", "icon": "hospital", "count": referral_n, "percent": referral_pct},
    ]
    priority_areas = [p for p in priority_areas if p["count"] >= SUPPRESSION_THRESHOLD]
    priority_areas.sort(key=lambda x: -x["count"])

    # --- Summary table (aggregate only) -----------------------------------------------
    def row(indicator, count, percent, attention=True):
        return {"indicator": indicator, "students": count, "percent": percent,
                "status": "Attention" if (attention and count) else "Good"}

    summary_table = [
        row("Normal BMI", normal_bmi_n, normal_bmi_pct, attention=False),
        row("Underweight", int(bmi_status_counts.get("Underweight", 0)), pct(bmi_status_counts.get("Underweight", 0), n)),
        row("Overweight", int(bmi_status_counts.get("Overweight", 0)), pct(bmi_status_counts.get("Overweight", 0), n)),
        row("Vision Concern (of tested)", vision_any_concern_n, pct(vision_any_concern_n, vision_tested_n)),
        row("Vision Not Tested", vision_not_tested_n, pct(vision_not_tested_n, n)),
        row("Dental Finding", students_with_any_dental_finding, pct(students_with_any_dental_finding, n)),
        row("Nutrition Finding", nutrition_flag_n, pct(nutrition_flag_n, n)),
        row("Acute Illness (past month)", acute_illness_n, pct(acute_illness_n, n)),
        row("Chronic Illness", chronic_illness_n, pct(chronic_illness_n, n)),
        row("Physical Disability Noted", disability_n if disability_n >= SUPPRESSION_THRESHOLD else 0,
            pct(disability_n, n) if disability_n >= SUPPRESSION_THRESHOLD else 0.0),
        row("Specialist Opinion / Referral Advised", referral_n, referral_pct),
    ]
    # hide any row that is zero or below the reporting threshold (except Normal BMI)
    summary_table = [r for r in summary_table
                     if r["students"] >= SUPPRESSION_THRESHOLD or r["indicator"] == "Normal BMI"]

    # --- Final aggregate payload -----------------------------------------------------
    output = {
        "meta": {
            "project_title": "School Health Monitoring Camp",
            "camp_locations": [
                "C.S.I. Girls High School, Madanapalle",
                "A.A.M. Elementary School, Madanapalle",
            ],
            "organizations": ["Swaasthya Hospitals", "The Satsang Foundation"],
            "records_in_raw_file": total_records,
            "duplicate_records_removed": duplicate_count,
            "unique_students_analyzed": n,
            "screening_domains_reported": domains,
            "min_group_size": SUPPRESSION_THRESHOLD,
            "privacy_note": "This file contains only aggregated statistics. Groups and cells with fewer than "
                            f"{SUPPRESSION_THRESHOLD} students are withheld. No names, UHIDs or individual-level rows are included.",
        },
        "kpis": {
            "total_students": n,
            "female_students": gender_part["Female"] if gender_part else None,
            "male_students": gender_part["Male"] if gender_part else None,
            "average_bmi": avg_bmi,
            "normal_bmi_percent": normal_bmi_pct,
            "students_requiring_attention": students_requiring_attention,
            "dental_findings": students_with_any_dental_finding,
            "vision_concerns": vision_any_concern_n,
            "vision_tested": vision_tested_n,
            "referrals_required": referral_n,
        },
        "demographics": {
            "gender_distribution": [{"gender": k, "count": v} for k, v in gender_part.items()] if gender_part else [],
            "age_distribution": [{"group": k, "count": v} for k, v in age_part.items()] if age_part else [],
        },
        "bmi": {
            "average": avg_bmi,
            "status_distribution": bmi_status_dist,
            "histogram": bmi_histogram,
        },
        "vision": {
            "tested_count": vision_tested_n,
            "normal_count": vision_normal_n,
            "concern_count": suppress_small(vision_any_concern_n),
            "right_eye_concern_count": suppress_small(right_concern_n),
            "left_eye_concern_count": suppress_small(left_concern_n),
            "not_tested_count": suppress_small(vision_not_tested_n),
            "color_vision_normal_count": cv_normal_n,
            "color_vision_unclear_count": cv_unclear_n,
            "color_vision_concern_count": suppress_small(color_concern_n),
            "color_vision_note": colour_note,
        },
        "hearing": hearing_summary,
        "dental": {
            "students_with_any_finding": students_with_any_dental_finding,
            "percent_with_finding": pct(students_with_any_dental_finding, n),
            "findings": dental_findings,
        },
        "nutrition_general_health": {
            "students_with_finding": nutrition_flag_n,
            "percent_with_finding": pct(nutrition_flag_n, n),
            "findings": nutrition_findings,
        },
        "illness": {
            "acute": {
                "students_affected": acute_illness_n,
                "percent": pct(acute_illness_n, n),
                "conditions": acute_illness,
            },
            "chronic": {
                "students_affected": chronic_illness_n,
                "percent": pct(chronic_illness_n, n),
                "conditions": chronic_illness,
            },
            "receiving_regular_treatment": treatment_yes_n,
        },
        "physical_disability": {
            "students_noted": disability_n if disability_n >= SUPPRESSION_THRESHOLD else None,
            "percent": pct(disability_n, n) if disability_n >= SUPPRESSION_THRESHOLD else None,
            "suppressed": disability_n > 0 and disability_n < SUPPRESSION_THRESHOLD,
        },
        "referrals": {
            "count": referral_n,
            "percent": referral_pct,
            "referral_field_recorded_for": referral_field_recorded_n,
            "basis": "Referral Needed field = Yes, or clinician remark advising a specialist opinion/evaluation",
        },
        "mental_health": mental_health_summary,
        "key_findings": key_findings,
        "priority_areas": priority_areas,
        "summary_table": summary_table,
        "filter_cube": {
            "dimensions": ["gender", "age_group", "bmi_status", "referral", "finding"],
            "min_group_size": SUPPRESSION_THRESHOLD,
            "combos": filter_cube,
        },
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    output = clean_nans(output)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=1, ensure_ascii=False, allow_nan=False)

    print(f"Processed {total_records} raw records -> {n} unique students after de-duplication.")
    print(f"Filter cube: {len(filter_cube)} published combinations (groups < {SUPPRESSION_THRESHOLD} students omitted).")
    print(f"Wrote aggregated dashboard data to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
