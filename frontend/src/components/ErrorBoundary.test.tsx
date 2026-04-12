import { render, screen } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";

function ThrowingComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("Test explosion");
  return <div>Working fine</div>;
}

describe("ErrorBoundary", () => {
  const originalError = console.error;
  beforeAll(() => { console.error = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].includes("Error boundary")) return;
    if (typeof args[0] === "string" && args[0].includes("The above error")) return;
    originalError(...args);
  }; });
  afterAll(() => { console.error = originalError; });

  it("renders children when no error", () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={false} />
      </ErrorBoundary>
    );
    expect(screen.getByText("Working fine")).toBeInTheDocument();
  });

  it("renders fallback UI when child throws", () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.getByText(/this page crashed/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reload/i })).toBeInTheDocument();
  });

  it("shows the error message", () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.getByText(/test explosion/i)).toBeInTheDocument();
  });
});
