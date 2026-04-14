import { useState, type FormEvent } from 'react'
import { LocationSelect, type LocationValue } from './components/LocationSelect'
import indiaLocations from './data/indiaLocations.json'
import './App.css'

function App() {
  const [location, setLocation] = useState<LocationValue>({
    country: 'India',
    state: '',
    district: '',
  })
  const [error, setError] = useState('')
  const [submittedLocation, setSubmittedLocation] = useState<LocationValue | null>(null)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (location.country !== 'India' || !location.state || !location.district) {
      setError('Please select state and district to complete the location.')
      return
    }

    setError('')
    setSubmittedLocation(location)
  }

  return (
    <main className="app-shell">
      <h1>React Location Input</h1>
      <form className="location-form" onSubmit={handleSubmit}>
        <LocationSelect
          value={location}
          onChange={(nextLocation) => {
            setLocation(nextLocation)
            if (error) {
              setError('')
            }
          }}
          data={indiaLocations}
          required
        />
        {error ? <p className="error-text">{error}</p> : null}
        <button type="submit">Submit location</button>
      </form>

      {submittedLocation ? (
        <section className="result-card" aria-live="polite">
          <h2>Submitted Location</h2>
          <p>Country: {submittedLocation.country}</p>
          <p>State: {submittedLocation.state}</p>
          <p>District: {submittedLocation.district}</p>
        </section>
      ) : null}
    </main>
  )
}

export default App
