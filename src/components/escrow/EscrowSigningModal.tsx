"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { Icon, ICON_PATHS, LoadingSpinner } from "@/components/ui/Icon";
import { PRIMARY_BUTTON, DANGER_BUTTON } from "@/lib/styles";
import type { EscrowSigningState, EscrowSigningError } from "@/hooks/useEscrowSigning";

export interface EscrowSigningModalProps {
  isOpen: boolean;
  state: EscrowSigningState;
  error: EscrowSigningError | null;
  transactionHash: string | null;
  /**
   * Connected wallet's display name (e.g. "Freighter"), read by the caller
   * from `StellarWalletsKit.selectedModule?.productName`. Shown next to the
   * "check your wallet" message when known; omitted otherwise, since not
   * every module reports one reliably.
   */
  walletName?: string | null;
  /** Re-runs the same operation from scratch (a fresh XDR is fetched). */
  onRetry: () => void;
  /** Dismisses the modal. Has no effect while a wallet or submission is in flight. */
  onClose: () => void;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

function truncateHash(hash: string): string {
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-8)}`;
}

/** Text shown for the three named error codes, plus a generic fallback. */
function errorCopy(error: EscrowSigningError): { title: string; message: string } {
  switch (error.code) {
    case "USER_REJECTED":
      return { title: "Signing cancelled", message: "You cancelled the signing. Try again?" };
    case "XDR_EXPIRED":
      return { title: "Transaction expired", message: "Transaction expired. Please try again." };
    default:
      return { title: "Signing failed", message: error.message };
  }
}

function stateTitle(state: EscrowSigningState, error: EscrowSigningError | null): string {
  switch (state) {
    case "building":
      return "Preparing transaction";
    case "awaiting_signature":
      return "Check your wallet";
    case "submitting":
      return "Submitting to Stellar";
    case "confirmed":
      return "Transaction confirmed";
    case "error":
      return error ? errorCopy(error).title : "Signing failed";
    case "idle":
      return "Preparing transaction";
  }
}

/**
 * User-facing dialog for the D2.1 client-side signing flow. Purely
 * presentational — it renders whatever `state`/`error`/`transactionHash` the
 * caller's `useEscrowSigning()` instance is currently in; it never calls the
 * hook or the wallet kit itself. Each action modal (release, refund,
 * dispute) owns one `useEscrowSigning()` call and renders this on top of it.
 */
export function EscrowSigningModal({
  isOpen,
  state,
  error,
  transactionHash,
  walletName,
  onRetry,
  onClose,
}: EscrowSigningModalProps): React.JSX.Element | null {
  const [copied, setCopied] = useState(false);
  // Resets the "Copied!" state if a new transaction hash arrives (e.g. this
  // modal instance gets reused for a second operation). Adjusting state
  // during render on a prop change, per React's guidance, instead of an
  // effect that would cause an extra render pass.
  const [lastHash, setLastHash] = useState(transactionHash);
  if (transactionHash !== lastHash) {
    setLastHash(transactionHash);
    setCopied(false);
  }
  const dialogRef = useRef<HTMLDivElement>(null);

  // Committed to the wallet or the network — closing now would abandon a
  // signature request or a submission the user has no way to check on again.
  const isBlocking = state === "awaiting_signature" || state === "submitting";

  const handleClose = useCallback(() => {
    if (isBlocking) return;
    onClose();
  }, [isBlocking, onClose]);

  useEffect(() => {
    if (!isOpen) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        handleClose();
        return;
      }

      // Minimal focus trap: wrap Tab/Shift+Tab within the dialog instead of
      // letting focus escape to the page behind the backdrop.
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;

        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    dialogRef.current?.focus();
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, handleClose]);

  if (!isOpen || typeof document === "undefined") return null;

  async function copyTransactionHash() {
    if (!transactionHash) return;
    try {
      await navigator.clipboard.writeText(transactionHash);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy transaction hash:", err);
    }
  }

  const title = stateTitle(state, error);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={handleClose}
        disabled={isBlocking}
        aria-label="Close"
      />

      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="escrow-signing-title"
        className={cn(
          "relative w-full max-w-sm outline-none",
          "bg-white rounded-2xl p-6",
          "shadow-[8px_8px_16px_#d1d5db,-8px_-8px_16px_#ffffff]",
          "animate-scale-in"
        )}
      >
        <div className="flex items-start justify-between mb-5">
          <h2 id="escrow-signing-title" className="text-lg font-bold text-text-primary">
            {title}
          </h2>
          {!isBlocking && (
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close"
              className={cn(
                "w-9 h-9 flex items-center justify-center rounded-xl shrink-0 ml-3",
                "text-text-secondary bg-white",
                "shadow-[3px_3px_6px_#d1d5db,-3px_-3px_6px_#ffffff]",
                "hover:text-text-primary",
                "active:shadow-[inset_2px_2px_4px_#d1d5db,inset_-2px_-2px_4px_#ffffff]",
                "transition-all duration-150"
              )}
            >
              <Icon path={ICON_PATHS.close} size="sm" />
            </button>
          )}
        </div>

        <div className="h-px bg-gradient-to-r from-transparent via-gray-200 to-transparent mb-5" />

        {(state === "building" || state === "idle") && (
          <div role="status" className="flex flex-col items-center gap-3 py-8 text-center">
            <LoadingSpinner size="lg" className="text-primary" />
            <p className="text-sm text-text-secondary">Preparing transaction…</p>
          </div>
        )}

        {state === "awaiting_signature" && (
          <div role="status" className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center shadow-[inset_3px_3px_6px_#d1d5db,inset_-3px_-3px_6px_#ffffff]">
              <Icon path={ICON_PATHS.creditCard} size="lg" className="text-primary" />
            </div>
            <p className="text-sm text-text-secondary">
              Check your wallet extension to sign
              {walletName ? ` (${walletName})` : ""}
            </p>
          </div>
        )}

        {state === "submitting" && (
          <div role="status" className="flex flex-col items-center gap-3 py-8 text-center">
            <LoadingSpinner size="lg" className="text-primary" />
            <p className="text-sm text-text-secondary">Submitting to Stellar…</p>
          </div>
        )}

        {state === "confirmed" && (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center shadow-[inset_3px_3px_6px_#d1d5db,inset_-3px_-3px_6px_#ffffff]">
              <Icon path={ICON_PATHS.check} size="lg" className="text-success" />
            </div>

            {transactionHash && (
              <div className="w-full rounded-xl p-3 shadow-[inset_2px_2px_4px_#d1d5db,inset_-2px_-2px_4px_#ffffff]">
                <p className="text-xs font-medium text-text-secondary mb-1.5">Transaction</p>
                <div className="flex items-center justify-center gap-2">
                  <span className="font-mono text-sm text-text-primary">
                    {truncateHash(transactionHash)}
                  </span>
                  <button
                    type="button"
                    onClick={copyTransactionHash}
                    aria-label={copied ? "Transaction hash copied" : "Copy transaction hash"}
                    title={copied ? "Copied!" : "Copy"}
                    className={cn(
                      "p-1.5 rounded-lg shrink-0 bg-white",
                      "shadow-[2px_2px_4px_#d1d5db,-2px_-2px_4px_#ffffff]",
                      "hover:shadow-[inset_2px_2px_4px_#d1d5db,inset_-2px_-2px_4px_#ffffff]",
                      "active:shadow-[inset_3px_3px_6px_#d1d5db,inset_-3px_-3px_6px_#ffffff]",
                      "transition-all duration-150",
                      copied && "shadow-[inset_2px_2px_4px_#d1d5db,inset_-2px_-2px_4px_#ffffff]"
                    )}
                  >
                    <Icon
                      path={copied ? ICON_PATHS.check : ICON_PATHS.copy}
                      size="sm"
                      className={copied ? "text-success" : "text-text-secondary"}
                    />
                  </button>
                </div>
              </div>
            )}

            <button type="button" onClick={onClose} className={cn(PRIMARY_BUTTON, "w-full justify-center")}>
              Done
            </button>
          </div>
        )}

        {state === "error" && error && (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center shadow-[inset_3px_3px_6px_#d1d5db,inset_-3px_-3px_6px_#ffffff]">
              <Icon path={ICON_PATHS.alertTriangle} size="lg" className="text-error" />
            </div>

            <p role="alert" className="text-sm text-text-secondary">
              {errorCopy(error).message}
            </p>

            <div className="flex gap-3 w-full">
              <button type="button" onClick={onRetry} className={cn(PRIMARY_BUTTON, "flex-1 justify-center")}>
                Retry
              </button>
              {error.code !== "XDR_EXPIRED" && (
                <button type="button" onClick={onClose} className={cn(DANGER_BUTTON, "flex-1 justify-center")}>
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
