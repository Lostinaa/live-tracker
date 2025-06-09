'use client'

import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Polyline, Marker } from 'react-leaflet'
import { LatLngTuple } from 'leaflet'
import { getDistance } from 'geolib'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Fix for default marker icons
const DefaultIcon = L.icon({
  iconUrl: '/images/marker-icon.svg',
  shadowUrl: '/images/marker-shadow.svg',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
})

L.Marker.prototype.options.icon = DefaultIcon

// Validating  coordinates and check
const isValidCoordinate = (lat: number, lng: number): boolean => {
  return (
    lat >= -90 && lat <= 90 && // Valid latitude range
    lng >= -180 && lng <= 180 && // Valid longitude range
    !isNaN(lat) && !isNaN(lng) && // Not NaN
    isFinite(lat) && isFinite(lng) // Not Infinity
  )
}

export default function RunnerTracker() {
  const [positions, setPositions] = useState<LatLngTuple[]>([])
  const [startTime, setStartTime] = useState<Date | null>(null)
  const [distance, setDistance] = useState<number>(0)
  const [isTracking, setIsTracking] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [initialPosition, setInitialPosition] = useState<LatLngTuple | null>(null)
  const [accuracy, setAccuracy] = useState<number | null>(null)

  useEffect(() => {
    if (!navigator.geolocation) {
      setError("Geolocation is not supported by your browser")
      return
    }
  }, [])

  const getCurrentPosition = (): Promise<GeolocationPosition> => {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        resolve,
        reject,
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 30000
        }
      )
    })
  }

  const startTracking = async () => {
    if (!navigator.geolocation) return

    setIsLoading(true)
    setError(null)

    try {
      // Try to get initial position within  ---  high accuracy
      let position: GeolocationPosition
      try {
        position = await getCurrentPosition()
      } catch {
        //  first attempt fails n tryyy
        try {
          position = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              maximumAge: 0,
              timeout: 30000
            })
          })
        } catch (retryErr) {
          throw retryErr
        }
      }

      const { latitude, longitude, accuracy: posAccuracy } = position.coords
      
      // Validate coordinates
      if (!isValidCoordinate(latitude, longitude)) {
        throw new Error('Invalid coordinates received')
      }

      // Check accuracy
      if (posAccuracy > 100) { 
        // If accuracy is worse <100 meters
        setError(`Warning: GPS accuracy is low (${Math.round(posAccuracy)}m). Try moving to an open area.`)
      }

      setAccuracy(posAccuracy)
      const initialPos: LatLngTuple = [latitude, longitude]
      setInitialPosition(initialPos)
      setIsLoading(false)
      setIsTracking(true)
      setStartTime(new Date())
      setPositions([initialPos])
      setDistance(0)

      // Start continuous tracking with high accuracy (main challenge) 
      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const { latitude, longitude, accuracy: newAccuracy } = pos.coords
          
          // Validate new coordinates
          if (!isValidCoordinate(latitude, longitude)) {
            console.warn('Invalid coordinates received, skipping update')
            return
          }

          setAccuracy(newAccuracy)
          const newPos: LatLngTuple = [latitude, longitude]

          setPositions((prev) => {
            if (prev.length > 0) {
              const last = prev[prev.length - 1]
              const dist = getDistance(
                { latitude: last[0], longitude: last[1] },
                { latitude, longitude }
              )
              setDistance((d) => d + dist)
            }
            return [...prev, newPos]
          })
        },
        (err) => {
          let errorMessage = 'Error getting location: '
          switch (err.code) {
            case err.PERMISSION_DENIED:
              errorMessage += 'Location permission denied'
              break
            case err.POSITION_UNAVAILABLE:
              errorMessage += 'Location information unavailable'
              break
            case err.TIMEOUT:
              errorMessage += 'Location request timed out'
              break
            default:
              errorMessage += err.message
          }
          setError(errorMessage)
          setIsTracking(false)
          setIsLoading(false)
        },
        { 
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 30000
        }
      )

      return () => navigator.geolocation.clearWatch(watchId)
    } catch (err) {
      let errorMessage = 'Error getting initial location: '
      if (err instanceof GeolocationPositionError) {
        switch (err.code) {
          case err.PERMISSION_DENIED:
            errorMessage += 'Location permission denied'
            break
          case err.POSITION_UNAVAILABLE:
            errorMessage += 'Location information unavailable'
            break
          case err.TIMEOUT:
            errorMessage += 'Location request timed out'
            break
          default:
            errorMessage += err.message
        }
      } else {
        errorMessage += err instanceof Error ? err.message : 'Unknown error'
      }
      setError(errorMessage)
      setIsLoading(false)
    }
  }

  const stopTracking = () => {
    setIsTracking(false)
  }

  const elapsed = startTime
    ? Math.floor((new Date().getTime() - startTime.getTime()) / 1000)
    : 0

  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = seconds % 60
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className="h-screen flex flex-col">
      <div className="p-4 bg-white shadow-md">
        <h2 className="text-2xl font-bold text-center mb-2">🏃‍♂️ Live Runner Tracker</h2>
        <div className="flex justify-center gap-4 mb-2">
          <button
            onClick={isTracking ? stopTracking : startTracking}
            disabled={isLoading}
            className={`px-4 py-2 rounded ${
              isTracking 
                ? 'bg-red-500 hover:bg-red-600' 
                : 'bg-green-500 hover:bg-green-600'
            } text-white disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {isLoading ? 'Getting Location...' : isTracking ? 'Stop Tracking' : 'Start Tracking'}
          </button>
        </div>
        <div className="text-center">
          <p className="text-lg">
            Distance: {(distance / 1000).toFixed(2)} km | Time: {formatTime(elapsed)}
          </p>
          {accuracy && (
            <p className="text-sm text-gray-600">
              GPS Accuracy: {Math.round(accuracy)}m
            </p>
          )}
          {error && (
            <div className="mt-2">
              <p className="text-red-500">{error}</p>
              <p className="text-sm text-gray-600 mt-1">
                Tips: Make sure you&apos;re outdoors or near a window, and your device&apos;s GPS is enabled.
              </p>
            </div>
          )}
        </div>
      </div>
      
      <div className="flex-1">
        <MapContainer
          center={positions[positions.length - 1] || initialPosition || [0, 0]}
          zoom={18}
          className="h-full w-full"
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {positions.length > 0 && (
            <>
              <Marker position={positions[positions.length - 1]} />
              <Polyline positions={positions} color="blue" />
            </>
          )}
        </MapContainer>
      </div>
    </div>
  )
} 