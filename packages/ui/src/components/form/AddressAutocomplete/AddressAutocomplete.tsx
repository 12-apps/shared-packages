import LocationIcon from '@mui/icons-material/LocationOn';
import CurrentLocationIcon from '@mui/icons-material/MyLocation';
import {
  Alert,
  alpha,
  Autocomplete,
  Box,
  CircularProgress,
  IconButton,
  InputAdornment,
  Paper,
  styled,
  TextField,
  useTheme,
} from '@mui/material';
import type { FC} from 'react';
import React, { useCallback,useEffect, useRef, useState } from 'react';

import type { MockPrediction } from './mockPlaces';
import { MOCK_ADDRESSES, MOCK_PLACE_DETAILS } from './mockPlaces';
import { useGoogleMapsAPI } from './useGoogleMapsAPI';
import type { AddressAutocompleteProps,AddressDetails } from './AddressAutocomplete.types';

// Mock data for testing when API key is not available or in test environment


const GlassTextField = styled(TextField)(({ theme }) => ({
  '& .MuiOutlinedInput-root': {
    background: `linear-gradient(135deg, ${alpha(theme.palette.background.paper, 0.8)} 0%, ${alpha(theme.palette.background.paper, 0.6)} 100%)`,
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    border: `1px solid ${alpha(theme.palette.divider, 0.18)}`,
    transition: theme.transitions.create(['border-color', 'box-shadow', 'background']),
    '&:hover': {
      background: `linear-gradient(135deg, ${alpha(theme.palette.background.paper, 0.9)} 0%, ${alpha(theme.palette.background.paper, 0.7)} 100%)`,
      borderColor: theme.palette.primary.main,
    },
    '&.Mui-focused': {
      background: theme.palette.background.paper,
      boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.25)}`,
    },
    '& fieldset': {
      border: 'none',
    },
  },
}));

const SuggestionItem = styled(Box)(({ theme }) => ({
  padding: theme.spacing(1.5),
  display: 'flex',
  alignItems: 'flex-start',
  gap: theme.spacing(1.5),
  cursor: 'pointer',
  transition: theme.transitions.create(['background-color']),
  '&:hover': {
    backgroundColor: alpha(theme.palette.primary.main, 0.08),
  },
}));

const LocationIconWrapper = styled(Box)(({ theme }) => ({
  marginTop: theme.spacing(0.5),
  color: theme.palette.text.secondary,
}));

const AddressText = styled(Box)(({ theme }) => ({
  flex: 1,
  '& .primary': {
    fontSize: '0.9rem',
    fontWeight: 500,
    color: theme.palette.text.primary,
    marginBottom: theme.spacing(0.25),
  },
  '& .secondary': {
    fontSize: '0.8rem',
    color: theme.palette.text.secondary,
  },
}));

// Google Maps API service interface  


// Hook for Google Maps API initialization
export const AddressAutocomplete: FC<AddressAutocompleteProps> = ({
  variant = 'outlined',
  label = 'Address',
  placeholder = 'Enter an address',
  icon = <LocationIcon />,
  onSelect,
  googleMapsApiKey,
  floating = false,
  restrictions,
  error = false,
  helperText,
  disabled = false,
  required = false,
  fullWidth = true,
  defaultValue = '',
  getCurrentLocation = false,
}) => {
  const theme = useTheme();
  const [inputValue, setInputValue] = useState(defaultValue);
  const [options, setOptions] = useState<(string | google.maps.places.AutocompletePrediction | MockPrediction)[]>([]);
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const debounceTimeoutRef = useRef<number | undefined>(undefined);
  
  const { isLoaded, error: mapsError, services, useMockData } = useGoogleMapsAPI(googleMapsApiKey);

  // Debounced autocomplete function

  const debouncedAutocomplete = useCallback(
    (input: string) => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }

      debounceTimeoutRef.current = window.setTimeout(() => {
        if (!input.trim() || !isLoaded) {
          setOptions([]);
          setLoading(false);
          return;
        }

        // Use mock data if API is not available
        if (useMockData) {
          // Simulate realistic but fast API delay for testing
          setTimeout(() => {
            setLoading(false);
            const searchTerm = input.toLowerCase().trim();

            // More sophisticated search logic that matches Google Maps behavior
            const filtered = MOCK_ADDRESSES.filter(addr => {
              const description = addr.description.toLowerCase();
              const mainText = addr.structured_formatting.main_text.toLowerCase();
              const secondaryText = addr.structured_formatting.secondary_text?.toLowerCase() || '';

              // Match against street number, street name, city, or state
              const searchWords = searchTerm.split(' ');
              return searchWords.every(word =>
                description.includes(word) ||
                mainText.includes(word) ||
                secondaryText.includes(word)
              );
            });

            // Sort by relevance (exact matches first, then partial matches)
            const sorted = filtered.sort((a, b) => {
              const aMain = a.structured_formatting.main_text.toLowerCase();
              const bMain = b.structured_formatting.main_text.toLowerCase();

              if (aMain.startsWith(searchTerm) && !bMain.startsWith(searchTerm)) return -1;
              if (!aMain.startsWith(searchTerm) && bMain.startsWith(searchTerm)) return 1;
              return aMain.localeCompare(bMain);
            });

            setOptions(sorted.length > 0 ? sorted : []);
            setApiError(null);
          }, 100); // Optimized for testing while still realistic
          return;
        }

        if (!services.autocompleteService) {
          setOptions([]);
          setLoading(false);
          return;
        }

        const request: google.maps.places.AutocompletionRequest = {
          input: input.trim(),
          componentRestrictions: restrictions?.country ? { country: restrictions.country } : undefined,
          types: restrictions?.types || [],
        };

        services.autocompleteService.getPlacePredictions(
          request,
          (predictions, status) => {
            setLoading(false);
          
            if (status === google.maps.places.PlacesServiceStatus.OK && predictions) {
              setOptions(predictions);
              setApiError(null);
            } else if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
              setOptions([]);
              setApiError(null);
            } else {
              setOptions([]);
              setApiError('Failed to fetch address suggestions');
            }
          },
        );
      }, 300);
    },
    [services, isLoaded, restrictions, useMockData],
  );

  const handleInputChange = (event: React.SyntheticEvent, value: string) => {
    setInputValue(value);
    setApiError(null);

    if (value.length > 2) {
      setLoading(true);
      debouncedAutocomplete(value);
    } else {
      setOptions([]);
      setLoading(false);
    }
  };

  const handleSelect = useCallback(
    (event: React.SyntheticEvent, value: string | google.maps.places.AutocompletePrediction | MockPrediction | null) => {
      // Handle string values (freeSolo mode)
      if (typeof value === 'string') {
        const addressDetails: AddressDetails = {
          formatted: value,
          street: '',
          city: '',
          state: '',
          country: '',
          postalCode: '',
          coordinates: { lat: 0, lng: 0 },
        };
        onSelect(addressDetails);
        return;
      }

      if (!value) return;

      setLoading(true);

      // Use mock data if API is not available
      if (useMockData && 'place_id' in value) {
        setTimeout(() => {
          setLoading(false);
          const place = MOCK_PLACE_DETAILS[value.place_id];
          if (place) {
            const addressComponents = place.address_components || [];

            const getComponent = (type: string) => {
              const component = addressComponents.find((c) => c.types.includes(type));
              return component?.long_name || '';
            };

            const street = `${getComponent('street_number')} ${getComponent('route')}`.trim();

            const addressDetails: AddressDetails = {
              formatted: place.formatted_address || value.description,
              street: street || getComponent('route'),
              city: getComponent('locality') || getComponent('administrative_area_level_2'),
              state: getComponent('administrative_area_level_1'),
              country: getComponent('country'),
              postalCode: getComponent('postal_code'),
              coordinates: {
                lat: place.geometry?.location?.lat() || 0,
                lng: place.geometry?.location?.lng() || 0,
              },
            };

            onSelect(addressDetails);
            setInputValue(addressDetails.formatted);
          } else {
            setApiError('Address details not found');
          }
        }, 50); // Optimized for testing
        return;
      }

      if (!services.placesService) {
        setLoading(false);
        return;
      }

      // Get place details from real API
      const request: google.maps.places.PlaceDetailsRequest = {
        placeId: value.place_id,
        fields: ['formatted_address', 'address_components', 'geometry'],
      };

      services.placesService.getDetails(request, (place, status) => {
        setLoading(false);
      
        if (status === google.maps.places.PlacesServiceStatus.OK && place) {
          const addressComponents = place.address_components || [];
        
          const getComponent = (type: string) => {
            const component = addressComponents.find(c => c.types.includes(type));
            return component?.long_name || '';
          };

          const street = `${getComponent('street_number')} ${getComponent('route')}`.trim();

          const addressDetails: AddressDetails = {
            formatted: place.formatted_address || value.description,
            street: street || getComponent('route'),
            city: getComponent('locality') || getComponent('administrative_area_level_2'),
            state: getComponent('administrative_area_level_1'),
            country: getComponent('country'),
            postalCode: getComponent('postal_code'),
            coordinates: {
              lat: place.geometry?.location?.lat() || 0,
              lng: place.geometry?.location?.lng() || 0,
            },
          };

          onSelect(addressDetails);
          setInputValue(addressDetails.formatted);
        } else {
          setApiError('Failed to get address details');
        }
      });
    },
    [services, onSelect, useMockData],
  );

  const handleGetCurrentLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setApiError('Geolocation is not supported by this browser');
      return;
    }

    // Use mock location if in mock mode
    if (useMockData) {
      setLoading(true);
      setTimeout(() => {
        setLoading(false);
        const mockLocation = MOCK_ADDRESSES[0];
        if (!mockLocation) {
          setApiError('No mock location available');
          return;
        }
        const mockDetails = MOCK_PLACE_DETAILS[mockLocation.place_id];
        if (!mockDetails) {
          setApiError('Mock location details not found');
          return;
        }
      
        const addressComponents = mockDetails.address_components || [];
        const getComponent = (type: string) => {
          const component = addressComponents.find((c) => c.types.includes(type));
          return component?.long_name || '';
        };

        const street = `${getComponent('street_number')} ${getComponent('route')}`.trim();

        const addressDetails: AddressDetails = {
          formatted: mockDetails.formatted_address,
          street: street || getComponent('route'),
          city: getComponent('locality') || getComponent('administrative_area_level_2'),
          state: getComponent('administrative_area_level_1'),
          country: getComponent('country'),
          postalCode: getComponent('postal_code'),
          coordinates: { 
            lat: mockDetails.geometry.location.lat(), 
            lng: mockDetails.geometry.location.lng() 
          },
        };

        onSelect(addressDetails);
        setInputValue(addressDetails.formatted);
      }, 500); // Simulate geolocation delay
      return;
    }

    if (!services.geocoder) {
      setApiError('Geocoding service not available');
      return;
    }

    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        const latLng = new google.maps.LatLng(latitude, longitude);

        services.geocoder!.geocode({ location: latLng }, (results, status) => {
          setLoading(false);
        
          if (status === 'OK' && results && results[0]) {
            const place = results[0];
            const addressComponents = place.address_components || [];
          
            const getComponent = (type: string) => {
              const component = addressComponents.find(c => c.types.includes(type));
              return component?.long_name || '';
            };

            const street = `${getComponent('street_number')} ${getComponent('route')}`.trim();

            const addressDetails: AddressDetails = {
              formatted: place.formatted_address,
              street: street || getComponent('route'),
              city: getComponent('locality') || getComponent('administrative_area_level_2'),
              state: getComponent('administrative_area_level_1'),
              country: getComponent('country'),
              postalCode: getComponent('postal_code'),
              coordinates: { lat: latitude, lng: longitude },
            };

            onSelect(addressDetails);
            setInputValue(addressDetails.formatted);
          } else {
            setApiError('Unable to retrieve address for current location');
          }
        });
      },
      () => {
        setLoading(false);
        setApiError('Unable to retrieve your location');
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 600000, // 10 minutes
      }
    );
  }, [services, onSelect, useMockData]);

  // Cleanup debounce on unmount
  useEffect(() => () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    }, []);

  const TextFieldComponent = variant === 'glass' ? GlassTextField : TextField;
  const displayError = error || !!mapsError || !!apiError;
  const displayHelperText = apiError || mapsError || helperText;

  // Show loading state if API is not ready
  if (!isLoaded && !mapsError) {
    return (
      <TextFieldComponent
        variant={variant === 'glass' ? 'outlined' : variant}
        label={floating ? undefined : label}
        placeholder="Loading Google Maps..."
        disabled
        fullWidth={fullWidth}
        InputProps={{
          startAdornment: icon && <InputAdornment position="start">{icon}</InputAdornment>,
          endAdornment: <CircularProgress color="inherit" size={20} />,
        }}
      />
    );
  }

  // Show error state if Google Maps failed to load
  if (mapsError) {
    return (
      <Box>
        <TextFieldComponent
          variant={variant === 'glass' ? 'outlined' : variant}
          label={floating ? undefined : label}
          placeholder={placeholder}
          error
          disabled
          fullWidth={fullWidth}
          helperText={mapsError}
          InputProps={{
            startAdornment: icon && <InputAdornment position="start">{icon}</InputAdornment>,
          }}
        />
        <Alert severity="error" sx={{ mt: 1 }}>
          Google Maps API failed to load. Please check your API key and internet connection.
        </Alert>
      </Box>
    );
  }

  return (
    <Box data-testid="address-autocomplete-container">
      <Autocomplete
        freeSolo
        options={options}
        inputValue={inputValue}
        onInputChange={handleInputChange}
        onChange={handleSelect}
        loading={loading}
        disabled={disabled || !isLoaded}
        fullWidth={fullWidth}
        getOptionLabel={(option) => {
          if (typeof option === 'string') return option;
          return option.description || '';
        }}
        isOptionEqualToValue={(option, value) => {
          if (typeof option === 'string' && typeof value === 'string') {
            return option === value;
          }
          if (typeof option === 'object' && typeof value === 'object' && option && value) {
            return option.place_id === value.place_id;
          }
          return false;
        }}
        renderInput={(params) => (
          <TextFieldComponent
            {...params}
            variant={variant === 'glass' ? 'outlined' : variant}
            label={floating ? undefined : label}
            placeholder={placeholder}
            error={displayError}
            helperText={displayHelperText}
            required={required}
            InputProps={{
              ...params.InputProps,
              startAdornment: icon && <InputAdornment position="start">{icon}</InputAdornment>,
              endAdornment: (
                <>
                  {loading && <CircularProgress color="inherit" size={20} data-testid="address-loading" />}
                  {getCurrentLocation && !loading && isLoaded && (
                    <InputAdornment position="end">
                      <IconButton
                        edge="end"
                        onClick={handleGetCurrentLocation}
                        size="small"
                        title="Use current location"
                        disabled={disabled}
                        data-testid="address-current-location-button"
                      >
                        <CurrentLocationIcon />
                      </IconButton>
                    </InputAdornment>
                  )}
                  {params.InputProps.endAdornment}
                </>
              ),
            }}
            inputProps={{
              ...params.inputProps,
              'data-testid': 'address-input',
            }}
          />
        )}
        renderOption={(props, option, state) => {
          const { key, ...optionProps } = props;

          // Handle string options
          if (typeof option === 'string') {
            return (
              <li key={key} {...optionProps} data-testid={`address-suggestion-${state.index}`}>
                <SuggestionItem>
                  <LocationIconWrapper>
                    <LocationIcon fontSize="small" />
                  </LocationIconWrapper>
                  <AddressText data-testid="address-suggestion-text">
                    <div className="primary">{option.split(',')[0]}</div>
                    <div className="secondary">{option.split(',').slice(1).join(',')}</div>
                  </AddressText>
                </SuggestionItem>
              </li>
            );
          }

          // Handle Google Places AutocompletePrediction or MockPrediction objects
          const prediction = option as google.maps.places.AutocompletePrediction | MockPrediction;
          return (
            <li key={key} {...optionProps} data-testid={`address-suggestion-${state.index}`}>
              <SuggestionItem>
                <LocationIconWrapper>
                  <LocationIcon fontSize="small" />
                </LocationIconWrapper>
                <AddressText data-testid="address-prediction-text">
                  <div className="primary">
                    {prediction.structured_formatting?.main_text || prediction.description?.split(',')[0]}
                  </div>
                  <div className="secondary">
                    {prediction.structured_formatting?.secondary_text ||
                      prediction.description?.split(',').slice(1).join(',')}
                  </div>
                </AddressText>
              </SuggestionItem>
            </li>
          );
        }}
        PaperComponent={(props) => (
          <Paper
            {...props}
            elevation={8}
            data-testid="address-suggestions-dropdown"
            sx={{
              mt: 1,
              background: `linear-gradient(135deg, ${alpha(theme.palette.background.paper, 0.98)} 0%, ${alpha(theme.palette.background.paper, 0.95)} 100%)`,
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              border: `1px solid ${alpha(theme.palette.divider, 0.18)}`,
            }}
          />
        )}
        noOptionsText={inputValue.length <= 2 ? 'Type at least 3 characters' : 'No addresses found'}
      />
      {apiError && (
        <Alert severity="warning" sx={{ mt: 1 }}>
          {apiError}
        </Alert>
      )}
    </Box>
  );
};

// Export default
export default AddressAutocomplete;
