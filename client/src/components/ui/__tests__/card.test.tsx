import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "../../../components/ui/card";

describe("Card Components", () => {
  describe("Card", () => {
    it("should render children", () => {
      render(<Card>Card content</Card>);
      expect(screen.getByText("Card content")).toBeInTheDocument();
    });

    it("should apply custom className", () => {
      render(<Card className="custom-card">Card content</Card>);
      const card = screen.getByText("Card content");
      expect(card).toHaveClass("custom-card");
    });

    it("should forward ref", () => {
      const ref = React.createRef<HTMLDivElement>();
      render(<Card ref={ref}>Card content</Card>);
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
    });
  });

  describe("CardHeader", () => {
    it("should render header content", () => {
      render(<CardHeader>Header content</CardHeader>);
      expect(screen.getByText("Header content")).toBeInTheDocument();
    });

    it("should apply base styles", () => {
      render(<CardHeader>Header</CardHeader>);
      const header = screen.getByText("Header");
      expect(header).toHaveClass("flex", "flex-col", "space-y-1.5", "p-6");
    });
  });

  describe("CardTitle", () => {
    it("should render title", () => {
      render(<CardTitle>Card Title</CardTitle>);
      expect(screen.getByText("Card Title")).toBeInTheDocument();
    });

    it("should apply title styles", () => {
      render(<CardTitle>Title</CardTitle>);
      const title = screen.getByText("Title");
      expect(title).toHaveClass("text-2xl", "font-semibold", "leading-none", "tracking-tight");
    });
  });

  describe("CardDescription", () => {
    it("should render description", () => {
      render(<CardDescription>Card description</CardDescription>);
      expect(screen.getByText("Card description")).toBeInTheDocument();
    });

    it("should apply description styles", () => {
      render(<CardDescription>Description</CardDescription>);
      const description = screen.getByText("Description");
      expect(description).toHaveClass("text-sm", "text-muted-foreground");
    });
  });

  describe("CardContent", () => {
    it("should render content", () => {
      render(<CardContent>Card content</CardContent>);
      expect(screen.getByText("Card content")).toBeInTheDocument();
    });

    it("should apply content styles", () => {
      render(<CardContent>Content</CardContent>);
      const content = screen.getByText("Content");
      expect(content).toHaveClass("p-6", "pt-0");
    });
  });

  describe("CardFooter", () => {
    it("should render footer", () => {
      render(<CardFooter>Card footer</CardFooter>);
      expect(screen.getByText("Card footer")).toBeInTheDocument();
    });

    it("should apply footer styles", () => {
      render(<CardFooter>Footer</CardFooter>);
      const footer = screen.getByText("Footer");
      expect(footer).toHaveClass("flex", "items-center", "p-6", "pt-0");
    });
  });

  describe("Card composition", () => {
    it("should render complete card structure", () => {
      render(
        <Card>
          <CardHeader>
            <CardTitle>Test Title</CardTitle>
            <CardDescription>Test Description</CardDescription>
          </CardHeader>
          <CardContent>Test Content</CardContent>
          <CardFooter>Test Footer</CardFooter>
        </Card>,
      );

      expect(screen.getByText("Test Title")).toBeInTheDocument();
      expect(screen.getByText("Test Description")).toBeInTheDocument();
      expect(screen.getByText("Test Content")).toBeInTheDocument();
      expect(screen.getByText("Test Footer")).toBeInTheDocument();
    });
  });
});
