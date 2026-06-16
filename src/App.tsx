import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  LocationSelect,
  type LocationValue,
  type LocationRecord,
  type CountryData,
  type StateData,
} from './components/LocationSelect'
import locationsUrl from './data/state_district_data.json?url'
import finalMappingUrl from './data/localBodies_data.json?url'
import villagesUrl from './data/villages_data.json?url'
import './App.css'

// ─── JSON 1 parsing — sate_district_data.json ─────────────────────────────────────────
// NDJSON: { statename, district_name }

type Loc1Record = {
  statename: string
  district_name: string
}

const INDIA_NAME = 'India'

function parseNdjson<T>(raw: string): T[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T)
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * Build CountryData hierarchy from locations.json records.
 */
function buildHierarchy(records: Loc1Record[]): CountryData[] {
  const stateMap = new Map<string, Set<string>>()

  for (const r of records) {
    const state    = r.statename?.trim()
    const district = r.district_name?.trim()
    if (!state || !district) continue

    if (!stateMap.has(state)) stateMap.set(state, new Set())
    stateMap.get(state)!.add(district)
  }

  const states: StateData[] = [...stateMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([stateName, districtSet], idx) => ({
      name: stateName,
      code: String(idx + 1).padStart(2, '0'),
      districts: [...districtSet]
        .sort((a, b) => a.localeCompare(b))
        .map((districtName) => ({
          name: districtName,
          villages: [],
        })),
    }))

  return [{ name: INDIA_NAME, code: 'IN', states }]
}

/** District keys present in locations.json: "district" */
function buildLocationDistrictKeys(records: Loc1Record[]): Set<string> {
  const keys = new Set<string>()
  for (const r of records) {
    const district = r.district_name?.trim()
    if (!district) continue
    keys.add(normalizeKey(district))
  }
  return keys
}

// ─── JSON 2 parsing — final_mapping.json ─────────────────────────────────────
// Join: district_name (final_mapping) ↔ district_name_english (locations.json)

type FinalMappingRecord = {
  statename?: string
  district_name?: string
  districtname?: string
  localbody_name?: string
  localbody_type?: string
}

function getMappingDistrictName(row: FinalMappingRecord): string {
  return (row.district_name ?? row.districtname ?? '').trim()
}

function buildJoinedLocationRows(
  locationRecords: Loc1Record[],
  mappingRecords: FinalMappingRecord[],
): LocationRecord[] {
  const validDistrictKeys = buildLocationDistrictKeys(locationRecords)
  const rows: LocationRecord[] = []

  for (const row of mappingRecords) {
    const state    = row.statename?.trim()
    const district = getMappingDistrictName(row)
    const localBody = row.localbody_name?.trim()
    const localBodyType = row.localbody_type?.trim() ?? ''
    if (!state || !district || !localBody) continue

    const joinKey = normalizeKey(district)
    if (!validDistrictKeys.has(joinKey)) continue

    rows.push({
      stateNameEnglish: state,
      districtNameEnglish: district,
      localBodyNameEnglish: localBody,
      localBodyTypeName: localBodyType,
      entityName: localBody,
      entityType: 'Local Body',
    })
  }

  return rows
}

// ─── JSON 3 — villages_data.json (villages + subdistricts by district) ────────

type IndiaLocRecord = {
  village_name?: string
  subdistrict_name?: string
  district_name?: string
  statename?: string
}

const INDIA_PARSE_CHUNK = 8000

function districtKey(district: string): string {
  return normalizeKey(district)
}

