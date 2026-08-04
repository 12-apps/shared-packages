import { useCallback, useEffect, useRef, useState } from 'react';

import { MOCK_ADDRESSES, MOCK_PLACE_DETAILS } from './mockPlaces';
export interface GoogleMapsService {
  autocompleteService: google.maps.places.AutocompleteService | null;
  placesService: google.maps.places.PlacesService | null;
  geocoder: google.maps.Geocoder | null;
}

export const useGoogleMapsAPI = (apiKey: string) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useMockData, setUseMockData] = useState(false);
  const serviceRef = useRef<GoogleMapsService>({
    autocompleteService: null,
    placesService: null,
    geocoder: null,
  });

  useEffect(() => {
    // Use mock data for demo key or test environment
    if (!apiKey || apiKey === 'demo-key' || apiKey === 'test-key') {
      setUseMockData(true);
      setIsLoaded(true);
      setError(null);
      return;
    }

    // Check if Google Maps is already loaded
    if (window.google && window.google.maps && window.google.maps.places) {
      initializeServices();
      return;
    }

    // Load Google Maps API
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.defer = true;
    
    script.onload = () => {
      initializeServices();
    };
    
    script.onerror = () => {
      setError('Failed to load Google Maps API');
    };

    document.head.appendChild(script);

    return () => {
      // Cleanup script if component unmounts
      if (document.head.contains(script)) {
        document.head.removeChild(script);
      }
    };
  }, [apiKey]);

  const initializeServices = () => {
    try {
      if (window.google && window.google.maps && window.google.maps.places) {
        serviceRef.current = {
          autocompleteService: new window.google.maps.places.AutocompleteService(),
          placesService: new window.google.maps.places.PlacesService(document.createElement('div')),
          geocoder: new window.google.maps.Geocoder(),
        };
        setIsLoaded(true);
        setError(null);
      }
    } catch {
      setError('Failed to initialize Google Maps services');
    }
  };

  return { isLoaded, error, services: serviceRef.current, useMockData };
};

// Main component with proper Google Maps integration
