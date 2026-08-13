/**
 * Where the two endpoints live, relative to wherever the router is mounted.
 *
 * Its own module, and part of the ISOMORPHIC entry, because both halves need it
 * and neither may spell it itself: the browser posts to `upload`, the local driver
 * builds display URLs from `serve`, and a host composes its driver's
 * `publicPathPrefix` as `<mount base> + STORAGE_PATHS.serve`. A string retyped in
 * three places is three chances to have written objects at one path and served
 * them from another.
 */
export const STORAGE_PATHS = {
  upload: '/uploads/image',
  serve: '/uploads/local',
} as const;
