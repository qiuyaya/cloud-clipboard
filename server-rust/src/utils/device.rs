/// Detect device type from User-Agent string.
/// Matches Node.js `detectDeviceType` in shared/src/utils.ts.
pub fn detect_device_type(user_agent: &str) -> String {
    let ua = user_agent.to_lowercase();

    // Check tablet first (before mobile) since tablets often contain mobile keywords
    if ua.contains("tablet") || ua.contains("ipad") {
        return "tablet".to_string();
    }

    // Check for Android tablets by model number patterns (SM-T followed by digits)
    if ua.contains("android")
        && let Some(pos) = ua.find("sm-t")
        && ua[pos + 4..].starts_with(|c: char| c.is_ascii_digit())
    {
        return "tablet".to_string();
    }

    // Then check mobile devices
    if ua.contains("mobile")
        || ua.contains("android")
        || ua.contains("iphone")
        || ua.contains("phone")
    {
        return "mobile".to_string();
    }

    // Check desktop/laptop devices
    if ua.contains("desktop")
        || ua.contains("windows")
        || ua.contains("mac")
        || ua.contains("linux")
    {
        return "desktop".to_string();
    }

    "unknown".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_ipad() {
        let ua = "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15";
        assert_eq!(detect_device_type(ua), "tablet");
    }

    #[test]
    fn test_detect_android_tablet() {
        let ua = "Mozilla/5.0 (Linux; Android 13; SM-T870) AppleWebKit/537.36";
        assert_eq!(detect_device_type(ua), "tablet");
    }

    #[test]
    fn test_detect_generic_tablet() {
        let ua = "Mozilla/5.0 (Linux; Android 12; Tablet) AppleWebKit/537.36";
        assert_eq!(detect_device_type(ua), "tablet");
    }

    #[test]
    fn test_detect_iphone() {
        let ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15";
        assert_eq!(detect_device_type(ua), "mobile");
    }

    #[test]
    fn test_detect_android_mobile() {
        let ua = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
        assert_eq!(detect_device_type(ua), "mobile");
    }

    #[test]
    fn test_detect_windows_desktop() {
        let ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
        assert_eq!(detect_device_type(ua), "desktop");
    }

    #[test]
    fn test_detect_mac_desktop() {
        let ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
        assert_eq!(detect_device_type(ua), "desktop");
    }

    #[test]
    fn test_detect_linux_desktop() {
        let ua = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36";
        assert_eq!(detect_device_type(ua), "desktop");
    }

    #[test]
    fn test_detect_unknown() {
        let ua = "SomeBot/1.0";
        assert_eq!(detect_device_type(ua), "unknown");
    }

    #[test]
    fn test_detect_empty() {
        assert_eq!(detect_device_type(""), "unknown");
    }

    #[test]
    fn test_tablet_priority_over_mobile() {
        // iPad UA contains both "iPad" and sometimes "Mobile" - tablet should win
        let ua = "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";
        assert_eq!(detect_device_type(ua), "tablet");
    }
}
