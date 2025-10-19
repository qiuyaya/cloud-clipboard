/**
 * Get the correct API path considering BASE_PATH for subpath deployment
 * @param path - API path starting with /api/
 * @returns Full API path with base path prefix if needed
 */
export function getApiPath(path: string): string {
  const basePath = import.meta.env.BASE_URL || "/";

  // If base path is root or undefined/null, return as is
  if (basePath === "/" || !basePath || basePath === "undefined") {
    return path;
  }

  // Remove trailing slash from base path
  const normalizedBase = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;

  // Ensure path starts with /
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  return `${normalizedBase}${normalizedPath}`;
}
