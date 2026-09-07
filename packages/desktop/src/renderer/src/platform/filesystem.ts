/**
 * Renderer capability for filesystem operations exposed by preload.
 */
export const getFileSystemBridge = (): Window['fileUtils'] => window.fileUtils
