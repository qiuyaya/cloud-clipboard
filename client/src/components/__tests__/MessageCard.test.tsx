import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MessageCard } from "../MessageCard";
import type { TextMessage, FileMessage } from "@cloud-clipboard/shared";

// Mock react-i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "zh" },
  }),
}));

const baseUser = {
  id: "user-1",
  name: "TestUser",
  fingerprint: "abc123def456",
};

function createTextMessage(content: string, overrides?: Partial<TextMessage>): TextMessage {
  return {
    id: "msg-1",
    type: "text",
    content,
    sender: baseUser,
    timestamp: new Date().toISOString(),
    roomKey: "test-room",
    ...overrides,
  };
}

function createFileMessage(overrides?: Partial<FileMessage>): FileMessage {
  return {
    id: "msg-2",
    type: "file",
    fileInfo: { name: "test.txt", size: 1024, type: "text/plain" },
    sender: baseUser,
    timestamp: new Date().toISOString(),
    roomKey: "test-room",
    downloadUrl: "/files/test.txt",
    ...overrides,
  };
}

const defaultProps = {
  isOwnMessage: false,
  copiedMessageId: null,
  recallConfirmId: null,
  onCopy: vi.fn(),
  onRecallConfirm: vi.fn(),
  onRecallCancel: vi.fn(),
  onRecall: vi.fn(),
};

function renderWithProviders(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

describe("MessageCard", () => {
  it("renders text message content", () => {
    renderWithProviders(<MessageCard {...defaultProps} message={createTextMessage("hello")} />);
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("renders file message with name and size", () => {
    renderWithProviders(<MessageCard {...defaultProps} message={createFileMessage()} />);
    expect(screen.getByText("test.txt")).toBeInTheDocument();
    expect(screen.getByText(/1\.00 KB/)).toBeInTheDocument();
  });

  it("shows sender name", () => {
    renderWithProviders(<MessageCard {...defaultProps} message={createTextMessage("hi")} />);
    expect(screen.getByText("TestUser")).toBeInTheDocument();
  });

  it("shows (You) label for own messages", () => {
    renderWithProviders(
      <MessageCard {...defaultProps} message={createTextMessage("hi")} isOwnMessage={true} />,
    );
    expect(screen.getByText(/message\.you/)).toBeInTheDocument();
  });

  it("calls onCopy when copy button clicked", () => {
    const onCopy = vi.fn();
    renderWithProviders(
      <MessageCard {...defaultProps} onCopy={onCopy} message={createTextMessage("content")} />,
    );
    fireEvent.click(screen.getByLabelText("message.copy"));
    expect(onCopy).toHaveBeenCalledWith("msg-1", "content");
  });

  it("shows recall button for own messages", () => {
    renderWithProviders(
      <MessageCard {...defaultProps} message={createTextMessage("hi")} isOwnMessage={true} />,
    );
    expect(screen.getByLabelText("message.recall")).toBeInTheDocument();
  });

  it("does not show recall button for others messages", () => {
    renderWithProviders(<MessageCard {...defaultProps} message={createTextMessage("hi")} />);
    expect(screen.queryByLabelText("message.recall")).not.toBeInTheDocument();
  });

  it("shows recall confirmation when recallConfirmId matches", () => {
    renderWithProviders(
      <MessageCard
        {...defaultProps}
        message={createTextMessage("hi")}
        isOwnMessage={true}
        recallConfirmId="msg-1"
      />,
    );
    expect(screen.getByText("message.recallConfirm")).toBeInTheDocument();
  });

  it("shows expand button for long messages", () => {
    const longContent = Array(10).fill("line of text here").join("\n");
    renderWithProviders(<MessageCard {...defaultProps} message={createTextMessage(longContent)} />);
    expect(screen.getByText("message.expand")).toBeInTheDocument();
  });

  it("does not show expand button for short messages", () => {
    renderWithProviders(<MessageCard {...defaultProps} message={createTextMessage("short")} />);
    expect(screen.queryByText("message.expand")).not.toBeInTheDocument();
  });

  it("does not show expand button for file messages", () => {
    renderWithProviders(<MessageCard {...defaultProps} message={createFileMessage()} />);
    expect(screen.queryByText("message.expand")).not.toBeInTheDocument();
  });

  it("toggles between expand and collapse", () => {
    const longContent = Array(10).fill("line of text here").join("\n");
    renderWithProviders(<MessageCard {...defaultProps} message={createTextMessage(longContent)} />);

    const expandBtn = screen.getByText("message.expand");
    fireEvent.click(expandBtn);

    expect(screen.getByText("message.collapse")).toBeInTheDocument();
    expect(screen.queryByText("message.expand")).not.toBeInTheDocument();

    const collapseBtn = screen.getByText("message.collapse");
    fireEvent.click(collapseBtn);

    expect(screen.getByText("message.expand")).toBeInTheDocument();
    expect(screen.queryByText("message.collapse")).not.toBeInTheDocument();
  });

  it("applies collapsed class when collapsed", () => {
    const longContent = Array(10).fill("line of text here").join("\n");
    const { container } = renderWithProviders(
      <MessageCard {...defaultProps} message={createTextMessage(longContent)} />,
    );
    expect(container.querySelector(".message-collapsed")).toBeInTheDocument();
  });

  it("removes collapsed class when expanded", () => {
    const longContent = Array(10).fill("line of text here").join("\n");
    const { container } = renderWithProviders(
      <MessageCard {...defaultProps} message={createTextMessage(longContent)} />,
    );
    fireEvent.click(screen.getByText("message.expand"));
    expect(container.querySelector(".message-collapsed")).not.toBeInTheDocument();
  });
});
