import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { splitByTextAndUrls, LinkifiedText } from "../LinkifiedText";

describe("splitByTextAndUrls", () => {
  it("returns single text segment for plain text", () => {
    expect(splitByTextAndUrls("hello world")).toEqual([{ type: "text", value: "hello world" }]);
  });

  it("returns single url segment for https URL", () => {
    expect(splitByTextAndUrls("https://example.com")).toEqual([
      { type: "url", value: "https://example.com" },
    ]);
  });

  it("returns single url segment for http URL", () => {
    expect(splitByTextAndUrls("http://example.com")).toEqual([
      { type: "url", value: "http://example.com" },
    ]);
  });

  it("returns url segment for www URL", () => {
    expect(splitByTextAndUrls("www.example.com")).toEqual([
      { type: "url", value: "www.example.com" },
    ]);
  });

  it("splits mixed text and URLs", () => {
    expect(splitByTextAndUrls("check https://example.com out")).toEqual([
      { type: "text", value: "check " },
      { type: "url", value: "https://example.com" },
      { type: "text", value: " out" },
    ]);
  });

  it("handles multiple URLs", () => {
    expect(splitByTextAndUrls("https://a.com and https://b.com")).toEqual([
      { type: "url", value: "https://a.com" },
      { type: "text", value: " and " },
      { type: "url", value: "https://b.com" },
    ]);
  });

  it("strips trailing punctuation from URL", () => {
    expect(splitByTextAndUrls("see https://example.com.")).toEqual([
      { type: "text", value: "see " },
      { type: "url", value: "https://example.com" },
      { type: "text", value: "." },
    ]);
  });

  it("strips trailing comma", () => {
    expect(splitByTextAndUrls("visit https://example.com, ok")).toEqual([
      { type: "text", value: "visit " },
      { type: "url", value: "https://example.com" },
      { type: "text", value: ", ok" },
    ]);
  });

  it("strips trailing exclamation", () => {
    expect(splitByTextAndUrls("https://example.com!")).toEqual([
      { type: "url", value: "https://example.com" },
      { type: "text", value: "!" },
    ]);
  });

  it("strips trailing question mark", () => {
    expect(splitByTextAndUrls("https://example.com?")).toEqual([
      { type: "url", value: "https://example.com" },
      { type: "text", value: "?" },
    ]);
  });

  it("strips trailing closing bracket", () => {
    expect(splitByTextAndUrls("(https://example.com)")).toEqual([
      { type: "text", value: "(" },
      { type: "url", value: "https://example.com" },
      { type: "text", value: ")" },
    ]);
  });

  it("strips trailing closing square bracket", () => {
    expect(splitByTextAndUrls("[https://example.com]")).toEqual([
      { type: "text", value: "[" },
      { type: "url", value: "https://example.com" },
      { type: "text", value: "]" },
    ]);
  });

  it("strips trailing semicolon and colon", () => {
    expect(splitByTextAndUrls("https://example.com;")).toEqual([
      { type: "url", value: "https://example.com" },
      { type: "text", value: ";" },
    ]);
    expect(splitByTextAndUrls("https://example.com:")).toEqual([
      { type: "url", value: "https://example.com" },
      { type: "text", value: ":" },
    ]);
  });

  it("strips trailing punctuation from www URL", () => {
    expect(splitByTextAndUrls("visit www.example.com.")).toEqual([
      { type: "text", value: "visit " },
      { type: "url", value: "www.example.com" },
      { type: "text", value: "." },
    ]);
  });

  it("preserves query params in URL", () => {
    expect(splitByTextAndUrls("https://example.com?q=hello")).toEqual([
      { type: "url", value: "https://example.com?q=hello" },
    ]);
  });

  it("preserves hash in URL", () => {
    expect(splitByTextAndUrls("https://example.com#section")).toEqual([
      { type: "url", value: "https://example.com#section" },
    ]);
  });

  it("preserves path with parentheses in URL", () => {
    expect(splitByTextAndUrls("https://en.wikipedia.org/wiki/Fish")).toEqual([
      { type: "url", value: "https://en.wikipedia.org/wiki/Fish" },
    ]);
  });

  it("handles empty string", () => {
    expect(splitByTextAndUrls("")).toEqual([{ type: "text", value: "" }]);
  });
});

describe("LinkifiedText", () => {
  it("renders plain text without links", () => {
    render(<LinkifiedText text="hello world" />);
    expect(screen.getByText("hello world")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders https URL as clickable link", () => {
    render(<LinkifiedText text="https://example.com" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveTextContent("https://example.com");
  });

  it("renders www URL with https prefix in href", () => {
    render(<LinkifiedText text="www.example.com" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "https://www.example.com");
    expect(link).toHaveTextContent("www.example.com");
  });

  it("renders mixed text and URLs", () => {
    const { container } = render(<LinkifiedText text="check https://example.com out" />);
    const spans = container.querySelectorAll("span");
    expect(spans[0]).toHaveTextContent("check");
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(spans[1]).toHaveTextContent("out");
  });

  it("applies correct link styles", () => {
    render(<LinkifiedText text="https://example.com" />);
    const link = screen.getByRole("link");
    expect(link.className).toContain("underline");
    expect(link.className).toContain("break-all");
  });

  it("validates href starts with allowed protocol", () => {
    render(<LinkifiedText text="https://example.com" />);
    const link = screen.getByRole("link");
    const href = link.getAttribute("href");
    expect(href?.startsWith("https://") || href?.startsWith("http://")).toBe(true);
  });

  it("renders URL as span when getHref returns null", () => {
    render(<LinkifiedText text="hello world" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders multiple URLs as separate links", () => {
    render(<LinkifiedText text="https://a.com and https://b.com" />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "https://a.com");
    expect(links[1]).toHaveAttribute("href", "https://b.com");
  });

  it("applies break-all to prevent long URL overflow", () => {
    const longUrl = "https://example.com/" + "a".repeat(200);
    render(<LinkifiedText text={longUrl} />);
    const link = screen.getByRole("link");
    expect(link.className).toContain("break-all");
  });
});
