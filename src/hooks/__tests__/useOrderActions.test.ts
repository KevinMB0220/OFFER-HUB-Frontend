import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOrderActions } from "../useOrderActions";
import { SigningCancelledError as RealSigningCancelledError } from "@/hooks/useEscrowSigningAction";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/stores/auth-store", () => ({
  useAuthStore: (selector: (s: { token: string | null; user: { id: string } | null }) => unknown) =>
    selector({ token: "jwt-token", user: { id: "usr_buyer" } }),
}));

const mockReleaseFunds = vi.fn();
const mockOpenDispute = vi.fn();
const mockRequestRefund = vi.fn();

vi.mock("@/lib/api/orders", () => ({
  releaseFunds: (...args: unknown[]) => mockReleaseFunds(...args),
  openDispute: (...args: unknown[]) => mockOpenDispute(...args),
  requestRefund: (...args: unknown[]) => mockRequestRefund(...args),
  cancelOrder: vi.fn(),
  createEscrow: vi.fn(),
  fundEscrow: vi.fn(),
  markOrderCompleted: vi.fn(),
  reserveFunds: vi.fn(),
}));

vi.mock("@/lib/api/reviews", () => ({
  submitOrderReview: vi.fn(),
  submitReviewResponse: vi.fn(),
}));

// One controllable `run()` mock and its real `legacyAction` per operation —
// mirrors how useOrderActions builds one useEscrowSigningAction instance per
// action. Each test decides, per operation, whether `run()` should call the
// real legacy action (simulating an INVISIBLE wallet), resolve on its own
// (EXTERNAL wallet, signed), or reject (EXTERNAL wallet, error/cancelled).
const runByOperation: Record<string, ReturnType<typeof vi.fn>> = {};
const legacyActionByOperation: Record<string, () => Promise<void>> = {};

vi.mock("@/hooks/useEscrowSigningAction", () => {
  class MockSigningCancelledError extends Error {
    constructor() {
      super("Signing cancelled");
      this.name = "SigningCancelledError";
    }
  }
  return {
    SigningCancelledError: MockSigningCancelledError,
    currentWalletName: () => null,
    useEscrowSigningAction: ({
      operation,
      legacyAction,
    }: {
      operation: string;
      legacyAction: () => Promise<void>;
    }) => {
      legacyActionByOperation[operation] = legacyAction;
      const run = runByOperation[operation] ?? (runByOperation[operation] = vi.fn().mockResolvedValue(undefined));
      return {
        run,
        isSigningModalOpen: false,
        signingState: "idle" as const,
        inlineError: null,
        clearInlineError: vi.fn(),
        isWalletConnectOpen: false,
        closeWalletConnect: vi.fn(),
        onWalletConnected: vi.fn(),
      };
    },
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const ORDER_ID = "ord_abc123";

function setup(overrides: Partial<Parameters<typeof useOrderActions>[0]> = {}) {
  const onOrderChange = vi.fn();
  const refetchOrder = vi.fn().mockResolvedValue(undefined);
  return renderHook(() =>
    useOrderActions({
      orderId: ORDER_ID,
      order: null,
      review: null,
      isBuyer: true,
      onOrderChange,
      onReviewChange: vi.fn(),
      refetchOrder,
      ...overrides,
    })
  );
}

/** Makes this operation's `run()` behave like an INVISIBLE wallet: call the real legacy action. */
function useLegacyPath(operation: string) {
  runByOperation[operation].mockImplementation(() => legacyActionByOperation[operation]());
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.keys(runByOperation).forEach((key) => delete runByOperation[key]);
  Object.keys(legacyActionByOperation).forEach((key) => delete legacyActionByOperation[key]);
  mockReleaseFunds.mockResolvedValue({ id: ORDER_ID, status: "CLOSED" });
  mockOpenDispute.mockResolvedValue({ id: "dsp_1" });
  mockRequestRefund.mockResolvedValue({ id: ORDER_ID, status: "CLOSED" });
});

describe("useOrderActions — handleReleaseFunds", () => {
  it("always goes through releaseSigning.run(), not releaseFunds directly", async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.handleReleaseFunds();
    });

    expect(runByOperation["release"]).toHaveBeenCalledOnce();
    expect(mockReleaseFunds).not.toHaveBeenCalled();
  });

  it("still reaches the legacy releaseFunds call for an INVISIBLE wallet", async () => {
    const { result } = setup();
    useLegacyPath("release");

    await act(async () => {
      await result.current.handleReleaseFunds();
    });

    expect(mockReleaseFunds).toHaveBeenCalledWith("jwt-token", ORDER_ID);
  });

  it("swallows a rejected run() instead of throwing out of the handler", async () => {
    const { result } = setup();
    runByOperation["release"].mockRejectedValue(new Error("boom"));

    await act(async () => {
      await expect(result.current.handleReleaseFunds()).resolves.toBeUndefined();
    });
  });
});

