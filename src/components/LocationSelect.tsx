import { useEffect, useMemo } from 'react'

type StateData = {
  name: string
  code: string
  districts: string[]
}

type CountryData = {
  name: string
  code: string
  states: StateData[]
}

export type LocationValue = {
  country: string
  state: string
  district: string
}

type LocationSelectProps = {
  value: LocationValue
  onChange: (nextValue: LocationValue) => void
  data: CountryData[]
  required?: boolean
  disabled?: boolean
}

const INDIA_NAME = 'India'

export function LocationSelect({
  value,
  onChange,
  data,
  required = false,
  disabled = false,
}: LocationSelectProps) {
  const india = useMemo(
    () => data.find((country) => country.name === INDIA_NAME),
    [data],
  )

  const stateOptions = india?.states ?? []

  const districtOptions = useMemo(() => {
    return stateOptions.find((state) => state.name === value.state)?.districts ?? []
  }, [stateOptions, value.state])

  useEffect(() => {
    if (value.country !== INDIA_NAME) {
      onChange({
        country: INDIA_NAME,
        state: '',
        district: '',
      })
    }
  }, [onChange, value.country])

  useEffect(() => {
    const validState = stateOptions.some((state) => state.name === value.state)
    if (!validState && value.state) {
      onChange({
        country: INDIA_NAME,
        state: '',
        district: '',
      })
      return
    }

    const validDistrict = districtOptions.includes(value.district)
    if (!validDistrict && value.district) {
      onChange({
        country: INDIA_NAME,
        state: value.state,
        district: '',
      })
    }
  }, [districtOptions, onChange, stateOptions, value.district, value.state])

  const isStateDisabled = disabled || stateOptions.length === 0
  const isDistrictDisabled = disabled || !value.state

  return (
    <fieldset className="location-fieldset" disabled={disabled}>
      <legend>Location</legend>
      <p className="country-display">
        <span className="label-text">Country:</span> {INDIA_NAME}
      </p>

      <div className="form-row">
        <label htmlFor="state">State</label>
        <select
          id="state"
          name="state"
          value={value.state}
          required={required}
          disabled={isStateDisabled}
          onChange={(event) => {
            onChange({
              country: INDIA_NAME,
              state: event.target.value,
              district: '',
            })
          }}
        >
          <option value="">Select state</option>
          {stateOptions.map((state) => (
            <option key={state.code} value={state.name}>
              {state.name}
            </option>
          ))}
        </select>
      </div>

      <div className="form-row">
        <label htmlFor="district">District</label>
        <select
          id="district"
          name="district"
          value={value.district}
          required={required}
          disabled={isDistrictDisabled}
          onChange={(event) => {
            onChange({
              country: INDIA_NAME,
              state: value.state,
              district: event.target.value,
            })
          }}
        >
          <option value="">Select district</option>
          {districtOptions.map((district) => (
            <option key={district} value={district}>
              {district}
            </option>
          ))}
        </select>
      </div>
    </fieldset>
  )
}
