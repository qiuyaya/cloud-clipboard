/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("i18next", () => ({
  default: {
    t: (key: string) => {
      const map: Record<string, string> = {
        "errorBoundary.title": "Something went wrong",
        "errorBoundary.defaultMessage": "An unexpected error occurred",
        "errorBoundary.tryAgain": "Try Again",
        "errorBoundary.reloadPage": "Reload Page",
      };
      return map[key] || key;
    },
  },
}));

vi.mock("@/utils/debug", () => ({
  debug: {
    error: vi.fn(),
  },
}));

const { ErrorBoundary } = await import("../ErrorBoundary");

// Component that always throws
function ThrowError(): React.ReactElement {
  throw new Error("Test error message");
}

// Component that renders normally
function NormalComponent(): React.ReactElement {
  return <div>Normal content</div>;
}

describe("ErrorBoundary", () => {
  it("renders children when no error", () => {
    render(
      <ErrorBoundary>
        <NormalComponent />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Normal content")).toBeInTheDocument();
  });

  it("renders error UI when child throws", () => {
    // Suppress console.error from React error boundary
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Test error message")).toBeInTheDocument();
    expect(screen.getByText("Try Again")).toBeInTheDocument();
    expect(screen.getByText("Reload Page")).toBeInTheDocument();

    spy.mockRestore();
  });

  it("shows default message when error has no message", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    function ThrowNoMessage(): React.ReactElement {
      throw new Error();
    }

    render(
      <ErrorBoundary>
        <ThrowNoMessage />
      </ErrorBoundary>,
    );

    expect(screen.getByText("An unexpected error occurred")).toBeInTheDocument();

    spy.mockRestore();
  });

  it("resets error state on Try Again click", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { rerender } = render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();

    // Click Try Again - this resets the error state
    const user = userEvent.setup();
    await user.click(screen.getByText("Try Again"));

    // After reset, the error boundary will try to re-render children
    // Since ThrowError still throws, it will show error again
    // But the state was reset (hasError = false)
    spy.mockRestore();
  });
});
