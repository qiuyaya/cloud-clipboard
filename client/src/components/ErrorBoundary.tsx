import { Component } from "react";
import type { ReactNode, ErrorInfo } from "react";
import { debug } from "@/utils/debug";
import i18n from "i18next";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    debug.error("React Error Boundary caught error", { error, errorInfo });
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  override render(): ReactNode {
    if (this.state.hasError) {
      const t = i18n.t.bind(i18n);
      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-4">
          <div className="text-center space-y-4">
            <h2 className="text-xl font-semibold text-foreground">{t("errorBoundary.title")}</h2>
            <p className="text-muted-foreground text-sm max-w-md">
              {this.state.error?.message || t("errorBoundary.defaultMessage")}
            </p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={this.handleReset}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm"
              >
                {t("errorBoundary.tryAgain")}
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md text-sm"
              >
                {t("errorBoundary.reloadPage")}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
