import { describe, it, expect } from "vitest";
import { getInitials, stringToHslColor } from "../ui/avatar";

describe("getInitials", () => {
  it("returns ? for empty string", () => {
    expect(getInitials("")).toBe("?");
  });

  it("returns first char for CJK names", () => {
    expect(getInitials("张三")).toBe("张");
    expect(getInitials("李")).toBe("李");
  });

  it("returns initials for multi-word English names", () => {
    expect(getInitials("John Doe")).toBe("JD");
    expect(getInitials("Alice Bob Carol")).toBe("AC");
  });

  it("returns first two chars for single-word names", () => {
    expect(getInitials("John")).toBe("JO");
  });

  it("handles single char name", () => {
    expect(getInitials("A")).toBe("A");
  });

  it("handles mixed CJK and ASCII", () => {
    expect(getInitials("张")).toBe("张");
  });
});

describe("stringToHslColor", () => {
  it("returns an hsl() string", () => {
    const result = stringToHslColor("test", 65, 45);
    expect(result).toMatch(/^hsl\(\d+, 65%, 45%\)$/);
  });

  it("is deterministic — same input yields same output", () => {
    const a = stringToHslColor("user-123", 65, 45);
    const b = stringToHslColor("user-123", 65, 45);
    expect(a).toBe(b);
  });

  it("produces different colors for different inputs", () => {
    const a = stringToHslColor("alice", 65, 45);
    const b = stringToHslColor("bob", 65, 45);
    expect(a).not.toBe(b);
  });

  it("respects custom saturation and lightness", () => {
    const result = stringToHslColor("test", 80, 50);
    expect(result).toContain("80%");
    expect(result).toContain("50%");
  });

  it("handles empty string", () => {
    const result = stringToHslColor("", 65, 45);
    expect(result).toMatch(/^hsl\(\d+, 65%, 45%\)$/);
  });
});
