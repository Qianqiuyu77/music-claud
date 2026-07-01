import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConsumerMusicApp } from "@/components/player/ConsumerMusicApp";
import { AdminMusicApp } from "@/components/admin/AdminMusicApp";

vi.mock("@/components/workbench/Workbench", () => ({
  Workbench: ({ mode = "player" }: { mode?: "player" | "admin" }) => (
    <div data-testid="workbench" data-mode={mode}>
      Workbench {mode}
    </div>
  )
}));

describe("B/C app shells", () => {
  it("renders the consumer shell through the player Workbench mode", () => {
    render(<ConsumerMusicApp />);

    expect(screen.getByTestId("workbench")).toHaveAttribute("data-mode", "player");
    expect(screen.getByText("Workbench player")).toBeInTheDocument();
  });

  it("renders the admin shell through the admin Workbench mode", () => {
    render(<AdminMusicApp />);

    expect(screen.getByTestId("workbench")).toHaveAttribute("data-mode", "admin");
    expect(screen.getByText("Workbench admin")).toBeInTheDocument();
  });
});
