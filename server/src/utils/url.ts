import type { Request } from "express";

/**
 * Get the public base URL for generating shareable links.
 * Priority:
 * 1. PUBLIC_URL environment variable (explicit configuration)
 * 2. Request headers (for reverse proxy scenarios with trust proxy enabled)
 *
 * @param req - Express request object
 * @returns The base URL without trailing slash (e.g., "https://example.com")
 */
export function getPublicBaseUrl(req: Request): string {
  // Priority 1: Use PUBLIC_URL environment variable if set
  const publicUrl = process.env.PUBLIC_URL;
  if (publicUrl) {
    // Remove trailing slash if present
    return publicUrl.endsWith("/") ? publicUrl.slice(0, -1) : publicUrl;
  }

  // Priority 2: Build URL from request (with trust proxy enabled, this uses X-Forwarded-* headers)
  const protocol = req.protocol; // With trust proxy, this reads X-Forwarded-Proto
  const host = req.get("host"); // This reads the Host header (set by nginx to $host)

  return `${protocol}://${host}`;
}

/**
 * Generate a public URL for a given path.
 *
 * @param req - Express request object
 * @param path - The path to append (should start with /)
 * @returns Full public URL
 */
export function getPublicUrl(req: Request, path: string): string {
  const baseUrl = getPublicBaseUrl(req);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}
