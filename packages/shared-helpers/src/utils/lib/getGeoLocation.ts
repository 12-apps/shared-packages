import { WebServiceClient } from '@maxmind/geoip2-node';

import { logger } from './logger';

type CityResponse = Awaited<ReturnType<WebServiceClient['city']>>;

export type GeoLocation = {
  continent_code: string;
  continent: string;
  country_code: string;
  country: string;
  region_code: string;
  region: string;
  city: string;
  postal_code: string;
  timezone: string;
  longitude: number;
  latitude: number;
  isp_name: string;
  error: string;
}

// Every field on a MaxMind response is optional — a lookup that resolves to a
// country but no city still returns a City object, just a sparse one. These two
// give every absent field the empty value the callers already expect.
const text = (value: string | null | undefined): string => value ?? '';
const num = (value: number | null | undefined): number => value ?? 0;

const placeOf = (response: CityResponse) => ({
  continent_code: text(response.continent?.code),
  continent: text(response.continent?.names.en),
  country_code: text(response.country?.isoCode),
  country: text(response.country?.names.en),
});

// Region lives under the first subdivision, which is absent for the countries
// MaxMind holds no subdivision data for.
const areaOf = (response: CityResponse) => {
  const subdivision = response.subdivisions?.[0];
  return {
    region_code: text(subdivision?.isoCode),
    region: text(subdivision?.names.en),
    city: text(response.city?.names.en),
    postal_code: text(response.postal?.code),
  };
};

const coordinatesOf = (response: CityResponse) => ({
  timezone: text(response.location?.timeZone),
  latitude: num(response.location?.latitude),
  longitude: num(response.location?.longitude),
});

// Call the Maxmind Geo Location API
// Queries to the GeoLite2 web services are capped at 1000 queries/day
// API documentation is at https://dev.maxmind.com/geoip/geolocate-an-ip/web-services
// API Endpoints https://dev.maxmind.com/geoip/docs/web-services/requests#geolite2-endpoints
export async function getGeoLocation (ipAddress: string | unknown) {

  try {
    const accountId = process.env.MAXMIND_ACCOUNT_ID;
    const licenseKey = process.env.MAXMIND_LICENSE_KEY;

    if (!accountId || !licenseKey) {
      logger.warn(`In getGeoLocation, missing config value: accountId: ${accountId}, licenseKey: ${licenseKey}`, ', not getting data');
      return null;
    }

      // To query the GeoLite2 web service, you must set the optional `host` parameter
    const client = new WebServiceClient(accountId, licenseKey, {host: 'geolite.info'});

    // Get the country information
    const response = await client.city(ipAddress as string);

    if (!response) {
      logger.error('In getGeoLocation, No geolocation data received.', response);
      return null;
    }

    const geoLocation: GeoLocation = {
      ...placeOf(response),
      ...areaOf(response),
      ...coordinatesOf(response),
      isp_name: text(response.traits?.autonomousSystemOrganization),
      error: '',
    };
    return geoLocation;

  } catch ( error ) {
    logger.error('In getGeoLocation, error:', error);
    return null;
  }
};
