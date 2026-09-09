"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { NEUMORPHIC_CARD, NEUMORPHIC_INSET, PRIMARY_BUTTON, DANGER_BUTTON } from "@/lib/styles";
import { Icon, ICON_PATHS, LoadingSpinner } from "@/components/ui/Icon";

export interface RefundModalProps {
  isOpen: boolean;
  /** Raw order amount; formatted here so callers never pass a pre-rounded value. */
  amount: string;
  /** Disables the form and both buttons while the refund request is in flight. */
  isProcessing: boolean;
  /** Set by the caller after a failed attempt; cleared automatically on the next submit. */
  error: string | null;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

const MIN_REASON_LENGTH = 10;

/**
 * Buyer-initiated refund request — the direct path (dispute + platform
 * resolution happen automatically), distinct from opening an admin dispute
 * for cases that need human review.
 */
export function RefundModal({
  isOpen,
  amount,
  isProcessing,
  error,
  onCancel,
  onConfirm,
}: RefundModalProps): React.JSX.Element | null {
  const [reason, setReason] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  if (!isOpen) return null;

  const payout = parseFloat(amount);

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();

    if (reason.trim().length < MIN_REASON_LENGTH) {
      setValidationError(`Please provide at least ${MIN_REASON_LENGTH} characters.`);
      return;
    }

    setValidationError(null);
    onConfirm(reason.trim());
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className={cn(NEUMORPHIC_CARD, "max-w-md w-full")}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-full bg-error/10 flex items-center justify-center">
            <Icon path={ICON_PATHS.currency} size="md" className="text-error" />
          </div>
          <h3 className="text-xl font-bold text-text-primary">Request Refund</h3>
        </div>

        <p className="text-text-secondary mb-4">
          This asks for{" "}
          <span className="font-semibold text-primary">${Number.isFinite(payout) ? payout.toFixed(2) : "0.00"}</span>{" "}
          back. The freelancer will not be paid for this order.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="refund-reason" className="mb-2 block text-sm font-medium text-text-primary">
              Reason for refund
            </label>
            <div className={cn("rounded-2xl", NEUMORPHIC_INSET)}>
              <textarea
                id="refund-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={4}
                disabled={isProcessing}
                placeholder="What happened? This helps us process the request."
                className="w-full resize-none bg-transparent p-4 text-text-primary outline-none placeholder:text-text-secondary/60"
              />
            </div>
          </div>

          {(validationError || error) && (
            <div role="alert" className="rounded-xl bg-error/10 p-3 text-sm text-error">
              {validationError ?? error}
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={isProcessing}
              className={cn(DANGER_BUTTON, "flex-1 justify-center")}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isProcessing}
              className={cn(PRIMARY_BUTTON, "flex-1 justify-center")}
            >
              {isProcessing ? (
                <>
                  <LoadingSpinner size="sm" />
                  <span>Processing...</span>
                </>
              ) : (
                <span>Request Refund</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
