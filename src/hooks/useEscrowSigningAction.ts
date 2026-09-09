"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import { useAuthStore } from "@/stores/auth-store";
import { useWalletKit } from "@/hooks/use-wallet-kit";
import { useEscrowSigning, type EscrowSigningState } from "@/hooks/useEscrowSigning";
import type { EscrowOperation } from "@/lib/api/escrow";

/** Thrown by `run()` when the user dismisses the wallet-connect guard without connecting. Not a failure — callers should treat it as "nothing happened" rather than showing an error. */
export class SigningCancelledError extends Error {
  constructor() {
    super("Signing cancelled");
    this.name = "SigningCancelledError";
  }
}

export interface UseEscrowSigningActionParams {
  orderId: string;
  /** Which on-chain step this instance drives — fixed per modal, one hook call each. */
  operation: EscrowOperation;
  /**
   * Runs the existing server-side (custodial) path for INVISIBLE-wallet
   * users. Left completely untouched by this hook — it's called as-is,
   * unchanged from before D2.1, so there is no regression for those users.
   */
  legacyAction: () => Promise<void>;
  /** Order re-read and the action modal closed once the on-chain step lands. */
  onConfirmed: () => void;
}

export interface UseEscrowSigningActionResult {
  /**
   * Starts the right path for the current wallet: the legacy call for an
   * INVISIBLE wallet, or client-side signing for an EXTERNAL one. If SWK
   * isn't currently connected, opens the wallet-connect guard first and
   * resumes automatically once it reports back a connected address.
   *
   * Resolves once the on-chain step lands (after `onConfirmed` has already
   * run) and rejects with the same message shown inline, so a caller with
   * its own follow-up step (e.g. opening the admin dispute record after the
   * on-chain dispute step) can `await` it exactly like the legacy call it
   * replaces — including the wallet-connect detour, which resolves only
   * once the resumed sign completes.
   */
  run: () => Promise<void>;
  /** True for building/awaiting_signature/submitting — render EscrowSigningModal while this holds. */
  isSigningModalOpen: boolean;
  signingState: EscrowSigningState;
  /** Set once on an `error` state; the action modal is expected to show this inline and clear it on retry. */
  inlineError: string | null;
  clearInlineError: () => void;
  isWalletConnectOpen: boolean;
  closeWalletConnect: () => void;
  onWalletConnected: () => void;
}

/**
 * Shared plumbing behind ReleaseFundsModal, OpenDisputeModal, and
 * RefundModal's D2.1 integration — one instance per modal (each fixed to its
 * own operation), so each modal's signing/error state stays independent even
 * though only one action realistically runs at a time.
 */
export function useEscrowSigningAction({
  orderId,
  operation,
  legacyAction,
  onConfirmed,
}: UseEscrowSigningActionParams): UseEscrowSigningActionResult {
  const user = useAuthStore((state) => state.user);
  const { address: liveWalletAddress } = useWalletKit();
  const signing = useEscrowSigning();

  const [inlineError, setInlineError] = useState<string | null>(null);
  const [isWalletConnectOpen, setIsWalletConnectOpen] = useState(false);

  // Whether the wallet-connect guard should resume this operation once SWK
  // reports back a connected address.
  const hasPendingSign = useRef(false);
  // Settled by the confirmed/error effect below, so `run()` can be awaited
  // to completion by a caller with its own follow-up step.
  const pendingSettlers = useRef<{ resolve: () => void; reject: (error: Error) => void } | null>(
    null
  );

  const isExternalWallet = user?.wallet?.type === "EXTERNAL";

  const clearInlineError = useCallback(() => setInlineError(null), []);

  const startSigning = useCallback((): Promise<void> => {
    setInlineError(null);
    return new Promise<void>((resolve, reject) => {
      pendingSettlers.current = { resolve, reject };
      void signing.sign(orderId, operation);
    });
  }, [orderId, operation, signing]);

  const run = useCallback((): Promise<void> => {
    if (!isExternalWallet) {
      return legacyAction();
    }

    if (!liveWalletAddress) {
      return new Promise<void>((resolve, reject) => {
        hasPendingSign.current = true;
        pendingSettlers.current = { resolve, reject };
        setIsWalletConnectOpen(true);
      });
    }

    return startSigning();
  }, [isExternalWallet, legacyAction, liveWalletAddress, startSigning]);

  const closeWalletConnect = useCallback(() => {
    hasPendingSign.current = false;
    setIsWalletConnectOpen(false);
    // The caller's `await run()` needs to settle either way. Rejecting with
    // this specific, recognizable error (rather than resolving) lets a
    // caller with a follow-up step after run() — e.g. opening the admin
    // dispute record — tell "user cancelled" apart from "actually signed"
    // instead of running that follow-up after nothing happened.
    pendingSettlers.current?.reject(new SigningCancelledError());
    pendingSettlers.current = null;
  }, []);

  const onWalletConnected = useCallback(() => {
    setIsWalletConnectOpen(false);
    // Connection just succeeded — sign directly, reusing the settlers the
    // guard's own promise already registered, rather than routing back
    // through `run()`, whose `liveWalletAddress` guard check would read a
    // stale (still-null) closure value if SWK's state event hasn't
    // propagated to this render yet.
    if (hasPendingSign.current) {
      hasPendingSign.current = false;
      setInlineError(null);
      void signing.sign(orderId, operation);
    }
  }, [orderId, operation, signing]);

  useEffect(() => {
    if (signing.state === "confirmed") {
      onConfirmed();
      pendingSettlers.current?.resolve();
      pendingSettlers.current = null;
      signing.reset();
    } else if (signing.state === "error") {
      const message = signing.error?.message ?? "Something went wrong. Please try again.";
      setInlineError(message);
      pendingSettlers.current?.reject(new Error(message));
      pendingSettlers.current = null;
      signing.reset();
    }
    // Only the transition into confirmed/error matters here — signing.reset()
    // intentionally changes signing.state again inside this same effect
    // without re-triggering it, since state is the only reactive dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signing.state]);

  const isSigningModalOpen =
    signing.state === "building" ||
    signing.state === "awaiting_signature" ||
    signing.state === "submitting";

  return {
    run,
    isSigningModalOpen,
    signingState: signing.state,
    inlineError,
    clearInlineError,
    isWalletConnectOpen,
    closeWalletConnect,
    onWalletConnected,
  };
}

/** Connected wallet's display name, for the "check your wallet" copy — best-effort. */
export function currentWalletName(): string | null {
  try {
    return StellarWalletsKit.selectedModule?.productName ?? null;
  } catch {
    return null;
  }
}
