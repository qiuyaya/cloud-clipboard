import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) => {
      if (key === "version.label" && params?.version) {
        return `v${params.version}`;
      }
      return key;
    },
    i18n: { language: "en" },
  }),
}));

// Mock the global __APP_VERSION__ defined by Vite
vi.stubGlobal("__APP_VERSION__", "2.3.2");

const { Version } = await import("../Version");

describe("Version", () => {
  it("renders version text", () => {
    render(<Version />);
    expect(screen.getByText("v2.3.2")).toBeInTheDocument();
  });

  it("has text-xs class", () => {
    const { container } = render(<Version />);
    expect(container.firstChild).toHaveClass("text-xs");
  });
});
