import { createLogger } from "@molcrafts/molvis-stage";
import { Component, type ErrorInfo, type ReactNode } from "react";

const log = createLogger("molvis-react");

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    log.error("Uncaught React error", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full w-full items-center justify-center bg-status-failed-soft p-8 text-status-failed-foreground">
          <div className="max-w-xl space-y-4">
            <h1 className="text-display font-semibold">
              Something went wrong.
            </h1>
            <pre className="overflow-auto rounded-control bg-background/50 p-4 text-sm">
              {this.state.error?.message}
            </pre>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
