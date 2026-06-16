# Repository Summary — LGD Location Selector

> A React + TypeScript web application that provides a hierarchical, searchable location selector for India's Local Government Directory (LGD) dataset, allowing users to pick a location down to the village, subdistrict, or local body level.

---

## Table of Contents

1. [What It Does](#1-what-it-does)
2. [Technology Stack](#2-technology-stack)
3. [Project Structure](#3-project-structure)
4. [Data Sources](#4-data-sources)
5. [How It Works — Architecture & Logic](#5-how-it-works--architecture--logic)
6. [Sequence of Execution](#6-sequence-of-execution)
7. [Component Breakdown](#7-component-breakdown)
8. [Styling & Design System](#8-styling--design-system)
9. [Key Design Decisions](#9-key-design-decisions)

---

## 1. What It Does

The **LGD Location Selector** is a form-based web application that lets users select a geographic location within India through a multi-step, cascading workflow:

1. **Country** — Fixed to India (🇮🇳).
2. **State / Union Territory** — Dropdown populated from the dataset.
3. **District** — Dropdown filtered by the selected state.
4. **Location Search** — A type-ahead search combining **villages**, **subdistricts**, and **local bodies** for the selected district.

After selecting a location the user proceeds through a **3-step flow**:

| Step | Screen | Action |
|------|--------|--------|
| 1 | **Form** | Select state → district → search & pick a location entity |
| 2 | **Review** | Verify all selected details (country, state, district, entity type, entity name, subdistrict, local body) |
| 3 | **Confirmed** | Final confirmation card with option to start over |

The search field provides progressive feedback: loading hints while village data is fetched, a pool-size summary once ready, empty-state warnings when no records exist for a district, and a no-results message when the prefix query matches nothing.

---

## 2. Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Build tool | Vite | 8.x |
| UI framework | React | 19.x |
| Language | TypeScript | 6.x |
| Compiler | React Compiler (via `babel-plugin-react-compiler`) | 1.x |
| Data fetching | `@tanstack/react-query` (listed as dependency) | 5.x |
| Virtualization | `@tanstack/react-virtual` (listed as dependency) | 3.x |
| Utilities | Lodash | 4.x |
| Linting | ESLint + typescript-eslint + react-hooks + react-refresh | — |

> **Note:** While `@tanstack/react-query` and `@tanstack/react-virtual` are installed as dependencies, the current source code uses manual `fetch` + `useEffect` patterns rather than React Query hooks, and does not currently use virtualized lists.

Data files are imported via Vite's `?url` suffix (e.g. `import villagesUrl from './data/villages_data.json?url'`) so `fetch()` receives stable asset URLs at build time.

---

## 3. Project Structure

```
vite-project/
├── index.html                      # SPA entry point — mounts React to <div id="root">
├── vite.config.ts                  # Vite config — React plugin + React Compiler via Babel
├── package.json                    # Dependencies & scripts (dev, build, lint, preview)
├── tsconfig.json                   # Root TS config (references app + node configs)
├── tsconfig.app.json               # App-specific TS config
├── tsconfig.node.json              # Node/build TS config
├── eslint.config.js                # ESLint configuration
│
├── docs/
│   ├── tasks.md                    # Enhancement task spec (village + municipality selection)
│   └── summary.md                  # ← This file
│
└── src/
    ├── main.tsx                    # React entry — createRoot, StrictMode, renders <App>
    ├── App.tsx                     # Root component — data loading, form state, 3-step flow
    ├── App.css                     # All component + layout styles (single CSS file)
    ├── index.css                   # Global reset, typography, dark-mode, root layout
    │
    ├── components/
    │   └── LocationSelect.tsx      # Hierarchical location selector (State → District → Search)
    │
    └── data/
        ├── state_district_data.json    # ~43 KB  — NDJSON: { statename, district_name }
        ├── localBodies_data.json       # ~1.5 MB — NDJSON: { statename, district_name, localbody_name, localbody_type }
        └── villages_data.json          # ~92 MB  — NDJSON: { village_name, subdistrict_name, district_name, statename }
```

---

## 4. Data Sources

The application consumes **three NDJSON files** (newline-delimited JSON, one JSON object per line) stored locally in `src/data/`. These represent data from India's **Local Government Directory (LGD)**.

### 4.1 `state_district_data.json` (~43 KB)

| Field | Description |
|-------|-------------|
| `statename` | Name of the State / Union Territory |
| `district_name` | Name of a District within that State |

**Purpose:** Powers the **State dropdown** and the **District dropdown**. Parsed first to build the base hierarchy and to validate district names used in joins.

### 4.2 `localBodies_data.json` (~1.5 MB)

| Field | Description |
|-------|-------------|
| `statename` | State name |
| `district_name` / `districtname` | District name (two possible field names) |
| `localbody_name` | Name of the local body (municipality, panchayat, etc.) |
| `localbody_type` | Type of local body |

**Purpose:** Provides **local body entities** (municipalities, panchayats, town councils, etc.) that appear in the location search. Inner-joined with `state_district_data.json` on normalized district name to ensure only valid districts are included.

### 4.3 `villages_data.json` (~92 MB)

| Field | Description |
|-------|-------------|
| `statename` | State name |
| `district_name` | District name |
| `subdistrict_name` | Subdistrict (tehsil/block/taluk) name |
| `village_name` | Village name |

**Purpose:** Provides **village entities** and derives **subdistrict entities** for the location search. Due to its large size (~92 MB), it is loaded **asynchronously in the background** after the first two datasets complete, and parsed in chunks to avoid freezing the UI. If this file fails to load, local body search continues to work independently.

---

## 5. How It Works — Architecture & Logic

### 5.1 Data Loading Pipeline

```
                    ┌──────────────────────────┐
      Parallel      │  state_district_data.json │──→ buildHierarchy()
      fetch         │  localBodies_data.json    │──→ buildJoinedLocationRows()
                    └──────────────────────────┘
                              │
                              ▼
                    ┌──────────────────────────┐
      Sequential    │  villages_data.json       │──→ buildIndiaLocationsIndex()
      (after above) │  (~92 MB, chunked parse)  │    returns Map<districtKey, LocationRecord[]>
                    └──────────────────────────┘
```

1. **Phase 1 (Parallel):** `state_district_data.json` and `localBodies_data.json` are fetched simultaneously via `Promise.all`.
2. **Phase 2 (Sequential):** After Phase 1 completes successfully, `villages_data.json` is fetched and parsed in chunks of 8,000 lines per iteration, yielding to the event loop (`setTimeout(resolve, 0)`) between chunks to keep the UI responsive.

**Loading stages** surfaced in the UI: `datasets` → `parsing` → `villages`.

**Resilience:**
- Primary dataset failure blocks the form and shows a **Retry** button.
- Village dataset failure sets `indiaError` and shows a non-blocking warning; **local body search still works**.

### 5.2 Data Transformation Functions

| Function | Input | Output | Purpose |
|----------|-------|--------|---------|
| `parseNdjson<T>()` | Raw NDJSON string | `T[]` | Splits lines, trims, parses each as JSON |
| `normalizeKey()` | String | Lowercase trimmed string | Canonical key for district lookups and joins |
| `buildHierarchy()` | `Loc1Record[]` | `CountryData[]` | Builds `Country → State → District` tree for dropdowns |
| `buildLocationDistrictKeys()` | `Loc1Record[]` | `Set<string>` | Creates normalized district-name keys for join validation |
| `buildJoinedLocationRows()` | `Loc1Record[]`, `FinalMappingRecord[]` | `LocationRecord[]` | Inner-joins local bodies with valid district names |
| `buildIndiaLocationsIndex()` | Raw NDJSON string | `Map<string, LocationRecord[]>` | Indexes villages + derived subdistricts by normalized district name |

**District indexing:** Records are keyed by `normalizeKey(district_name)` — a lowercase, trimmed district name — rather than a composite `state|district` key. The UI already constrains selection to a single state and district before search, so the index lookup uses the selected district name directly.

**Subdistrict derivation:** During village parsing, unique `subdistrict_name` values are collected per district. After all chunks are processed, each unique subdistrict is appended as its own searchable `LocationRecord` with `entityType: 'Subdistrict'`.

### 5.3 Search & Selection Logic

When the user types into the search field (minimum 2 characters), the `LocationSearchRow` component:

1. **Builds a pool** of searchable records by combining:
   - **Local bodies** from `locationRows` (filtered to the selected district by normalized district name)
   - **Villages + subdistricts** from `indiaLocationRows` (pre-filtered by `App` via the district index map)
2. **Filters** the pool with a **case-insensitive prefix match** (`startsWith`) across `entityName`, `subdistrictNameEnglish`, `localBodyNameEnglish`, `localBodyTypeName`, and `entityType`.
3. **Caps results** at 35 suggestions (`MAX_SUGGESTIONS`).
4. **Displays** each suggestion with a label, type badge, and breadcrumb metadata.

On selection, `handleRecordSelect` maps the record into `LocationValue`:
- `subdistrict` is populated only when the entity type is **Village**.
- The dataset typo `Subistrict` is normalized to **Subdistrict** in the stored value.

### 5.4 Form State Machine

```
    ┌──────────┐   Submit    ┌──────────┐   Confirm   ┌────────────┐
    │   FORM   │ ──────────→ │  REVIEW  │ ──────────→ │ CONFIRMED  │
    └──────────┘             └──────────┘             └────────────┘
         ↑                        │                        │
         │         ← Edit ────────┘                        │
         │                                                 │
         └─────────────── ↺ Select Another ────────────────┘
```

- **FORM:** User picks State, District, and searches for a location entity.
- **REVIEW:** Displays all selected fields (country, state, district, entity type/name, subdistrict, local body, local body type) for verification.
- **CONFIRMED:** Shows the final confirmed location card. User can reset and start over.

---

## 6. Sequence of Execution

Below is the end-to-end execution flow from browser load to confirmed selection:

```
1.  Browser loads index.html
    └── <script> imports src/main.tsx

2.  main.tsx
    ├── Imports index.css (global styles)
    ├── Calls createRoot(document.getElementById('root'))
    └── Renders <StrictMode> → <App />

3.  App component mounts
    ├── State initialized: isLoading=true, loadingStage='datasets'
    │
    ├── useEffect #1 → loadDatasets()
    │   ├── fetch(state_district_data.json)  ─┐
    │   ├── fetch(localBodies_data.json)      ─┤  Parallel (via ?url imports)
    │   │                                      │
    │   ├── parseNdjson(raw1) → Loc1Record[]   │
    │   ├── parseNdjson(raw2) → FinalMappingRecord[]
    │   │                                      │
    │   ├── buildHierarchy(records) ──────────→ setVillageData(CountryData[])
    │   ├── buildJoinedLocationRows(loc, map) → setLocationRows(LocationRecord[])
    │   └── isLoading=false
    │
    ├── useEffect #2 → loadIndiaLocations() (fires after Phase 1 succeeds)
    │   ├── fetch(villages_data.json)   // ~92 MB
    │   ├── buildIndiaLocationsIndex()  // chunked parse, 8000 lines/chunk
    │   │   ├── Parse chunk → collect villages + subdistrict names
    │   │   ├── Yield to event loop → parse next chunk
    │   │   ├── Append derived Subdistrict records
    │   │   └── Build Map<districtKey, LocationRecord[]>
    │   ├── setIndiaIndex(map) on success
    │   └── setIndiaError(message) on failure — form remains usable for local bodies
    │
    └── Renders UI in 'form' step

4.  User interaction — Form step
    ├── User selects State → onChange cascades: district='', entity cleared
    ├── User selects District → onChange cascades: entity cleared
    │   └── App.useMemo recomputes indiaLocationRows from indiaIndex for this district
    ├── User types in Search Location field (min 2 chars)
    │   └── LocationSearchRow filters pool (prefix match) → shows up to 35 suggestions
    ├── User picks a suggestion → handleRecordSelect()
    │   └── Updates LocationValue with entityName, entityType, subdistrict, localBody, etc.
    └── User clicks "Review Location →" → validates → step='review'

5.  Review step
    ├── Displays all fields via buildReviewFields()
    ├── "✓ Confirm Location" → handleConfirm() → step='confirmed'
    └── "← Edit" → handleEdit() → step='form'

6.  Confirmed step
    ├── Displays confirmed location card
    └── "↺ Select Another Location" → handleReset() → clears all state → step='form'
```

---

## 7. Component Breakdown

### `App` ([App.tsx](../src/App.tsx))

The root component. Responsibilities:
- **Data loading & error handling** — Manages fetch lifecycle for all 3 datasets with separate loading/error states for primary data vs. village data
- **Retry on failure** — Primary dataset errors expose a retry button that re-runs `loadDatasets()`
- **Form state** — Owns the `LocationValue` object and the 3-step state machine (`form` → `review` → `confirmed`)
- **Data transformation** — Runs `buildHierarchy`, `buildJoinedLocationRows`, `buildIndiaLocationsIndex`
- **District slice** — `useMemo` extracts `indiaLocationRows` for the currently selected district from `indiaIndex`
- **Layout** — Renders the header, banners (loading/error), form, review card, or confirmation card

### `LocationSelect` ([LocationSelect.tsx](../src/components/LocationSelect.tsx))

The main location picker fieldset. Responsibilities:
- **State dropdown** (`SelectRow`) — Populated from `CountryData[].states`
- **District dropdown** (`SelectRow`) — Filtered by selected state, with count hints
- **Location search** (`LocationSearchRow`) — Type-ahead over combined local bodies + villages + subdistricts
- **Cascade reset** — If state changes, district and entity are cleared. If district changes, entity is cleared. Invalid upstream values are cleared automatically via `useEffect`.

### `LocationSearchRow` (internal to LocationSelect.tsx)

The search input with autocomplete dropdown. Responsibilities:
- **Pool building** — Merges `locationRows` (local bodies) filtered to current district + `indiaLocationRows` (villages/subdistricts)
- **Prefix filtering** — Case-insensitive `startsWith` matching across multiple fields
- **Keyboard navigation** — Arrow keys, Enter to select, Escape to close
- **Clear control** — × button to reset query and selection
- **Progressive UX** — Loading placeholders, pool-size hint, empty-pool warning, no-results message
- **Selection chips** — Shows entity type, subdistrict (for villages), local body, and local body type after selection

### `SelectRow` (internal to LocationSelect.tsx)

A reusable select-dropdown row with label, hint text, loading state, and empty-state messaging.

### `StatusNote` (internal to LocationSelect.tsx)

A small status message component with `info` and `warn` variants.

---

## 8. Styling & Design System

### Design Theme

The app uses a **warm terracotta/saffron** color palette inspired by Indian administrative maps and census forms:

| Token | Value | Usage |
|-------|-------|-------|
| `--accent` | `#c0470a` | Primary terracotta accent (buttons, highlights, title) |
| `--ink` | `#1a1208` | Deep dark text |
| `--surface` | `#fdf8f1` | Warm off-white background |
| `--ok` | `#2d6a4f` | Success/info green |
| `--err` | `#9b1c1c` | Error red |

### Typography

- **Headings:** Playfair Display (serif, loaded from Google Fonts)
- **Body:** DM Sans (sans-serif, loaded from Google Fonts)

### CSS Architecture

- **`index.css`** — Global reset, root layout, dark-mode color overrides, typography scale
- **`App.css`** — All component styles in a single file. Uses CSS custom properties extensively. Includes animations (`spin`, `slide-in`), responsive breakpoints, and accessibility considerations.

---

## 9. Key Design Decisions

1. **NDJSON over JSON arrays:** All data files use newline-delimited JSON. This allows line-by-line parsing and reduces peak memory usage when processing the 92 MB village file.

2. **Chunked async parsing for villages:** The `buildIndiaLocationsIndex` function processes 8,000 lines per iteration and yields to the event loop between chunks, preventing the main thread from blocking.

3. **District-keyed index:** Villages and subdistricts are indexed by normalized district name (`normalizeKey`). When the user selects a district, only the relevant slice is extracted from the index — avoiding a full scan of 92 MB of data on every keystroke. State is enforced upstream by the dropdown cascade.

4. **Derived subdistrict records:** Subdistricts are not stored as standalone rows in the source file; they are collected as unique names during village parsing and emitted as searchable entities in a second pass.

5. **Join validation by district name:** Local body records from `localBodies_data.json` are inner-joined against valid district names from `state_district_data.json`, ensuring only legitimate district combinations appear.

6. **Graceful degradation for village data:** Village/subdistrict loading runs independently after primary datasets. Failure shows a warning banner but leaves local body search functional.

7. **Prefix search over substring search:** Matching uses `startsWith` rather than arbitrary substring matching, which better supports type-ahead behavior and reduces noisy partial matches.

8. **Country fixed to India:** The UI hardcodes the country as India. The `CountryData` type supports multiple countries structurally, but only India is populated.

9. **React Compiler enabled:** The project uses `babel-plugin-react-compiler` for automatic memoization and optimization, reducing the need for manual `React.memo`, `useMemo`, and `useCallback` in some cases.

10. **Max 35 suggestions:** The search caps results at 35 to avoid rendering performance issues with long lists of unvirtualized DOM elements.

---

*Last updated 2026-06-15. Refer to the source code for the most up-to-date implementation details.*
