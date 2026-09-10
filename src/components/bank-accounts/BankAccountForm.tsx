"use client";

import { useId, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { NEUMORPHIC_INPUT, PRIMARY_BUTTON, ACTION_BUTTON_SUBTLE } from "@/lib/styles";
import { Icon, ICON_PATHS, LoadingSpinner } from "@/components/ui/Icon";
import { useAuthStore } from "@/stores/auth-store";
import {
  addBankAccount,
  SUPPORTED_CORRIDORS,
  SUPPORTED_CORRIDORS_REQUIRED_DETAILS,
  type AddBankAccountData,
  type BankAccount,
} from "@/lib/api/bank-accounts";

/** Emoji flag for each corridor country — no external flag library needed. */
export const COUNTRY_FLAGS: Record<string, string> = {
  BR: "🇧🇷",
  MX: "🇲🇽",
  AR: "🇦🇷",
  CO: "🇨🇴",
};

const COUNTRY_NAMES: Record<string, string> = {
  BR: "Brazil",
  MX: "Mexico",
  AR: "Argentina",
  CO: "Colombia",
};

// Real-shaped examples for each country's account number format, since a
// generic "1234567890" placeholder doesn't tell a freelancer whether MX
// expects an 18-digit CLABE or CO a plain account number.
const ACCOUNT_NUMBER_PLACEHOLDERS: Record<string, string> = {
  BR: "e.g. 00012345-6",
  MX: "e.g. 032180000118359719 (CLABE)",
  AR: "e.g. 0000003100010000000001 (CBU)",
  CO: "e.g. 1234567890",
};

function humanizeDetailKey(key: string): string {
  return key
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const SELECT_STYLES = cn(NEUMORPHIC_INPUT, "appearance-none cursor-pointer pr-10");

export interface BankAccountFormProps {
  /** Called once the account is created; the caller decides what happens next (close a modal, refresh a list). */
  onSuccess?: (account: BankAccount) => void;
  onCancel?: () => void;
  className?: string;
}

interface FormErrors {
  country?: string;
  rail?: string;
  accountNumber?: string;
  bankName?: string;
  holderName?: string;
  details?: Record<string, string | undefined>;
}

export function BankAccountForm({ onSuccess, onCancel, className }: BankAccountFormProps): React.JSX.Element {
  const token = useAuthStore((state) => state.token);
  const formId = useId();

  const countries = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const corridor of SUPPORTED_CORRIDORS) {
      if (!seen.has(corridor.country)) {
        seen.add(corridor.country);
        ordered.push(corridor.country);
      }
    }
    return ordered;
  }, []);

  const [country, setCountry] = useState(countries[0] ?? "");
  const railsForCountry = useMemo(
    () => SUPPORTED_CORRIDORS.filter((corridor) => corridor.country === country),
    [country]
  );
  const [rail, setRail] = useState(railsForCountry[0]?.rail ?? "");
  const [accountNumber, setAccountNumber] = useState("");
  const [bankName, setBankName] = useState("");
  const [holderName, setHolderName] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [details, setDetails] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const requiredDetailKeys = SUPPORTED_CORRIDORS_REQUIRED_DETAILS[rail] ?? [];

  function handleCountryChange(nextCountry: string) {
    setCountry(nextCountry);
    const firstRail = SUPPORTED_CORRIDORS.find((corridor) => corridor.country === nextCountry)?.rail ?? "";
    setRail(firstRail);
    setDetails({});
    setErrors({});
  }

  function handleRailChange(nextRail: string) {
    setRail(nextRail);
    setDetails({});
    setErrors((prev) => ({ ...prev, rail: undefined, details: undefined }));
  }

  function handleDetailChange(key: string, value: string) {
    setDetails((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev.details?.[key]) return prev;
      const nextDetailErrors = { ...prev.details, [key]: undefined };
      return { ...prev, details: nextDetailErrors };
    });
  }

  function validate(): boolean {
    const nextErrors: FormErrors = {};
    if (!country) nextErrors.country = "Select a country";
    if (!rail) nextErrors.rail = "Select a payout method";
    if (!accountNumber.trim()) nextErrors.accountNumber = "Enter the account number";
    if (!bankName.trim()) nextErrors.bankName = "Enter the bank name";
    if (!holderName.trim()) nextErrors.holderName = "Enter the account holder's name";

    const detailErrors: Record<string, string> = {};
    for (const key of requiredDetailKeys) {
      if (!details[key]?.trim()) {
        detailErrors[key] = `Enter ${humanizeDetailKey(key).toLowerCase()}`;
      }
    }
    if (Object.keys(detailErrors).length > 0) nextErrors.details = detailErrors;

    setErrors(nextErrors);
    return (
      !nextErrors.country &&
      !nextErrors.rail &&
      !nextErrors.accountNumber &&
      !nextErrors.bankName &&
      !nextErrors.holderName &&
      !nextErrors.details
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitError(null);
    if (!validate()) return;

    if (!token) {
      setSubmitError("Your session has expired. Please sign in again.");
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: AddBankAccountData = {
        country,
        rail,
        accountNumber: accountNumber.trim(),
        bankName: bankName.trim(),
        holderName: holderName.trim(),
        isDefault,
        ...(requiredDetailKeys.length > 0
          ? { details: Object.fromEntries(requiredDetailKeys.map((key) => [key, details[key]?.trim() ?? ""])) }
          : {}),
      };
      const account = await addBankAccount(token, payload);
      onSuccess?.(account);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Could not add this bank account.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const countryId = `${formId}-country`;
  const railId = `${formId}-rail`;
  const accountNumberId = `${formId}-account-number`;
  const bankNameId = `${formId}-bank-name`;
  const holderNameId = `${formId}-holder-name`;
  const isDefaultId = `${formId}-is-default`;

  return (
    <form onSubmit={handleSubmit} className={cn("space-y-4", className)} noValidate>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor={countryId} className="block text-sm font-medium text-text-primary mb-2">
            Country
          </label>
          <div className="relative">
            <select
              id={countryId}
              value={country}
              onChange={(event) => handleCountryChange(event.target.value)}
              className={SELECT_STYLES}
              aria-invalid={Boolean(errors.country)}
              aria-describedby={errors.country ? `${countryId}-error` : undefined}
            >
              {countries.map((code) => (
                <option key={code} value={code}>
                  {COUNTRY_FLAGS[code]} {COUNTRY_NAMES[code] ?? code}
                </option>
              ))}
            </select>
            <Icon
              path={ICON_PATHS.chevronDown}
              size="sm"
              className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-text-secondary"
            />
          </div>
          {errors.country && (
            <p id={`${countryId}-error`} className="mt-1.5 text-xs text-error">
              {errors.country}
            </p>
          )}
        </div>

        <div>
          <label htmlFor={railId} className="block text-sm font-medium text-text-primary mb-2">
            Payout method
          </label>
          <div className="relative">
            <select
              id={railId}
              value={rail}
              onChange={(event) => handleRailChange(event.target.value)}
              className={SELECT_STYLES}
              aria-invalid={Boolean(errors.rail)}
              aria-describedby={errors.rail ? `${railId}-error` : undefined}
            >
              {railsForCountry.map((corridor) => (
                <option key={corridor.rail} value={corridor.rail}>
                  {corridor.label}
                </option>
              ))}
            </select>
            <Icon
              path={ICON_PATHS.chevronDown}
              size="sm"
              className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-text-secondary"
            />
          </div>
          {errors.rail && (
            <p id={`${railId}-error`} className="mt-1.5 text-xs text-error">
              {errors.rail}
            </p>
          )}
        </div>
      </div>

      <div>
        <label htmlFor={accountNumberId} className="block text-sm font-medium text-text-primary mb-2">
          Account number
        </label>
        <input
          id={accountNumberId}
          type="text"
          value={accountNumber}
          onChange={(event) => setAccountNumber(event.target.value)}
          placeholder={ACCOUNT_NUMBER_PLACEHOLDERS[country] ?? "Account number"}
          className={cn(NEUMORPHIC_INPUT, errors.accountNumber && "ring-2 ring-error/50")}
          aria-invalid={Boolean(errors.accountNumber)}
          aria-describedby={errors.accountNumber ? `${accountNumberId}-error` : undefined}
        />
        {errors.accountNumber && (
          <p id={`${accountNumberId}-error`} className="mt-1.5 text-xs text-error">
            {errors.accountNumber}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor={bankNameId} className="block text-sm font-medium text-text-primary mb-2">
            Bank name
          </label>
          <input
            id={bankNameId}
            type="text"
            value={bankName}
            onChange={(event) => setBankName(event.target.value)}
            placeholder="e.g. Banco do Brasil"
            className={cn(NEUMORPHIC_INPUT, errors.bankName && "ring-2 ring-error/50")}
            aria-invalid={Boolean(errors.bankName)}
            aria-describedby={errors.bankName ? `${bankNameId}-error` : undefined}
          />
          {errors.bankName && (
            <p id={`${bankNameId}-error`} className="mt-1.5 text-xs text-error">
              {errors.bankName}
            </p>
          )}
        </div>

        <div>
          <label htmlFor={holderNameId} className="block text-sm font-medium text-text-primary mb-2">
            Account holder name
          </label>
          <input
            id={holderNameId}
            type="text"
            value={holderName}
            onChange={(event) => setHolderName(event.target.value)}
            placeholder="Full name on the account"
            className={cn(NEUMORPHIC_INPUT, errors.holderName && "ring-2 ring-error/50")}
            aria-invalid={Boolean(errors.holderName)}
            aria-describedby={errors.holderName ? `${holderNameId}-error` : undefined}
          />
          {errors.holderName && (
            <p id={`${holderNameId}-error`} className="mt-1.5 text-xs text-error">
              {errors.holderName}
            </p>
          )}
        </div>
      </div>

      {requiredDetailKeys.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {requiredDetailKeys.map((key) => {
            const detailId = `${formId}-detail-${key}`;
            const detailError = errors.details?.[key];
            return (
              <div key={key}>
                <label htmlFor={detailId} className="block text-sm font-medium text-text-primary mb-2">
                  {humanizeDetailKey(key)}
                </label>
                <input
                  id={detailId}
                  type="text"
                  value={details[key] ?? ""}
                  onChange={(event) => handleDetailChange(key, event.target.value)}
                  className={cn(NEUMORPHIC_INPUT, detailError && "ring-2 ring-error/50")}
                  aria-invalid={Boolean(detailError)}
                  aria-describedby={detailError ? `${detailId}-error` : undefined}
                />
                {detailError && (
                  <p id={`${detailId}-error`} className="mt-1.5 text-xs text-error">
                    {detailError}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-2.5">
        <input
          id={isDefaultId}
          type="checkbox"
          checked={isDefault}
          onChange={(event) => setIsDefault(event.target.checked)}
          className="w-4 h-4 rounded accent-primary cursor-pointer"
        />
        <label htmlFor={isDefaultId} className="text-sm text-text-primary cursor-pointer">
          Set as default payout account
        </label>
      </div>

      {submitError && (
        <p role="alert" className="text-sm text-error">
          {submitError}
        </p>
      )}

      <div className="flex gap-3 pt-1">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className={cn(ACTION_BUTTON_SUBTLE, "w-auto cursor-pointer disabled:cursor-not-allowed")}
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={isSubmitting}
          className={cn(PRIMARY_BUTTON, "flex-1 justify-center")}
        >
          {isSubmitting ? (
            <span className="flex items-center justify-center gap-2">
              <LoadingSpinner size="sm" />
              Adding account...
            </span>
          ) : (
            "Add bank account"
          )}
        </button>
      </div>
    </form>
  );
}
