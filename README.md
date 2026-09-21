# School Health Monitoring Camp — Madanapalle

A professional, privacy-first analytics dashboard for the joint school health
screening camp conducted by **Swaasthya Hospitals** and **The Satsang
Foundation** at:

- C.S.I. Girls High School, Madanapalle
- A.A.M. Elementary School, Madanapalle

The dashboard turns a raw, 75-column clinical screening export into a
polished, aggregated, public-safe report covering nutrition/BMI, vision,
dental, general health, illness patterns, referrals and (where present)
mental-health screening — with **no individual-level rows** published
anywhere on the public site (see Section 4).

---

## 1. Organizations

| Organization | Role |
|---|---|
| **Swaasthya Hospitals** | Clinical screening team, general medicine, dental, ortho, gynecology |
| **The Satsang Foundation** | Community/NGO partner for the camp |

---

## 2. Technology stack

- **HTML5 / CSS3 / vanilla JavaScript** — no build step required
- **Bootstrap 5.3** — layout grid, carousel, form controls (via CDN)
- **Chart.js 4.4** — all charts (via CDN)
- **Bootstrap Icons** — iconography (via CDN)
- **Python 3 (pandas)** — one-time/offline data cleaning & aggregation script
- No React/Angular/Vue, no backend/server required to run the site itself

---

## 3. Data processing workflow

```
raw/Merged_Camp_Data.xlsx   (private — NEVER committed to git)
        │
        ▼
scripts/process-data.py     (cleans, normalizes, aggregates, de-identifies)
        │
        ▼
data/dashboard-data.json    (public — aggregated & anonymised only)
        │
        ▼
index.html + js/*.js        (renders KPIs, charts, tables, filters)
```

Run it yourself:

```bash
cd scripts
python3 process-data.py                       # uses ../raw/Merged_Camp_Data.xlsx by default
python3 process-data.py /path/to/new_file.xlsx  # or point at a replacement export
```

Requires `pandas` (and `openpyxl` for `.xlsx`), both commonly pre-installed;
otherwise `pip install pandas openpyxl`.

### What the script does

- Loads the `Merged Data` sheet (or the first sheet, for a CSV/renamed file)
- De-duplicates on `UHID` (in memory only — UHID is never written to output)
- Normalizes inconsistent Yes/No/blank values and comma-decimal numbers
  (e.g. `"16,0"` → `16.0`)
- Parses age & gender out of the combined `Age/Gender` field and buckets
  age into camp-relevant ranges (Up to 8, 9–11, 12–14, 15–17, 18+)
- Computes BMI status distribution, a BMI histogram, vision results, dental
  finding counts, nutrition/general-health findings, illness patterns,
  referral and disability counts
- Auto-generates the "Key Findings" and "Areas Requiring Attention" content
  directly from the computed numbers
- Pre-computes a **filter cube**: the dashboard's results for every
  combination of its five filters, keeping only combinations with 5+ students
- Writes **only** aggregate counts/percentages to `data/dashboard-data.json`
  — no per-student rows of any kind

### How the data is interpreted (read before changing the script)

These rules exist because the raw export has fields that are easy to misread:

- **Vision:** students with no distance-vision reading are reported as
  **Not Tested**, never as Normal. "Normal" = tested with a 6/5 or 6/6
  reading; any other recorded reading counts as "requires attention"
  (`VISION_NORMAL_READINGS` in the script). Percentages use *tested* students.
- **Colour vision:** the sheet holds `Normal` and `No`. The screening team
  confirmed `No` = *not tested / unclear*, so those students are reported as
  unclear, not as colour-vision concerns.
- **Hearing:** the same rule applies (`No` = not tested / unclear). Almost
  every hearing entry is `No` (only a couple of right-ear `Normal` results),
  so there are too few usable results and hearing is **not reported**.
- **Referrals:** the `Referral Needed` field is blank for every student
  (= *not recorded*, not "no"). A referral is counted when that field is Yes
  **or** a clinician remark advises a specialist opinion/evaluation.
- **Chronic illness:** only the `Chronic Illness:` column counts. The
  free-text `Others (Chronic Illness)` column actually holds clinician
  remarks and is used only to detect referrals and colour-vision remarks.
- **Require Attention** = students with at least one finding: non-normal BMI,
  vision concern, dental finding, nutrition finding, illness, or referral.
- **BMI** uses the recorded value; if it is blank it is calculated from
  height and weight.

---

## 4. Privacy & data protection

This is a **children's medical dataset**, handled accordingly:

- **No names, UHIDs, visit/admission IDs, or narrative clinical remarks**
  are ever written to `data/dashboard-data.json` or rendered on the page.
- **No per-student rows.** `data/dashboard-data.json` holds aggregates only.
  (An earlier version shipped one row per student with exact BMI; in a camp
  this small most children were uniquely identifiable from gender + age band
  + BMI, so that was removed.)
