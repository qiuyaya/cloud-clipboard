export function detectDeviceType(): "mobile" | "desktop" | "tablet" | "unknown" {
  const userAgent = navigator.userAgent.toLowerCase();

  if (/mobile|android|iphone|phone/.test(userAgent)) {
    return "mobile";
  }

  if (/tablet|ipad/.test(userAgent)) {
    return "tablet";
  }

  if (/desktop|windows|mac|linux/.test(userAgent)) {
    return "desktop";
  }

  return "unknown";
}
