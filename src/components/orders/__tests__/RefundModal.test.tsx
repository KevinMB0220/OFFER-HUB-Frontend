import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RefundModal } from "../RefundModal";

const LONG_ENOUGH_REASON = "The freelancer stopped responding after payment.";

function setup(overrides: Partial<React.ComponentProps<typeof RefundModal>> = {}) {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  const utils = render(
    <RefundModal
      isOpen
      amount="150.00"
      isProcessing={false}
      error={null}
      onCancel={onCancel}
      onConfirm={onConfirm}
      {...overrides}
    />
  );
  return { ...utils, onCancel, onConfirm };
}

describe("RefundModal — visibility", () => {
  it("renders nothing when isOpen is false", () => {
    render(
      <RefundModal
        isOpen={false}
        amount="10.00"
        isProcessing={false}
        error={null}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    expect(screen.queryByText(/request refund/i)).not.toBeInTheDocument();
  });

  it("shows the requested amount", () => {
    setup({ amount: "150.00" });
    expect(screen.getByText("$150.00")).toBeInTheDocument();
  });
});

describe("RefundModal — validation", () => {
  it("blocks submission with a short reason and shows a validation message", async () => {
    const { onConfirm } = setup();

    await userEvent.type(screen.getByLabelText(/reason for refund/i), "too short");
    await userEvent.click(screen.getByRole("button", { name: /request refund/i }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/at least 10 characters/i);
  });

  it("submits the trimmed reason once it's long enough", async () => {
    const { onConfirm } = setup();

    await userEvent.type(screen.getByLabelText(/reason for refund/i), `  ${LONG_ENOUGH_REASON}  `);
    await userEvent.click(screen.getByRole("button", { name: /request refund/i }));

    expect(onConfirm).toHaveBeenCalledWith(LONG_ENOUGH_REASON);
  });
});

describe("RefundModal — error and processing", () => {
  it("shows a caller-supplied error", () => {
    setup({ error: "Cannot prepare refund: order is not IN_PROGRESS" });
    expect(screen.getByRole("alert")).toHaveTextContent("Cannot prepare refund: order is not IN_PROGRESS");
  });

  it("disables the form and both buttons while processing", () => {
    setup({ isProcessing: true });

    expect(screen.getByLabelText(/reason for refund/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled();
    expect(screen.getByText(/processing/i)).toBeInTheDocument();
  });

  it("calls onCancel when Cancel is clicked", async () => {
    const { onCancel } = setup();
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
