/**
 * Hierarchical location selector for India.
 *
 * JSON 1 — sate_district_data.json (NDJSON)
 *   Fields: { statename, district_name }
 *   Powers: State dropdown → District dropdown
 *
 * JSON 2 — localBodies_data.json (NDJSON), joined on district:
 *   localBodies_data.district_name ↔ sate_district_data.district_name
 *
 * JSON 3 — villages_data.json (NDJSON), filtered by selected district:
 *   village_name, subdistrict_name, district_name, statename
 *
 * Search combines local bodies + villages + subdistricts for the selected district.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

/** One searchable row (local body, village, or subdistrict) */
export type LocationRecord = {
  stateNameEnglish: string
  districtNameEnglish: string
  localBodyNameEnglish: string
  localBodyTypeName: string
  entityName: string
  entityType: 'Village' | 'Subistrict' | 'Subdistrict' | 'District' | 'Local Body' | string
  subdistrictNameEnglish?: string
}

export type DistrictData = {
  name: string
  villages: { name: string; subdistricts: string[] }[]
}

export type StateData = {
  name: string
  code: string
  districts: DistrictData[]
}

export type CountryData = {
  name: string
  code: string
  states: StateData[]
}

export type LocationValue = {
  country: string
  state: string
  district: string
  entityName: string
  entityType: string
  subdistrict: string
  localBody: string
  localBodyType: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const INDIA_NAME = 'India'
const MAX_SUGGESTIONS = 35

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Primary display label for a suggestion — entityName is always the specific place */
function getRecordLabel(r: LocationRecord): string {
  return r.entityName || r.localBodyNameEnglish || ''
}

/** Secondary breadcrumb shown under the label */
function getRecordMeta(r: LocationRecord): string {
  const parts: string[] = []
  if (r.subdistrictNameEnglish?.trim() && r.entityType === 'Village')
    parts.push(r.subdistrictNameEnglish.trim())
  if (r.localBodyNameEnglish && r.localBodyNameEnglish !== r.entityName)
    parts.push(r.localBodyNameEnglish)
  if (r.localBodyTypeName?.trim()) parts.push(r.localBodyTypeName.trim())
  return parts.join(' · ')
}

function recordKey(r: LocationRecord): string {
  return `${r.entityType}|${r.entityName}|${r.subdistrictNameEnglish ?? ''}|${r.localBodyNameEnglish}`
}

/** Badge label shown on the type pill */
function getEntityTypeLabel(r: LocationRecord): string {
  if (r.entityType === 'Subistrict') return 'Subdistrict'  // fix typo in dataset
  return r.entityType || r.localBodyTypeName?.trim() || 'Location'
}

// ─── Shared UI primitives ─────────────────────────────────────────────────────

type SelectRowProps = {
  id: string
  label: string
  value: string
  disabled?: boolean
  required?: boolean
  placeholder: string
  hint?: string
  isLoading?: boolean
  emptyMessage?: string
  options: { value: string; label: string }[]
  onChange: (val: string) => void
}

function SelectRow({
  id, label, value, disabled, required, placeholder, hint, isLoading, emptyMessage, options, onChange,
}: SelectRowProps) {
  const showEmpty = !isLoading && options.length === 0 && emptyMessage

  return (
    <div className="ls-row">
      <label className="ls-label" htmlFor={id}>
        {label}
        {required && <span className="ls-required" aria-hidden="true"> *</span>}
      </label>
      <div className="ls-select-wrap">
        <select
          id={id}
          name={id}
          value={value}
          disabled={disabled || isLoading}
          required={required}
          className="ls-select"
          aria-busy={isLoading}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(e) => onChange(e.target.value)}
        >
          {isLoading
            ? <option value="">Loading…</option>
            : <option value="">{placeholder}</option>
          }
          {!isLoading && options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <span className="ls-chevron" aria-hidden="true">▾</span>
      </div>
      {hint && !showEmpty && (
        <p id={`${id}-hint`} className="ls-note ls-note--info" style={{ marginTop: 4 }}>
          {hint}
        </p>
      )}
      {showEmpty && (
        <StatusNote variant="warn">{emptyMessage}</StatusNote>
      )}
    </div>
  )
}

function StatusNote({
  children,
  variant = 'info',
}: {
  children: React.ReactNode
  variant?: 'info' | 'warn'
}) {
  return (
    <p className={`ls-note ls-note--${variant}`} aria-live="polite">
      {children}
    </p>
  )
}

// ─── LocationSearchRow ────────────────────────────────────────────────────────

type LocationSearchRowProps = {
  stateName: string
  districtName: string
  locationRows: LocationRecord[]
  indiaLocationRows: LocationRecord[]
  selectedRecord: LocationRecord | null
  disabled?: boolean
  required?: boolean
  isLoadingData?: boolean
  isLoadingIndiaLocations?: boolean
  onSelect: (record: LocationRecord | null) => void
}

function LocationSearchRow({
  stateName,
  districtName,
  locationRows,
  indiaLocationRows,
  selectedRecord,
  disabled,
  required,
  isLoadingData,
  isLoadingIndiaLocations,
  onSelect,
}: LocationSearchRowProps) {
  const [query, setQuery] = useState(
    selectedRecord ? getRecordLabel(selectedRecord) : '',
  )
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const prevState = useRef(stateName)
  const prevDistrict = useRef(districtName)

  // Reset when state or district changes upstream
  useEffect(() => {
    if (prevState.current !== stateName || prevDistrict.current !== districtName) {
      setQuery('')
      setOpen(false)
      setActiveIdx(-1)
      onSelect(null)
      prevState.current = stateName
      prevDistrict.current = districtName
    }
  }, [stateName, districtName, onSelect])

  // Local bodies (final_mapping) + villages/subdistricts (indiaLocations) for this district
  const pool = useMemo(() => {
    if (!stateName || !districtName) return []
    const stateKey = stateName.toLowerCase()
    const districtKey = districtName.toLowerCase()
    const localBodies = locationRows.filter(
      (r) =>
        r.stateNameEnglish?.toLowerCase() === stateKey &&
        r.districtNameEnglish?.toLowerCase() === districtKey,
    )
    return [...localBodies, ...indiaLocationRows]
  }, [locationRows, indiaLocationRows, stateName, districtName])

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || q.length < 2 || selectedRecord) return []
    return pool
      .filter((r) => {
        const haystack = [
          r.entityName,
          r.subdistrictNameEnglish,
          r.localBodyNameEnglish,
          r.localBodyTypeName,
          r.entityType,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return haystack.includes(q)
      })
      .slice(0, MAX_SUGGESTIONS)
  }, [pool, query, selectedRecord])

  function handlePick(record: LocationRecord) {
    setQuery(getRecordLabel(record))
    setOpen(false)
    setActiveIdx(-1)
    onSelect(record)
  }

  function handleClear() {
    setQuery('')
    setOpen(false)
    setActiveIdx(-1)
    onSelect(null)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault()
      handlePick(suggestions[activeIdx])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const searchBusy = isLoadingData || isLoadingIndiaLocations
  const isDisabled = disabled || !stateName || !districtName || isLoadingData
  const poolSize = pool.length
  const showEmptyPool =
    !searchBusy && !!stateName && !!districtName && poolSize === 0
  const showNoResults =
    query.trim().length >= 2 && !selectedRecord && suggestions.length === 0 && !showEmptyPool && !searchBusy

  function getPlaceholder(): string {
    if (isLoadingData) return 'Loading location data…'
    if (isLoadingIndiaLocations) return 'Loading villages and subdistricts…'
    if (!stateName) return 'Select a state first'
    if (!districtName) return 'Select a district first'
    if (showEmptyPool) return 'No locations available for this district'
    return 'Type village, subdistrict, or local body name…'
  }

  return (
    <div className="ls-row">
      <label className="ls-label" htmlFor="ls-location-search">
        Search Location
        {required && <span className="ls-required" aria-hidden="true"> *</span>}
      </label>

      <div className="ls-input-wrap" style={{ position: 'relative' }}>
        <span className="ls-search-icon" aria-hidden="true">⌕</span>
        <input
          ref={inputRef}
          id="ls-location-search"
          type="search"
          className="ls-input"
          value={query}
          disabled={isDisabled || (showEmptyPool && !isLoadingIndiaLocations)}
          placeholder={getPlaceholder()}
          autoComplete="off"
          aria-label="Search for village, local body, or municipality"
          aria-busy={searchBusy}
          aria-autocomplete="list"
          aria-expanded={open && suggestions.length > 0}
          aria-controls="ls-location-listbox"
          aria-describedby="ls-location-search-hint"
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            setActiveIdx(-1)
            if (selectedRecord) onSelect(null)
          }}
          onFocus={() => { if (suggestions.length > 0) setOpen(true) }}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          onKeyDown={handleKeyDown}
        />

        {/* Clear button */}
        {query && !isDisabled && (
          <button
            type="button"
            onClick={handleClear}
            aria-label="Clear selected location"
            tabIndex={-1}
            style={{
              position: 'absolute', right: 8, top: '50%',
              transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 16, lineHeight: 1, opacity: 0.5, padding: '0 2px',
            }}
          >
            ×
          </button>
        )}

        {/* Suggestions dropdown */}
        {open && suggestions.length > 0 && (
          <ul
            id="ls-location-listbox"
            role="listbox"
            aria-label="Location suggestions"
            style={{
              position: 'absolute', top: '100%', left: 0, right: 0,
              zIndex: 100, listStyle: 'none', margin: 0, padding: 0,
              background: 'var(--ls-bg, #fff)',
              border: '1px solid var(--ls-border, #d1d5db)',
              borderRadius: 6,
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              maxHeight: 300, overflowY: 'auto',
            }}
          >
            {suggestions.map((rec, i) => {
              const label = getRecordLabel(rec)
              const meta  = getRecordMeta(rec)
              const type  = getEntityTypeLabel(rec)
              const isActive = i === activeIdx
              return (
                <li
                  key={recordKey(rec)}
                  role="option"
                  aria-selected={isActive}
                  onMouseDown={() => handlePick(rec)}
                  style={{
                    padding: '8px 12px', cursor: 'pointer',
                    borderBottom: '1px solid var(--ls-border-light, #f3f4f6)',
                    background: isActive ? 'var(--ls-hover-bg, #f0f4ff)' : 'transparent',
                    display: 'flex', flexDirection: 'column', gap: 2,
                  }}
                >
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{label}</span>
                  <span style={{ fontSize: 12, opacity: 0.65, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    {type && (
                      <span style={{
                        background: 'var(--ls-tag-bg, #e8eaf6)',
                        padding: '1px 6px', borderRadius: 4, fontWeight: 500,
                      }}>
                        {type}
                      </span>
                    )}
                    {meta && <span>{meta}</span>}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Hint text */}
      {isLoadingIndiaLocations && stateName && districtName && (
        <p id="ls-location-search-hint" className="ls-note ls-note--info" style={{ marginTop: 4 }}>
          Loading villages and subdistricts for <strong>{districtName}</strong>…
        </p>
      )}

      {!selectedRecord && !showEmptyPool && stateName && districtName && !searchBusy && (
        <p id="ls-location-search-hint" className="ls-note ls-note--info" style={{ marginTop: 4 }}>
          Searching {poolSize} location{poolSize !== 1 ? 's' : ''} in{' '}
          <strong>{districtName}</strong>, {stateName}. Results appear after 2+ characters.
        </p>
      )}

      {showEmptyPool && (
        <StatusNote variant="warn">
          No villages, subdistricts, or local bodies found for <strong>{districtName}</strong> in {stateName}.
        </StatusNote>
      )}

      {/* No search results */}
      {showNoResults && (
        <StatusNote variant="warn">
          No results for "<strong>{query.trim()}</strong>" in {districtName}.
          Try a different spelling or the local body name.
        </StatusNote>
      )}

      {/* Selected record detail chips */}
      {selectedRecord && (
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {selectedRecord.entityName && (
            <span className="ls-note ls-note--info" style={{ margin: 0 }}>
              <strong>{getEntityTypeLabel(selectedRecord)}:</strong> {selectedRecord.entityName}
            </span>
          )}
          {selectedRecord.subdistrictNameEnglish && selectedRecord.entityType === 'Village' && (
            <span className="ls-note ls-note--info" style={{ margin: 0 }}>
              <strong>Subdistrict:</strong> {selectedRecord.subdistrictNameEnglish}
            </span>
          )}
          {selectedRecord.localBodyNameEnglish && (
            <span className="ls-note ls-note--info" style={{ margin: 0 }}>
              <strong>Local Body:</strong> {selectedRecord.localBodyNameEnglish}
            </span>
          )}
          {selectedRecord.localBodyTypeName?.trim() && (
            <span className="ls-note ls-note--info" style={{ margin: 0 }}>
              <strong>Type:</strong> {selectedRecord.localBodyTypeName.trim()}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// ─── LocationSelect (main export) ─────────────────────────────────────────────

type LocationSelectProps = {
  value: LocationValue
  onChange: (next: LocationValue) => void
  data: CountryData[]
  locationRows: LocationRecord[]
  indiaLocationRows: LocationRecord[]
  required?: boolean
  disabled?: boolean
  isLoadingData?: boolean
  isLoadingIndiaLocations?: boolean
}

export function LocationSelect({
  value,
  onChange,
  data,
  locationRows,
  indiaLocationRows,
  required = false,
  disabled = false,
  isLoadingData = false,
  isLoadingIndiaLocations = false,
}: LocationSelectProps) {
  const [selectedRecord, setSelectedRecord] = useState<LocationRecord | null>(null)

  const stateOptions = useMemo(
    () => data.find((c) => c.name === INDIA_NAME)?.states ?? [],
    [data],
  )
  const districtOptions = useMemo(
    () => stateOptions.find((s) => s.name === value.state)?.districts ?? [],
    [stateOptions, value.state],
  )
  const districtNames = useMemo(
    () => districtOptions.map((d) => d.name),
    [districtOptions],
  )

  // Cascade reset when upstream becomes invalid
  useEffect(() => {
    const validState = stateOptions.some((s) => s.name === value.state)
    if (!validState && value.state) {
      onChange({
        country: INDIA_NAME, state: '', district: '',
        entityName: '', entityType: '', subdistrict: '', localBody: '', localBodyType: '',
      })
      setSelectedRecord(null)
      return
    }
    const validDistrict = districtNames.includes(value.district)
    if (!validDistrict && value.district) {
      onChange({
        ...value, district: '',
        entityName: '', entityType: '', subdistrict: '', localBody: '', localBodyType: '',
      })
      setSelectedRecord(null)
    }
  }, [districtNames, onChange, stateOptions, value])

  function handleRecordSelect(record: LocationRecord | null) {
    setSelectedRecord(record)
    if (!record) {
      onChange({
        ...value,
        entityName: '', entityType: '', subdistrict: '', localBody: '', localBodyType: '',
      })
      return
    }
    const entityType =
      record.entityType === 'Subistrict' ? 'Subdistrict' : record.entityType
    onChange({
      country: INDIA_NAME,
      state: value.state,
      district: value.district,
      entityName: record.entityName,
      entityType,
      subdistrict:
        entityType === 'Village' ? (record.subdistrictNameEnglish?.trim() ?? '') : '',
      localBody: record.localBodyNameEnglish,
      localBodyType: record.localBodyTypeName?.trim() ?? '',
    })
  }

  return (
    <fieldset className="ls-fieldset" disabled={disabled}>
      <legend className="ls-legend">
        <span className="ls-legend-icon"></span> Location
      </legend>

      {/* Country — fixed to India */}
      <div className="ls-country-badge">
        <span className="ls-country-flag">🇮🇳</span>
        <span>India</span>
      </div>

      {/* Step 1 — State */}
      <SelectRow
        id="ls-state"
        label="State / Union Territory"
        value={value.state}
        required={required}
        disabled={disabled}
        isLoading={isLoadingData}
        placeholder="— Select a state or union territory —"
        hint={
          !value.state && !isLoadingData && stateOptions.length > 0
            ? `${stateOptions.length} states and union territories available.`
            : undefined
        }
        emptyMessage={
          !isLoadingData && stateOptions.length === 0
            ? 'No states loaded. Please check the dataset file (locations.json).'
            : undefined
        }
        options={stateOptions.map((s) => ({ value: s.name, label: s.name }))}
        onChange={(state) => {
          setSelectedRecord(null)
          onChange({
            country: INDIA_NAME, state, district: '',
            entityName: '', entityType: '', subdistrict: '', localBody: '', localBodyType: '',
          })
        }}
      />

      {/* Step 2 — District */}
      <SelectRow
        id="ls-district"
        label="District"
        value={value.district}
        required={required}
        disabled={disabled || !value.state}
        isLoading={isLoadingData}
        placeholder={
          !value.state
            ? '— Select a state first —'
            : '— Select a district —'
        }
        hint={
          value.state && !value.district && !isLoadingData && districtNames.length > 0
            ? `${districtNames.length} district${districtNames.length !== 1 ? 's' : ''} in ${value.state}.`
            : undefined
        }
        emptyMessage={
          value.state && !isLoadingData && districtNames.length === 0
            ? `No districts found for ${value.state}. The dataset may be incomplete.`
            : undefined
        }
        options={districtNames.map((d) => ({ value: d, label: d }))}
        onChange={(district) => {
          setSelectedRecord(null)
          onChange({
            country: INDIA_NAME, state: value.state, district,
            entityName: '', entityType: '', subdistrict: '', localBody: '', localBodyType: '',
          })
        }}
      />

      <LocationSearchRow
        stateName={value.state}
        districtName={value.district}
        locationRows={locationRows}
        indiaLocationRows={indiaLocationRows}
        selectedRecord={selectedRecord}
        disabled={disabled}
        required={required}
        isLoadingData={isLoadingData}
        isLoadingIndiaLocations={isLoadingIndiaLocations}
        onSelect={handleRecordSelect}
      />
    </fieldset>
  )
}