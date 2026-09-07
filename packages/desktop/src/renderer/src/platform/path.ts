/**
 * Renderer capability for path manipulation.
 *
 * Keeping this lookup in one module gives renderer code a narrow, mockable
 * boundary for path operations without importing the preload global directly.
 */
export const getPathBridge = (): Window['path'] => window.path
