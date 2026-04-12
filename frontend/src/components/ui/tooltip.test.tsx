import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "./tooltip";

function TestTooltip() {
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger>Hover me</TooltipTrigger>
        <TooltipContent>Tooltip text</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

describe("Tooltip", () => {
  it("renders trigger", () => {
    render(<TestTooltip />);
    expect(screen.getByText("Hover me")).toBeInTheDocument();
  });

  it("shows content on hover", async () => {
    render(<TestTooltip />);
    await userEvent.hover(screen.getByText("Hover me"));
    const content = await screen.findByRole("tooltip");
    expect(content).toHaveTextContent("Tooltip text");
  });
});
