type RuntimeConfig = typeof globalThis & { __UCAFE_API_URL__?: string };

// In production, serve the SPA and API behind one HTTPS origin and proxy /api
// to the Node service. A deploy may override this before the Angular bundle loads.
export const API_URL = (globalThis as RuntimeConfig).__UCAFE_API_URL__ ?? '/api';
