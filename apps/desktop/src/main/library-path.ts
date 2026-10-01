export type LibraryPath = string | (() => string)
export const resolveLibraryPath = (path: LibraryPath): string =>
  typeof path === 'function' ? path() : path
