// Library entry — the composable pieces the modular monolith mounts. (The
// server bootstrap is src/index.ts; this exposes routes/deps without starting
// a server.)
export { registerAuthRoutes, type AuthRoutesDeps, type Directory } from './routes.js';
export { staticDirectory } from './directory.js';
