import { detectDeviceType } from "../device";

describe("detectDeviceType", () => {
  const originalUserAgent = navigator.userAgent;

  function setUserAgent(ua: string) {
    Object.defineProperty(navigator, "userAgent", {
      value: ua,
      configurable: true,
    });
  }

  afterEach(() => {
    Object.defineProperty(navigator, "userAgent", {
      value: originalUserAgent,
      configurable: true,
    });
  });

  it("detects mobile from iPhone UA", () => {
    setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");
    expect(detectDeviceType()).toBe("mobile");
  });

  it("detects mobile from Android phone UA", () => {
    setUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile");
    expect(detectDeviceType()).toBe("mobile");
  });

  it("detects tablet from iPad UA", () => {
    setUserAgent("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)");
    expect(detectDeviceType()).toBe("tablet");
  });

  it("detects tablet from Android tablet UA", () => {
    setUserAgent("Mozilla/5.0 (Linux; Android 14; Tablet)");
    expect(detectDeviceType()).toBe("tablet");
  });

  it("detects desktop from Windows UA", () => {
    setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    expect(detectDeviceType()).toBe("desktop");
  });

  it("detects desktop from Mac UA", () => {
    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)");
    expect(detectDeviceType()).toBe("desktop");
  });

  it("detects desktop from Linux UA", () => {
    setUserAgent("Mozilla/5.0 (X11; Linux x86_64)");
    expect(detectDeviceType()).toBe("desktop");
  });

  it("returns unknown for unrecognized UA", () => {
    setUserAgent("SomeRandomBot/1.0");
    expect(detectDeviceType()).toBe("unknown");
  });
});
