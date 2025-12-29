import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ComparePanel } from "./ComparePanel";
import { ErrorNotificationProvider } from "./contexts/ErrorNotificationContext";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

describe("ComparePanel", () => {
  it("shows type conflict for file/dir differences", async () => {
    const compareResult = {
      left_path: "/left",
      right_path: "/right",
      left_only: [],
      right_only: [],
      different: [
        {
          relative_path: "conflict",
          name: "conflict",
          left_size: 0,
          right_size: 1024,
          left_path: "/left/conflict",
          right_path: "/right/conflict",
          left_is_dir: true,
          right_is_dir: false,
        },
      ],
      identical_count: 0,
      left_only_size: 0,
      right_only_size: 0,
      different_size: 0,
      time_ms: 12,
    };

    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === "open_folder_dialog") {
        return Promise.resolve("/right");
      }
      if (command === "compare_directories") {
        return Promise.resolve(compareResult);
      }
      return Promise.resolve(null);
    });

    render(
      <ErrorNotificationProvider>
        <ComparePanel
          initialPath="/left"
          onClose={() => {}}
          onShowInFinder={() => {}}
        />
      </ErrorNotificationProvider>
    );

    const browseButtons = screen.getAllByRole("button", { name: "Browse" });
    fireEvent.click(browseButtons[1]);

    const compareButton = screen.getByRole("button", {
      name: "Compare Directories",
    });

    await waitFor(() => {
      expect(compareButton.hasAttribute("disabled")).toBe(false);
    });

    fireEvent.click(compareButton);

    const conflict = await screen.findByText("Type conflict");
    expect(conflict).toBeTruthy();
    expect(screen.getByText("📁/📄")).toBeTruthy();
  });
});
