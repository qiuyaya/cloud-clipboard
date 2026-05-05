import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConnectionStatus } from "../ConnectionStatus";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "connection.connected": "Connected",
        "connection.disconnected": "Disconnected",
        "connection.connecting": "Connecting",
      };
      return map[key] ?? key;
    },
    i18n: { language: "en" },
  }),
}));

describe("ConnectionStatus", () => {
  it("shows connected text when connected", () => {
    render(<ConnectionStatus isConnected={true} />);
    expect(screen.getAllByText("Connected").length).toBeGreaterThan(0);
  });

  it("shows disconnected text when disconnected", () => {
    render(<ConnectionStatus isConnected={false} />);
    expect(screen.getAllByText("Disconnected").length).toBeGreaterThan(0);
  });

  it("shows connecting text when connecting", () => {
    render(<ConnectionStatus isConnected={false} isConnecting={true} />);
    expect(screen.getAllByText("Connecting").length).toBeGreaterThan(0);
  });

  it("has role=status for accessibility", () => {
    render(<ConnectionStatus isConnected={true} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
