// Stub for the `server-only` package under Vitest.
//
// The real module throws on import to stop server code reaching a client
// bundle. That guard is correct in the app and useless in a test process,
// where it only prevents server modules from being tested at all.
// Aliased in vitest.config.ts.
export {}
