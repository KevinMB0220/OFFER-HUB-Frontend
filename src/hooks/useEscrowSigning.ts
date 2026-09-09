"use client";

import { useCallback, useRef, useState } from "react";
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import { useAuthStore } from "@/stores/auth-store";
import { useWalletKit } from "@/hooks/use-wallet-kit";
import { isWalletCancellation, toWalletErrorMessage } from "@/lib/wallet-error-messages";
import {
  prepareEscrowCreate,
  prepareEscrowFund,
  prepareReleaseStep,
  prepareRefundStep,
  prepareDisputeStep,
  submitEscrowXdr,
  type EscrowOperation,
  type PrepareEscrowResult,
  type PrepareEscrowStepResult,
} from "@/lib/api/escrow";

/**
 * Where the D2.1 signing flow currently is. Mirrors `useWalletAuth`'s `step`
 * pattern: each value is something specific the UI is waiting on, not a
 * generic spinner.
 */
export type EscrowSigningState =
  | "idle"
  | "building"
  | "awaiting_signature"
  | "submitting"
  | "confirmed"
  | "error";

export type EscrowSigningErrorCode =
  | "USER_REJECTED"
  | "XDR_EXPIRED"
  | "NO_WALLET_CONNECTED"
  | "API_ERROR";

export interface EscrowSigningError {
  code: EscrowSigningErrorCode;
  message: string;
}

export interface UseEscrowSigningResult {
  state: EscrowSigningState;
  /**
   * Runs prepare -> sign -> submit for one escrow operation on one order.
   * Safe to call again after an `error` state to retry the same operation
   * from scratch (a fresh XDR is fetched, so `XDR_EXPIRED` self-heals).
   */
  sign: (orderId: string, operation: EscrowOperation) => Promise<void>;
  reset: () => void;
  transactionHash: string | null;
  error: EscrowSigningError | null;
}

type PrepareFn = (
  token: string,
  orderId: string
) => Promise<PrepareEscrowResult | PrepareEscrowStepResult>;

/**
 * One prepare endpoint per operation — there is no single generic "get me an
 * XDR" call on the API (see src/lib/api/escrow.ts). Release/refund/dispute
 * are step-wise: their prepare call returns the *next* unsigned step, which
 * may be `null` if the sequence already landed on-chain.
 */
const PREPARE_BY_OPERATION: Record<EscrowOperation, PrepareFn> = {
  create: prepareEscrowCreate,
  fund: prepareEscrowFund,
  release: prepareReleaseStep,
  refund: prepareRefundStep,
  dispute: prepareDisputeStep,
};

function toApiError(cause: unknown): EscrowSigningError {
  const message =
    cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string"
      ? cause.message
      : "The request failed. Please try again.";
  return { code: "API_ERROR", message };
}

/**
 * Orchestrates the full D2.1 client-side signing flow: fetch the unsigned
 * XDR from the API, sign it with the connected wallet via Stellar Wallets
 * Kit, and submit the signed XDR back. The only place `signTransaction` is
 * called — every escrow action modal (release, refund, dispute) shares this
 * one hook instead of each wiring the kit itself.
 */
export function useEscrowSigning(): UseEscrowSigningResult {
  const [state, setState] = useState<EscrowSigningState>("idle");
  const [error, setError] = useState<EscrowSigningError | null>(null);
  const [transactionHash, setTransactionHash] = useState<string | null>(null);

  const token = useAuthStore((s) => s.token);
  const { address, networkPassphrase } = useWalletKit();

  // Guards a double-submit racing itself, same as useWalletAuth's inFlight ref.
  const inFlight = useRef(false);

  const reset = useCallback(() => {
    setState("idle");
    setError(null);
    setTransactionHash(null);
  }, []);

  const sign = useCallback(
    async (orderId: string, operation: EscrowOperation): Promise<void> => {
      if (inFlight.current || !token) return;

      inFlight.current = true;
      setError(null);
      setTransactionHash(null);

      try {
        setState("building");
        const prepared = await PREPARE_BY_OPERATION[operation](token, orderId);

        // Step-wise operations (release/refund/dispute) return unsignedXdr:
        // null once every step has already landed on-chain — nothing left
        // to sign, so this is success, not an error.
        if (!prepared.unsignedXdr) {
          setState("confirmed");
          return;
        }

        // Checked here, "when the user returns to sign" — i.e. right before
        // handing the XDR to the wallet, not only at fetch time.
        if (prepared.expiresAt !== null && Date.now() > prepared.expiresAt) {
          setError({ code: "XDR_EXPIRED", message: "This signing request expired. Please try again." });
          setState("error");
          return;
        }

        if (!address) {
          setError({ code: "NO_WALLET_CONNECTED", message: "Connect a wallet before signing." });
          setState("error");
          return;
        }

        setState("awaiting_signature");
        let signedTxXdr: string;
        try {
          ({ signedTxXdr } = await StellarWalletsKit.signTransaction(prepared.unsignedXdr, {
            networkPassphrase,
            address,
          }));
        } catch (cause) {
          if (isWalletCancellation(cause)) {
            setError({
              code: "USER_REJECTED",
              message: "You declined the signature request in your wallet.",
            });
          } else {
            setError({
              code: "API_ERROR",
              message: toWalletErrorMessage(cause, "Could not sign the transaction. Please try again."),
            });
          }
          setState("error");
          return;
        }

        setState("submitting");
        // Freshly generated per submit call, not memoized — a retried call
        // must never reuse a key from a previous, possibly-failed attempt.
        const idempotencyKey = crypto.randomUUID();
        const result = await submitEscrowXdr(token, orderId, signedTxXdr, operation, idempotencyKey);

        setTransactionHash(result.transactionHash);
        setState("confirmed");
      } catch (cause) {
        setError(toApiError(cause));
        setState("error");
      } finally {
        inFlight.current = false;
      }
    },
    [token, address, networkPassphrase]
  );

  return { state, sign, reset, transactionHash, error };
}