- **Small-cell suppression (everywhere, not only sensitive fields):** any
  count of 1–4 is withheld and shown as “<5”. A filter combination matching
  fewer than 5 students shows no figures at all. When a breakdown (gender,
  age, BMI status) contains any cell under 5, the whole breakdown is
  hidden, so a hidden value cannot be recovered by subtraction. BMI
  histogram bars are merged until every bar holds 5+ students, and
  findings seen in fewer than 5 students are not listed.
- **Residual risk:** with 168 published filter combinations, someone could
  in principle compare overlapping groups to infer a small count. Keep the
  filter set small and do not add more filter dimensions without re-checking.
- **Mental health data** is treated as highly sensitive: only a
  high-level, suppressed summary is ever shown, clearly labelled
  *"Screening indicator — not a clinical diagnosis."* In this dataset, no
  individual responses were actually recorded, and the dashboard reports
  that honestly rather than fabricating statistics.
- **The raw Excel file is excluded from git** via `.gitignore` (`raw/`,
  `*.xlsx`, `*.xls`, `*.csv`, `*.tsv`). It is kept locally for
  reprocessing only.
- The dashboard reads exclusively from the pre-aggregated
  `data/dashboard-data.json` — it never loads or parses the raw workbook
  in the browser.

**Before every push**, verify:
1. `git status` shows nothing under `raw/`
2. `data/dashboard-data.json` contains no names/UHIDs (`grep -i uhid data/dashboard-data.json` should return nothing)
3. No individual mental-health response appears anywhere
4. `data/dashboard-data.json` has no `students` array / per-student rows
5. The zip or repo you share does **not** contain `raw/` (it holds names and UHIDs)
6. You have permission to publish the camp photographs, which show children

---

## 5. Dashboard features

- Animated KPI cards (students screened, gender split, average BMI, normal
  BMI %, students requiring attention, dental findings, vision concerns,
  referrals) — all computed live from the dataset
- 8 purpose-built charts: gender, age, BMI status, BMI histogram, vision
  results, dental findings, nutrition/general health, recent illness
- Auto-generated **Key Findings** and **Areas Requiring Attention** sections
- Suppressed, aggregate **Mental Health Screening Summary**
- Photo-and-chart alternating layout using real camp photographs
- Bootstrap carousel of camp activities with accurate captions
- Searchable, sortable, paginated **Screening Indicator Summary** table
- Live filters (gender, age group, BMI status, referral status, health
  finding) that update the KPI cards and the gender, age and BMI charts from
  the pre-computed filter cube (small groups hidden) — reset with one click.
  The vision, dental, nutrition and illness charts always show the whole camp.
- Fully responsive: desktop, laptop, tablet and mobile
- Subtle, accessible motion (count-up KPIs, scroll reveal, hover states)
  that respects `prefers-reduced-motion`

---

## 6. Folder structure

```
school-health-dashboard/
├── index.html
├── README.md
├── .gitignore
├── css/
│   └── style.css
├── js/
│   ├── dashboard.js          # KPI counters, findings, filters, table
│   ├── charts.js             # Chart.js instances
│   └── data-processing.js    # loads dashboard-data.json, looks up filter cube
├── data/
│   └── dashboard-data.json   # aggregated, anonymised — safe to publish
├── raw/
│   └── Merged_Camp_Data.xlsx # PRIVATE — excluded from git
├── images/
│   ├── logo-1.png (Swaasthya Hospitals)
│   ├── logo-2.webp (The Satsang Foundation)
│   └── img-1.jpeg … img-6.jpeg (camp photographs)
└── scripts/
    └── process-data.py       # raw → aggregated JSON pipeline
```

---

## 7. Updating the dataset

1. Replace `raw/Merged_Camp_Data.xlsx` with the new export (or pass a path).
2. Re-run the pipeline:
   ```bash
   cd scripts
   python3 process-data.py
   ```
3. Refresh `index.html` in your browser — the KPIs, charts, findings and
   table all update automatically from the new `dashboard-data.json`.
4. Re-verify the privacy checklist in Section 4 before committing/pushing.

---

## 8. Run locally

No build step or server-side code is required.

```bash
cd school-health-dashboard
python3 -m http.server 8000
# then open http://localhost:8000 in your browser
```

(Opening `index.html` directly via `file://` also works in most browsers,
though some browsers restrict `fetch()` of local JSON under `file://` —
serving it, as above, avoids that.)

---

## 9. Deploy to GitHub Pages

```bash
git init
git add .
git commit -m "Build school health monitoring dashboard"
git branch -M main
git remote add origin <YOUR_GITHUB_REPOSITORY_URL>
git push -u origin main
```

Then in the repository settings, enable **Settings → Pages → Deploy from
branch → `main` / root**. The site needs no backend and depends only on
CDN-hosted libraries, so it works as-is on GitHub Pages.

> **Before pushing:** confirm `raw/Merged_Camp_Data.xlsx` is *not* staged
> (`git status` should not list anything under `raw/`) and that
> `data/dashboard-data.json` contains only aggregated statistics.

---

## Privacy note

The raw medical dataset is intentionally excluded from the public
repository. The dashboard uses aggregated/anonymized data to protect
student privacy. This dashboard presents aggregated screening data for
planning and awareness purposes and is **not a substitute for professional
medical diagnosis**.
