export interface MockPrediction {
  place_id: string;
  description: string;
  structured_formatting: {
    main_text: string;
    secondary_text: string;
  };
  matched_substrings?: google.maps.places.PredictionSubstring[];
  terms?: google.maps.places.PredictionTerm[];
  types?: string[];
}

// Canned Places data so the component renders and is testable without a Google
// Maps key.
export const MOCK_ADDRESSES: MockPrediction[] = [
  {
    place_id: 'mock_1',
    description: '123 Main Street, San Francisco, CA 94105, USA',
    structured_formatting: {
      main_text: '123 Main Street',
      secondary_text: 'San Francisco, CA 94105, USA',
    },
    matched_substrings: [],
    terms: [],
    types: ['street_address'],
  },
  {
    place_id: 'mock_2',
    description: '456 Oak Avenue, New York, NY 10001, USA',
    structured_formatting: {
      main_text: '456 Oak Avenue',
      secondary_text: 'New York, NY 10001, USA',
    },
    matched_substrings: [],
    terms: [],
    types: ['street_address'],
  },
  {
    place_id: 'mock_3',
    description: '789 Pine Boulevard, Los Angeles, CA 90001, USA',
    structured_formatting: {
      main_text: '789 Pine Boulevard',
      secondary_text: 'Los Angeles, CA 90001, USA',
    },
    matched_substrings: [],
    terms: [],
    types: ['street_address'],
  },
  {
    place_id: 'mock_4',
    description: '321 Elm Street, Chicago, IL 60601, USA',
    structured_formatting: {
      main_text: '321 Elm Street',
      secondary_text: 'Chicago, IL 60601, USA',
    },
    matched_substrings: [],
    terms: [],
    types: ['street_address'],
  },
  {
    place_id: 'mock_5',
    description: '654 Maple Drive, Austin, TX 78701, USA',
    structured_formatting: {
      main_text: '654 Maple Drive',
      secondary_text: 'Austin, TX 78701, USA',
    },
    matched_substrings: [],
    terms: [],
    types: ['street_address'],
  },
];

export interface MockPlaceDetails {
  formatted_address: string;
  address_components: Array<{
    long_name: string;
    types: string[];
  }>;
  geometry: {
    location: {
      lat: () => number;
      lng: () => number;
    };
  };
}

export const MOCK_PLACE_DETAILS: Record<string, MockPlaceDetails> = {
  mock_1: {
    formatted_address: '123 Main Street, San Francisco, CA 94105, USA',
    address_components: [
      { long_name: '123', types: ['street_number'] },
      { long_name: 'Main Street', types: ['route'] },
      { long_name: 'San Francisco', types: ['locality'] },
      { long_name: 'California', types: ['administrative_area_level_1'] },
      { long_name: 'United States', types: ['country'] },
      { long_name: '94105', types: ['postal_code'] },
    ],
    geometry: { location: { lat: () => 37.7749, lng: () => -122.4194 } },
  },
  mock_2: {
    formatted_address: '456 Oak Avenue, New York, NY 10001, USA',
    address_components: [
      { long_name: '456', types: ['street_number'] },
      { long_name: 'Oak Avenue', types: ['route'] },
      { long_name: 'New York', types: ['locality'] },
      { long_name: 'New York', types: ['administrative_area_level_1'] },
      { long_name: 'United States', types: ['country'] },
      { long_name: '10001', types: ['postal_code'] },
    ],
    geometry: { location: { lat: () => 40.7128, lng: () => -74.0060 } },
  },
  mock_3: {
    formatted_address: '789 Pine Boulevard, Los Angeles, CA 90001, USA',
    address_components: [
      { long_name: '789', types: ['street_number'] },
      { long_name: 'Pine Boulevard', types: ['route'] },
      { long_name: 'Los Angeles', types: ['locality'] },
      { long_name: 'California', types: ['administrative_area_level_1'] },
      { long_name: 'United States', types: ['country'] },
      { long_name: '90001', types: ['postal_code'] },
    ],
    geometry: { location: { lat: () => 34.0522, lng: () => -118.2437 } },
  },
  mock_4: {
    formatted_address: '321 Elm Street, Chicago, IL 60601, USA',
    address_components: [
      { long_name: '321', types: ['street_number'] },
      { long_name: 'Elm Street', types: ['route'] },
      { long_name: 'Chicago', types: ['locality'] },
      { long_name: 'Illinois', types: ['administrative_area_level_1'] },
      { long_name: 'United States', types: ['country'] },
      { long_name: '60601', types: ['postal_code'] },
    ],
    geometry: { location: { lat: () => 41.8781, lng: () => -87.6298 } },
  },
  mock_5: {
    formatted_address: '654 Maple Drive, Austin, TX 78701, USA',
    address_components: [
      { long_name: '654', types: ['street_number'] },
      { long_name: 'Maple Drive', types: ['route'] },
      { long_name: 'Austin', types: ['locality'] },
      { long_name: 'Texas', types: ['administrative_area_level_1'] },
      { long_name: 'United States', types: ['country'] },
      { long_name: '78701', types: ['postal_code'] },
    ],
    geometry: { location: { lat: () => 30.2672, lng: () => -97.7431 } },
  },
  mock_6: {
    formatted_address: '1000 Broadway, New York, NY 10001, USA',
    address_components: [
      { long_name: '1000', types: ['street_number'] },
      { long_name: 'Broadway', types: ['route'] },
      { long_name: 'New York', types: ['locality'] },
      { long_name: 'New York', types: ['administrative_area_level_1'] },
      { long_name: 'United States', types: ['country'] },
      { long_name: '10001', types: ['postal_code'] },
    ],
    geometry: { location: { lat: () => 40.7589, lng: () => -73.9851 } },
  },
  mock_7: {
    formatted_address: '250 Market Street, San Francisco, CA 94102, USA',
    address_components: [
      { long_name: '250', types: ['street_number'] },
      { long_name: 'Market Street', types: ['route'] },
      { long_name: 'San Francisco', types: ['locality'] },
      { long_name: 'California', types: ['administrative_area_level_1'] },
      { long_name: 'United States', types: ['country'] },
      { long_name: '94102', types: ['postal_code'] },
    ],
    geometry: { location: { lat: () => 37.7879, lng: () => -122.4075 } },
  },
};

// Every word has to appear somewhere in the address, which is roughly how Google
// treats a multi-word query.
const matchesAllWords = (address: MockPrediction, searchTerm: string): boolean => {
  const description = address.description.toLowerCase();
  const mainText = address.structured_formatting.main_text.toLowerCase();
  const secondaryText = address.structured_formatting.secondary_text?.toLowerCase() || '';

  return searchTerm
    .split(' ')
    .every(
      (word) =>
        description.includes(word) || mainText.includes(word) || secondaryText.includes(word),
    );
};

// Addresses whose street line starts with the query come first; the rest sort
// alphabetically.
const byRelevance =
  (searchTerm: string) =>
  (a: MockPrediction, b: MockPrediction): number => {
    const aMain = a.structured_formatting.main_text.toLowerCase();
    const bMain = b.structured_formatting.main_text.toLowerCase();

    if (aMain.startsWith(searchTerm) && !bMain.startsWith(searchTerm)) return -1;
    if (!aMain.startsWith(searchTerm) && bMain.startsWith(searchTerm)) return 1;
    return aMain.localeCompare(bMain);
  };

export const searchMockAddresses = (input: string): MockPrediction[] => {
  const searchTerm = input.toLowerCase().trim();

  return MOCK_ADDRESSES.filter((address) => matchesAllWords(address, searchTerm)).sort(
    byRelevance(searchTerm),
  );
};