describe("useOrderActions — handleOpenDispute", () => {
  it("runs the on-chain dispute step before opening the admin record when the caller is the buyer", async () => {
    const { result } = setup({ isBuyer: true });

    await act(async () => {
      await result.current.handleOpenDispute("QUALITY_ISSUE", "Work was incomplete and low quality.");
    });

    expect(runByOperation["dispute"]).toHaveBeenCalledOnce();
    expect(mockOpenDispute).toHaveBeenCalledWith(
      "jwt-token",
      expect.objectContaining({ orderId: ORDER_ID, openedBy: "BUYER", reason: "QUALITY_ISSUE" })
    );
  });

  it("skips the on-chain dispute step entirely when the caller is the seller", async () => {
    const { result } = setup({ isBuyer: false });

    await act(async () => {
      await result.current.handleOpenDispute("OTHER", "Buyer is unresponsive.");
    });

    expect(runByOperation["dispute"]).not.toHaveBeenCalled();
    expect(mockOpenDispute).toHaveBeenCalledWith(
      "jwt-token",
      expect.objectContaining({ openedBy: "SELLER" })
    );
  });

  it("rethrows with a friendly message and does not open the admin record when signing is cancelled", async () => {
    const { result } = setup({ isBuyer: true });
    runByOperation["dispute"].mockRejectedValue(new RealSigningCancelledError());

    await expect(
      result.current.handleOpenDispute("OTHER", "Something happened here.")
    ).rejects.toThrow("Signing cancelled — dispute not opened.");

    expect(mockOpenDispute).not.toHaveBeenCalled();
  });

  it("rethrows the real failure message and does not open the admin record on a genuine signing error", async () => {
    const { result } = setup({ isBuyer: true });
    runByOperation["dispute"].mockRejectedValue(new Error("network exploded"));

    await expect(
      result.current.handleOpenDispute("OTHER", "Something happened here.")
    ).rejects.toThrow("network exploded");

    expect(mockOpenDispute).not.toHaveBeenCalled();
  });
});

describe("useOrderActions — handleRequestRefund", () => {
  it("threads the reason through to the legacy call for an INVISIBLE wallet", async () => {
    const { result } = setup();
    useLegacyPath("refund");

    await act(async () => {
      await result.current.handleRequestRefund("The work was never delivered.");
    });

    expect(runByOperation["refund"]).toHaveBeenCalledOnce();
    expect(mockRequestRefund).toHaveBeenCalledWith("jwt-token", ORDER_ID, "The work was never delivered.");
  });

  it("goes through refundSigning.run() without calling requestRefund directly for the client-signing path", async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.handleRequestRefund("The work was never delivered.");
    });

    expect(runByOperation["refund"]).toHaveBeenCalledOnce();
    expect(mockRequestRefund).not.toHaveBeenCalled();
  });

  it("swallows a rejected run() instead of throwing out of the handler", async () => {
    const { result } = setup();
    runByOperation["refund"].mockRejectedValue(new Error("boom"));

    await act(async () => {
      await expect(result.current.handleRequestRefund("reason")).resolves.toBeUndefined();
    });
  });
});