async function buildIndiaLocationsIndex(
  raw: string,
): Promise<Map<string, LocationRecord[]>> {
  const index = new Map<string, LocationRecord[]>()
  const subdistrictSets = new Map<string, Set<string>>()
  const districtMeta = new Map<string, { state: string; district: string }>()
  const lines = raw.split(/\r?\n/)

  for (let start = 0; start < lines.length; start += INDIA_PARSE_CHUNK) {
    const end = Math.min(start + INDIA_PARSE_CHUNK, lines.length)
    for (let i = start; i < end; i++) {
      const line = lines[i].trim()
      if (!line) continue

      let row: IndiaLocRecord
      try {
        row = JSON.parse(line) as IndiaLocRecord
      } catch {
        continue
      }

      const state = row.statename?.trim()
      const district = row.district_name?.trim()
      const village = row.village_name?.trim()
      const subdistrict = row.subdistrict_name?.trim()
      if (!state || !district) continue

      const key = districtKey(district)
      if (!index.has(key)) index.set(key, [])
      if (!subdistrictSets.has(key)) subdistrictSets.set(key, new Set())
      if (!districtMeta.has(key)) districtMeta.set(key, { state, district })

      if (village) {
        index.get(key)!.push({
          stateNameEnglish: state,
          districtNameEnglish: district,
          localBodyNameEnglish: '',
          localBodyTypeName: '',
          entityName: village,
          entityType: 'Village',
          subdistrictNameEnglish: subdistrict,
        })
      }
      if (subdistrict) subdistrictSets.get(key)!.add(subdistrict)
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  for (const [key, subs] of subdistrictSets) {
    const meta = districtMeta.get(key)
    if (!meta) continue
    const rows = index.get(key) ?? []
    for (const sub of subs) {
      rows.push({
        stateNameEnglish: meta.state,
        districtNameEnglish: meta.district,
        localBodyNameEnglish: '',
        localBodyTypeName: '',
        entityName: sub,
        entityType: 'Subdistrict',
        subdistrictNameEnglish: sub,
      })
    }
    index.set(key, rows)
  }

  return index
}

// ─── Review helpers ───────────────────────────────────────────────────────────

type ReviewField = { label: string; value: string }

function buildReviewFields(loc: LocationValue): ReviewField[] {
  const fields: ReviewField[] = [
    { label: 'Country',  value: loc.country },
    { label: 'State',    value: loc.state },
    { label: 'District', value: loc.district },
  ]
  if (loc.entityType)    fields.push({ label: 'Location Type',  value: loc.entityType })
  if (loc.entityName)    fields.push({ label: 'Location Name',  value: loc.entityName })
  if (loc.subdistrict)   fields.push({ label: 'Subdistrict',    value: loc.subdistrict })
  if (loc.localBody)     fields.push({ label: 'Local Body',     value: loc.localBody })
  if (loc.localBodyType) fields.push({ label: 'Local Body Type', value: loc.localBodyType })
  return fields
}

// ─── App ──────────────────────────────────────────────────────────────────────

type Step = 'form' | 'review' | 'confirmed'

function App() {
  // ── Data loading ────────────────────────────────────────────────────────────

  const [villageData,  setVillageData]  = useState<CountryData[]>([])
  const [locationRows, setLocationRows] = useState<LocationRecord[]>([])
  const [indiaIndex,   setIndiaIndex]   = useState<Map<string, LocationRecord[]> | null>(null)
  const [isLoading,    setIsLoading]    = useState(true)
  const [isLoadingIndia, setIsLoadingIndia] = useState(false)
  const [dataError,    setDataError]    = useState('')
  const [indiaError,   setIndiaError]   = useState('')
  const [loadingStage, setLoadingStage] = useState<'datasets' | 'parsing' | 'villages' | ''>('datasets')

  async function loadDatasets(mounted: { current: boolean }) {
    setIsLoading(true)
    setDataError('')
    setLoadingStage('datasets')
    try {
      const [res1, res2] = await Promise.all([
        fetch(locationsUrl),
        fetch(finalMappingUrl),
      ])

      if (!res1.ok) throw new Error(`Unable to load locations.json (HTTP ${res1.status}). Please check the file is in /src/data/.`)
      if (!res2.ok) throw new Error(`Unable to load final_mapping.json (HTTP ${res2.status}). Please check the file is in /src/data/.`)

      setLoadingStage('parsing')
      const [raw1, raw2] = await Promise.all([res1.text(), res2.text()])

      if (mounted.current) {
        const locationRecords = parseNdjson<Loc1Record>(raw1)
        const mappingRecords = parseNdjson<FinalMappingRecord>(raw2)
        setVillageData(buildHierarchy(locationRecords))
        setLocationRows(buildJoinedLocationRows(locationRecords, mappingRecords))
      }
    } catch (err) {
      if (mounted.current) {
        setDataError(
          err instanceof Error
            ? err.message
            : 'Failed to load datasets. Please check your network and try again.',
        )
      }
    } finally {
      if (mounted.current) {
        setIsLoading(false)
        setLoadingStage('')
      }
    }
  }

  useEffect(() => {
    const mounted = { current: true }
    loadDatasets(mounted)
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    if (isLoading || dataError || indiaIndex) return

    const mounted = { current: true }
    async function loadIndiaLocations() {
      setIsLoadingIndia(true)
      setIndiaError('')
      setLoadingStage('villages')
      try {
        const res = await fetch(villagesUrl)
        if (!res.ok) {
          throw new Error(
            `Unable to load villages_data.json (HTTP ${res.status}). Please check the file is in /src/data/.`,
          )
        }
        const raw = await res.text()
        const index = await buildIndiaLocationsIndex(raw)
        if (mounted.current) setIndiaIndex(index)
      } catch (err) {
        if (mounted.current) {
          setIndiaError(
            err instanceof Error
              ? err.message
              : 'Failed to load village and subdistrict data.',
          )
        }
      } finally {
        if (mounted.current) {
          setIsLoadingIndia(false)
          setLoadingStage('')
        }
      }
    }

    loadIndiaLocations()
    return () => { mounted.current = false }
  }, [isLoading, dataError, indiaIndex])

  // ── Form state ──────────────────────────────────────────────────────────────

  const [step, setStep] = useState<Step>('form')

  const emptyLocation: LocationValue = {
    country: INDIA_NAME,
    state: '',
    district: '',
    entityName: '',
    entityType: '',
    subdistrict: '',
    localBody: '',
    localBodyType: '',
  }

  const [location,          setLocation]          = useState<LocationValue>(emptyLocation)

  const indiaLocationRows = useMemo(() => {
    if (!location.state || !location.district || !indiaIndex) return []
    return indiaIndex.get(districtKey(location.district)) ?? []
  }, [location.state, location.district, indiaIndex])
  const [formError,         setFormError]         = useState('')
  const [confirmedLocation, setConfirmedLocation] = useState<LocationValue | null>(null)

  // ── Handlers ────────────────────────────────────────────────────────────────

  function handleSubmitForm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (!location.state) {
      setFormError('Please select a State / Union Territory to continue.')
      return
    }
    if (!location.district) {
      setFormError('Please select a District to continue.')
      return
    }
    if (!location.entityName) {
      setFormError(
        'Please search for and select a village, subdistrict, or local body.',
      )
      return
    }

    setFormError('')
    setStep('review')
  }

  function handleConfirm() {
    setConfirmedLocation(location)
    setStep('confirmed')
  }

  function handleEdit() {
    setStep('form')
  }

  function handleReset() {
    setLocation(emptyLocation)
    setFormError('')
    setConfirmedLocation(null)
    setStep('form')
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <h1 className="app-title">LGD Location Selector</h1>
        </div>
      </header>

      {/* Tab bar */}
      {/* <div className="tab-bar" role="tablist" aria-label="Location type">
        <button
          role="tab"
          aria-selected={true}
          className="tab-btn tab-btn--active"
        >
          Village
        </button>
      </div> */}

      <div className="panel">

        {/* Loading banner */}
        {isLoading && (
          <div className="banner banner--loading" aria-live="polite" aria-label="Loading datasets">
            <span className="banner-spinner" aria-hidden="true" />
            {loadingStage === 'datasets'
              ? 'Fetching location datasets…'
              : loadingStage === 'villages'
                ? 'Loading villages and subdistricts (large file, may take a minute)…'
                : 'Parsing location records, this may take a moment…'}
          </div>
        )}

        {/* Error banner with retry */}
        {indiaError && !dataError && (
          <div className="banner banner--error" role="alert">
            <strong>Village data unavailable.</strong> {indiaError} Local body search still works.
          </div>
        )}

        {dataError && (
          <div className="banner banner--error" role="alert">
            <strong>Failed to load data.</strong> {dataError}
            <button
              type="button"
              className="submit-btn"
              onClick={() => {
                const mounted = { current: true }
                loadDatasets(mounted)
              }}
              style={{ marginTop: 8, display: 'block' }}
            >
              ↺ Retry
            </button>
          </div>
        )}

        {/* ── STEP 1: Form ───────────────────────────────────────────────────── */}
        {step === 'form' && (
          <section aria-label="Village location form">
            <form className="location-form" onSubmit={handleSubmitForm} noValidate>
              <LocationSelect
                value={location}
                onChange={(next) => {
                  setLocation(next)
                  if (formError) setFormError('')
                }}
                data={villageData}
                locationRows={locationRows}
                indiaLocationRows={indiaLocationRows}
                required
                disabled={isLoading || Boolean(dataError)}
                isLoadingData={isLoading}
                isLoadingIndiaLocations={isLoadingIndia}
              />

              {formError && (
                <p className="form-error" role="alert">{formError}</p>
              )}

              <button
                type="submit"
                className="submit-btn"
                disabled={isLoading || Boolean(dataError)}
              >
                Review Location →
              </button>
            </form>
          </section>
        )}

        {/* ── STEP 2: Review ─────────────────────────────────────────────────── */}
        {step === 'review' && (
          <section aria-label="Review your location" aria-live="polite">
            <section className="result-card">
              <h2 className="result-title">Review Location Details</h2>
              <p style={{ marginBottom: '1rem', opacity: 0.7, fontSize: 14 }}>
                Please verify all details before confirming.
              </p>
              <dl className="result-list">
                {buildReviewFields(location).map(({ label, value }) => (
                  <>
                    <dt key={`dt-${label}`}>{label}</dt>
                    <dd key={`dd-${label}`}>{value}</dd>
                  </>
                ))}
              </dl>
            </section>

            <div style={{ display: 'flex', gap: 12, marginTop: '1rem', flexWrap: 'wrap' }}>
              <button type="button" className="submit-btn" onClick={handleConfirm} style={{ flex: 1 }}>
                ✓ Confirm Location
              </button>
              <button type="button" className="submit-btn" onClick={handleEdit} style={{ flex: 1, opacity: 0.7 }}>
                ← Edit
              </button>
            </div>
          </section>
        )}

        {/* ── STEP 3: Confirmed ──────────────────────────────────────────────── */}
        {step === 'confirmed' && confirmedLocation && (
          <section aria-label="Confirmed location" aria-live="polite">
            <section className="result-card">
              <h2 className="result-title">✓ Confirmed Location</h2>
              <dl className="result-list">
                {buildReviewFields(confirmedLocation).map(({ label, value }) => (
                  <>
                    <dt key={`dt-${label}`}>{label}</dt>
                    <dd key={`dd-${label}`}>{value}</dd>
                  </>
                ))}
              </dl>
            </section>

            <button
              type="button"
              className="submit-btn"
              onClick={handleReset}
              style={{ marginTop: '1rem', opacity: 0.8 }}
            >
              ↺ Select Another Location
            </button>
          </section>
        )}

      </div>
    </main>
  )
}

export default App