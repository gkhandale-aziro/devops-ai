import { render, screen } from "@testing-library/react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "./card";

describe("Card", () => {
  it("renders all sections", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Title</CardTitle>
          <CardDescription>Description</CardDescription>
        </CardHeader>
        <CardContent>Content here</CardContent>
        <CardFooter>Footer</CardFooter>
      </Card>
    );

    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText("Description")).toBeInTheDocument();
    expect(screen.getByText("Content here")).toBeInTheDocument();
    expect(screen.getByText("Footer")).toBeInTheDocument();
  });

  it("applies theme-aware classes", () => {
    const { container } = render(<Card>Test</Card>);
    expect(container.firstChild).toHaveClass("bg-surface");
    expect(container.firstChild).toHaveClass("border-border");
  });

  it("merges custom className", () => {
    const { container } = render(<Card className="mt-4">Test</Card>);
    expect(container.firstChild).toHaveClass("mt-4");
    expect(container.firstChild).toHaveClass("bg-surface");
  });

  it("forwards ref", () => {
    const ref = { current: null as HTMLDivElement | null };
    render(<Card ref={ref}>Ref test</Card>);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });
});
