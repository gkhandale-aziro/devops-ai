import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./dialog";

describe("Dialog", () => {
  it("opens when trigger is clicked", async () => {
    render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Test Dialog</DialogTitle>
            <DialogDescription>A description</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );

    expect(screen.queryByText("Test Dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("Open"));
    expect(screen.getByText("Test Dialog")).toBeInTheDocument();
    expect(screen.getByText("A description")).toBeInTheDocument();
  });

  it("renders footer content", async () => {
    render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogTitle>Title</DialogTitle>
          <DialogFooter>
            <button>Save</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );

    await userEvent.click(screen.getByText("Open"));
    expect(screen.getByText("Save")).toBeInTheDocument();
  });

  it("has close button with sr-only text", async () => {
    render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogTitle>Title</DialogTitle>
        </DialogContent>
      </Dialog>
    );

    await userEvent.click(screen.getByText("Open"));
    expect(screen.getByText("Close")).toBeInTheDocument();
  });
});
