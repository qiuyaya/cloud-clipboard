import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Input } from "../../../components/ui/input";

describe("Input Component", () => {
  it("should render with default props", () => {
    render(<Input />);

    const input = screen.getByRole("textbox");
    expect(input).toBeInTheDocument();
  });

  it("should render with different input types", () => {
    const { rerender } = render(<Input type="password" />);
    expect(screen.getByDisplayValue("")).toHaveAttribute("type", "password");

    rerender(<Input type="email" />);
    expect(screen.getByRole("textbox")).toHaveAttribute("type", "email");

    rerender(<Input type="number" />);
    expect(screen.getByRole("spinbutton")).toHaveAttribute("type", "number");
  });

  it("should handle value and onChange", async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();

    render(<Input value="" onChange={handleChange} />);

    const input = screen.getByRole("textbox");
    await user.type(input, "test");

    expect(handleChange).toHaveBeenCalledTimes(4); // One for each character
  });

  it("should handle placeholder", () => {
    render(<Input placeholder="Enter text..." />);

    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("placeholder", "Enter text...");
  });

  it("should handle disabled state", () => {
    render(<Input disabled />);

    const input = screen.getByRole("textbox");
    expect(input).toBeDisabled();
  });

  it("should handle readonly state", () => {
    render(<Input readOnly />);

    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("readonly");
  });

  it("should apply custom className", () => {
    render(<Input className="custom-input" />);

    const input = screen.getByRole("textbox");
    expect(input).toHaveClass("custom-input");
  });

  it("should forward ref correctly", () => {
    const ref = React.createRef<HTMLInputElement>();
    render(<Input ref={ref} />);

    expect(ref.current).toBeInstanceOf(HTMLInputElement);
    expect(ref.current).toBe(screen.getByRole("textbox"));
  });

  it("should handle focus and blur events", async () => {
    const user = userEvent.setup();
    const handleFocus = vi.fn();
    const handleBlur = vi.fn();

    render(<Input onFocus={handleFocus} onBlur={handleBlur} />);

    const input = screen.getByRole("textbox");

    await user.click(input);
    expect(handleFocus).toHaveBeenCalledTimes(1);

    await user.tab();
    expect(handleBlur).toHaveBeenCalledTimes(1);
  });

  it("should handle keyboard events", async () => {
    const user = userEvent.setup();
    const handleKeyDown = vi.fn();
    const handleKeyUp = vi.fn();

    render(<Input onKeyDown={handleKeyDown} onKeyUp={handleKeyUp} />);

    const input = screen.getByRole("textbox");
    await user.click(input);
    await user.keyboard("{Enter}");

    expect(handleKeyDown).toHaveBeenCalled();
    expect(handleKeyUp).toHaveBeenCalled();
  });

  it("should handle mouse events", async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();
    const handleMouseEnter = vi.fn();
    const handleMouseLeave = vi.fn();

    render(
      <Input
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      />,
    );

    const input = screen.getByRole("textbox");

    await user.hover(input);
    expect(handleMouseEnter).toHaveBeenCalledTimes(1);

    await user.click(input);
    expect(handleClick).toHaveBeenCalledTimes(1);

    await user.unhover(input);
    expect(handleMouseLeave).toHaveBeenCalledTimes(1);
  });

  it("should handle required attribute", () => {
    render(<Input required />);

    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("required");
  });

  it("should handle min and max for number inputs", () => {
    render(<Input type="number" min={0} max={100} />);

    const input = screen.getByRole("spinbutton");
    expect(input).toHaveAttribute("min", "0");
    expect(input).toHaveAttribute("max", "100");
  });

  it("should handle step for number inputs", () => {
    render(<Input type="number" step={0.1} />);

    const input = screen.getByRole("spinbutton");
    expect(input).toHaveAttribute("step", "0.1");
  });

  it("should handle pattern for text inputs", () => {
    render(<Input pattern="[0-9]*" />);

    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("pattern", "[0-9]*");
  });

  it("should handle maxLength", () => {
    render(<Input maxLength={10} />);

    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("maxlength", "10");
  });

  it("should handle autoComplete", () => {
    render(<Input autoComplete="email" />);

    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("autocomplete", "email");
  });

  it("should handle autoFocus", () => {
    render(<Input autoFocus />);

    const input = screen.getByRole("textbox");
    expect(input).toHaveFocus();
  });

  it("should handle form attributes", () => {
    render(<Input name="testInput" id="test-input" form="test-form" />);

    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("name", "testInput");
    expect(input).toHaveAttribute("id", "test-input");
    expect(input).toHaveAttribute("form", "test-form");
  });

  it("should handle ARIA attributes", () => {
    render(<Input aria-label="Test input" aria-describedby="help-text" aria-invalid="true" />);

    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("aria-label", "Test input");
    expect(input).toHaveAttribute("aria-describedby", "help-text");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("should handle data attributes", () => {
    render(<Input data-testid="custom-input" data-custom="value" />);

    const input = screen.getByTestId("custom-input");
    expect(input).toHaveAttribute("data-custom", "value");
  });

  it("should apply base styles", () => {
    render(<Input />);

    const input = screen.getByRole("textbox");
    // Check for base Tailwind classes that should be applied
    expect(input).toHaveClass("flex", "w-full", "rounded-md", "border");
    // Check for responsive height classes
    expect(input).toHaveClass("lg:h-10", "h-12");
  });

  it("should apply focus styles on focus", async () => {
    const user = userEvent.setup();
    render(<Input />);

    const input = screen.getByRole("textbox");
    await user.click(input);

    expect(input).toHaveFocus();
  });

  it("should handle file input type", () => {
    render(<Input type="file" />);

    // File inputs don't have a role of textbox
    const input = screen.getByDisplayValue("");
    expect(input).toHaveAttribute("type", "file");
  });

  it("should handle controlled and uncontrolled modes", async () => {
    const user = userEvent.setup();

    // Uncontrolled
    const { rerender } = render(<Input defaultValue="initial" />);
    let input = screen.getByRole("textbox");
    expect(input).toHaveValue("initial");

    await user.clear(input);
    await user.type(input, "changed");
    expect(input).toHaveValue("changed");

    // Controlled
    const handleChange = vi.fn();
    rerender(<Input value="controlled" onChange={handleChange} />);
    input = screen.getByRole("textbox");
    expect(input).toHaveValue("controlled");
  });
});
