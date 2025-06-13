'use client'

import { useEffect, useState, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { getDistance } from 'geolib'

// Validating coordinates and check
const isValidCoordinate = (lat: number, lng: number): boolean => {
  return (
    lat >= -90 && lat <= 90 && // Valid latitude range
    lng >= -180 && lng <= 180 && // Valid longitude range
    !isNaN(lat) && !isNaN(lng) && // Not NaN
    isFinite(lat) && isFinite(lng) // Not Infinity
  )
}

// Advanced position processing utilities
class PositionProcessor {
  private static readonly MIN_ACCURACY = 10; // meters
  private static readonly MAX_SPEED = 20; // m/s (about 72 km/h)
  private static readonly MIN_DISTANCE = 0.5; // meters
  private static readonly MAX_ACCELERATION = 10; // m/s²
  private static readonly SMOOTHING_FACTOR = 0.3;
  
  private lastValidPosition: GeolocationPosition | null = null;
  private lastUpdateTime: number = 0;
  private lastSpeed: number = 0;
  private positionBuffer: Array<{pos: GeolocationPosition, time: number}> = [];
  private readonly bufferSize = 5;

  // Dead reckoning implementation
  private deadReckoning(currentPos: GeolocationPosition, timeDelta: number): GeolocationPosition {
    if (!this.lastValidPosition) return currentPos;

    const lastCoords = this.lastValidPosition.coords;
    const currentCoords = currentPos.coords;
    
    // Calculate expected position based on last known speed and heading
    const expectedLat = lastCoords.latitude + (this.lastSpeed * Math.cos(lastCoords.heading || 0) * timeDelta);
    const expectedLng = lastCoords.longitude + (this.lastSpeed * Math.sin(lastCoords.heading || 0) * timeDelta);

    // Blend actual and expected positions
    return {
      ...currentPos,
      coords: {
        ...currentCoords,
        latitude: this.blendPositions(currentCoords.latitude, expectedLat),
        longitude: this.blendPositions(currentCoords.longitude, expectedLng)
      }
    };
  }

  private blendPositions(actual: number, expected: number): number {
    return actual * (1 - PositionProcessor.SMOOTHING_FACTOR) + expected * PositionProcessor.SMOOTHING_FACTOR;
  }

  // Signal quality analysis
  analyzeSignalQuality(position: GeolocationPosition): number {
    const { accuracy, speed, heading } = position.coords;
    let qualityScore = 1.0;

    // Reduce quality based on accuracy
    if (accuracy > PositionProcessor.MIN_ACCURACY) {
      qualityScore *= (PositionProcessor.MIN_ACCURACY / accuracy);
    }

    // Check for unrealistic speed changes
    if (this.lastSpeed > 0) {
      const speedChange = Math.abs((speed || 0) - this.lastSpeed);
      if (speedChange > PositionProcessor.MAX_ACCELERATION) {
        qualityScore *= 0.5;
      }
    }

    // Check for unrealistic heading changes
    if (this.lastValidPosition?.coords.heading) {
      const headingChange = Math.abs((heading || 0) - this.lastValidPosition.coords.heading);
      if (headingChange > 45) { // More than 45 degrees change
        qualityScore *= 0.7;
      }
    }

    return qualityScore;
  }

  // Position prediction
  predictNextPosition(): GeolocationPosition | null {
    if (this.positionBuffer.length < 2) return null;

    const lastPos = this.positionBuffer[this.positionBuffer.length - 1];
    const prevPos = this.positionBuffer[this.positionBuffer.length - 2];

    const latDelta = lastPos.pos.coords.latitude - prevPos.pos.coords.latitude;
    const lngDelta = lastPos.pos.coords.longitude - prevPos.pos.coords.longitude;

    return {
      ...lastPos.pos,
      coords: {
        ...lastPos.pos.coords,
        latitude: lastPos.pos.coords.latitude + latDelta,
        longitude: lastPos.pos.coords.longitude + lngDelta
      }
    };
  }

  processPosition(position: GeolocationPosition): GeolocationPosition | null {
    const currentTime = Date.now();
    const timeDelta = this.lastUpdateTime ? (currentTime - this.lastUpdateTime) / 1000 : 0;

    // Add to position buffer
    this.positionBuffer.push({ pos: position, time: currentTime });
    if (this.positionBuffer.length > this.bufferSize) {
      this.positionBuffer.shift();
    }

    // Analyze signal quality
    const qualityScore = this.analyzeSignalQuality(position);
    
    // If quality is too low, use dead reckoning
    if (qualityScore < 0.3) {
      const predictedPos = this.predictNextPosition();
      if (predictedPos) {
        position = this.deadReckoning(predictedPos, timeDelta);
      }
    }

    // Validate position
    if (!this.isValidPosition(position, timeDelta)) {
      return null;
    }

    // Update state
    this.lastValidPosition = position;
    this.lastUpdateTime = currentTime;
    this.lastSpeed = position.coords.speed || 0;

    return position;
  }

  private isValidPosition(position: GeolocationPosition, timeDelta: number): boolean {
    const { accuracy, speed } = position.coords;

    // Check accuracy
    if (accuracy > PositionProcessor.MIN_ACCURACY) {
      return false;
    }

    // Check speed
    if (speed && speed > PositionProcessor.MAX_SPEED) {
      return false;
    }

    // Check distance from last position
    if (this.lastValidPosition) {
      const distance = getDistance(
        { 
          latitude: this.lastValidPosition.coords.latitude, 
          longitude: this.lastValidPosition.coords.longitude 
        },
        { 
          latitude: position.coords.latitude, 
          longitude: position.coords.longitude 
        }
      );

      if (distance < PositionProcessor.MIN_DISTANCE) {
        return false;
      }

      // Check for unrealistic acceleration
      const speedChange = Math.abs((speed || 0) - this.lastSpeed);
      if (speedChange > PositionProcessor.MAX_ACCELERATION * timeDelta) {
        return false;
      }
    }

    return true;
  }
}

export default function RunnerTracker() {
  const [positions, setPositions] = useState<[number, number][]>([])
  const [startTime, setStartTime] = useState<Date | null>(null)
  const [distance, setDistance] = useState<number>(0)
  const [isTracking, setIsTracking] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [initialPosition, setInitialPosition] = useState<[number, number] | null>(null)
  const [accuracy, setAccuracy] = useState<number | null>(null)
  
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const positionProcessor = useRef(new PositionProcessor());
  const [signalQuality, setSignalQuality] = useState<number>(1);
  const [positionSource, setPositionSource] = useState<'gps' | 'dead-reckoning' | 'prediction'>('gps');

  useEffect(() => {
    if (!navigator.geolocation) {
      setError("Geolocation is not supported by your browser")
      return
    }
  }, [])

  useEffect(() => {
    if (!mapContainer.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          'osm-tiles': {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors'
          }
        },
        layers: [
          {
            id: 'osm-tiles',
            type: 'raster',
            source: 'osm-tiles',
            minzoom: 0,
            maxzoom: 19
          }
        ]
      },
      center: initialPosition || [0, 0],
      zoom: 18
    });

    // Wait for the map to load before adding sources and layers
    map.current.on('load', () => {
      if (positions.length > 0) {
        const lastPosition = positions[positions.length - 1];
        
        // Add route source and layer
        map.current?.addSource('route', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: positions
            }
          }
        });

        map.current?.addLayer({
          id: 'route',
          type: 'line',
          source: 'route',
          layout: {
            'line-join': 'round',
            'line-cap': 'round'
          },
          paint: {
            'line-color': '#0080ff',
            'line-width': 4
          }
        });

        // Add current position source and layer
        map.current?.addSource('current-position', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Point',
              coordinates: lastPosition
            }
          }
        });

        map.current?.addLayer({
          id: 'current-position',
          type: 'circle',
          source: 'current-position',
          paint: {
            'circle-radius': 8,
            'circle-color': '#ff0000',
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff'
          }
        });
      }
    });

    return () => {
      map.current?.remove();
    };
  }, [initialPosition]);

  useEffect(() => {
    if (!map.current) return;

    // Update map when positions change
    if (positions.length > 0) {
      const lastPosition = positions[positions.length - 1];
      map.current.flyTo({
        center: lastPosition,
        essential: true
      });

      // Update the route line
      if (map.current.getSource('route')) {
        (map.current.getSource('route') as maplibregl.GeoJSONSource).setData({
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: positions
          }
        });
      }

      // Update the current position marker
      if (map.current.getSource('current-position')) {
        (map.current.getSource('current-position') as maplibregl.GeoJSONSource).setData({
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Point',
            coordinates: lastPosition
          }
        });
      }
    }
  }, [positions]);

  const getCurrentPosition = (): Promise<GeolocationPosition> => {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        resolve,
        reject,
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 5000
        }
      )
    })
  }

  const startTracking = async () => {
    if (!navigator.geolocation) return

    setIsLoading(true)
    setError(null)

    try {
      let position: GeolocationPosition
      try {
        position = await getCurrentPosition()
      } catch {
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
      
      if (!isValidCoordinate(latitude, longitude)) {
        throw new Error('Invalid coordinates received')
      }

      if (posAccuracy > 100) { 
        setError(`Warning: GPS accuracy is low (${Math.round(posAccuracy)}m). Try moving to an open area.`)
      }

      setAccuracy(posAccuracy)
      const initialPos: [number, number] = [longitude, latitude]
      setInitialPosition(initialPos)
      setIsLoading(false)
      setIsTracking(true)
      setStartTime(new Date())
      setPositions([initialPos])
      setDistance(0)

      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const processedPosition = positionProcessor.current.processPosition(pos);
          
          if (!processedPosition) {
            console.warn('Position rejected due to quality checks');
            return;
          }

          const { latitude, longitude } = processedPosition.coords;
          
          setPositions((prev) => {
            if (prev.length > 0) {
              const last = prev[prev.length - 1];
              const dist = getDistance(
                { latitude: last[1], longitude: last[0] },
                { latitude, longitude }
              );
              setDistance(prev => prev + dist);
              return [...prev, [longitude, latitude]];
            }
            return [[longitude, latitude]];
          });

          setPositionSource(processedPosition === pos ? 'gps' : 'dead-reckoning');
          setSignalQuality(positionProcessor.current.analyzeSignalQuality(processedPosition));
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
          timeout: 5000
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
          <p className="text-sm">
            Position Source: {positionSource} | Signal Quality: {(signalQuality * 100).toFixed(0)}%
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
      
      <div className="flex-1" ref={mapContainer} />
    </div>
  )
} 