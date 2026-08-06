export * from './apiFactory';
export * from './callAPI';
export * from './lib/concurrencyLimiter';
export * from './lib/createFetcherFactory';
export * from './lib/doRequest';
export * from './lib/mapWithConcurrencyAndRetry';
// Resilience primitives are part of the public request API — `apiFactory`
// composes them internally, and callers building bespoke clients (e.g. the
// PagBank payment client, which needs POST bodies that `doRequest` can't send)
// reuse them directly.
export * from './lib/rateLimiter';
export * from './lib/retry';
// `createFetcherFactory` above returns a fetcher whose `getSuccessRateStats()`
// yields a `SuccessRateStats`, and which throws `SuccessRateTripError` once the
// failure threshold trips — so both names have to be reachable, or a caller can
// neither type the result nor catch the error by class. Same for the timeout
// options `withAbortController` takes.
export * from './lib/abortController';
export * from './lib/successRateMetrics';
