"use client";

import { useEffect, useId, useState } from "react";
import { cn } from "@/lib/cn";
import { NEUMORPHIC_INPUT, PRIMARY_BUTTON, ACTION_BUTTON_SUBTLE } from "@/lib/styles";
import { Icon, ICON_PATHS, LoadingSpinner } from "@/components/ui/Icon";
import { useAuthStore } from "@/stores/auth-store";
import { COUNTRY_FLAGS } from "@/components/bank-accounts/BankAccountForm";
import { KycFileUploadField } from "@/components/kyc/KycFileUploadField";
import { getProfile } from "@/lib/api/profile";
import {
  submitKyc,
  requiresEnhancedKyc,
  type KycProfile,
  type SubmitKycData,
  type KycIdDocType,
  type ProofOfAddressDocType,
  type SourceOfFundsDocType,
  type PurposeOfTransactions,
} from "@/lib/api/kyc";

const KYC_COUNTRY_NAMES: Record<string, string> = {
  BR: "Brazil",
  MX: "Mexico",
  AR: "Argentina",
  CO: "Colombia",
};
const KYC_COUNTRIES = Object.keys(KYC_COUNTRY_NAMES);

const ID_DOC_TYPES: { value: KycIdDocType; label: string }[] = [
  { value: "PASSPORT", label: "Passport" },
  { value: "ID_CARD", label: "National ID card" },
  { value: "DRIVERS", label: "Driver's license" },
];

const PROOF_OF_ADDRESS_TYPES: { value: ProofOfAddressDocType; label: string }[] = [
  { value: "UTILITY_BILL", label: "Utility bill" },
  { value: "BANK_STATEMENT", label: "Bank statement" },
  { value: "RENTAL_AGREEMENT", label: "Rental agreement" },
  { value: "TAX_DOCUMENT", label: "Tax document" },
  { value: "GOVERNMENT_CORRESPONDENCE", label: "Government correspondence" },
];

const SOURCE_OF_FUNDS_TYPES: { value: SourceOfFundsDocType; label: string }[] = [
  { value: "salary", label: "Salary" },
  { value: "business_income", label: "Business income" },
  { value: "savings", label: "Savings" },
  { value: "investment_proceeds", label: "Investment proceeds" },
  { value: "investment_loans", label: "Investment loans" },
  { value: "pension_retirement", label: "Pension / retirement" },
  { value: "sale_of_assets_real_estate", label: "Sale of assets / real estate" },
  { value: "gifts", label: "Gifts" },
  { value: "inheritance", label: "Inheritance" },
  { value: "government_benefits", label: "Government benefits" },
  { value: "gambling_proceeds", label: "Gambling proceeds" },
  { value: "esops", label: "ESOPs" },
  { value: "someone_else_funds", label: "Someone else's funds" },
];

const PURPOSE_OF_TRANSACTIONS: { value: PurposeOfTransactions; label: string }[] = [
  { value: "receive_payment_for_freelancing", label: "Receive payment for freelancing" },
  { value: "receive_salary", label: "Receive salary" },
  { value: "personal_or_living_expenses", label: "Personal or living expenses" },
  { value: "business_transactions", label: "Business transactions" },
  { value: "payments_to_friends_or_family_abroad", label: "Payments to friends or family abroad" },
  { value: "investment_purposes", label: "Investment purposes" },
  { value: "protect_wealth", label: "Protect wealth" },
  { value: "purchase_good_and_services", label: "Purchase goods and services" },
  { value: "charitable_donations", label: "Charitable donations" },
  { value: "other", label: "Other" },
];

const SELECT_STYLES = cn(NEUMORPHIC_INPUT, "appearance-none cursor-pointer pr-10");

export interface KycFormProps {
  /** Pre-fills the form when the user already has a profile — resubmitting updates it in place. */
  existingProfile?: KycProfile | null;
  onSuccess?: (profile: KycProfile) => void;
  onCancel?: () => void;
  className?: string;
}

interface FormFields {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  country: string;
  taxId: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  stateProvinceRegion: string;
  postalCode: string;
  idDocCountry: string;
  idDocType: KycIdDocType;
  selfieFileUrl: string;
  idDocFrontFileUrl: string;
  idDocBackFileUrl: string;
  proofOfAddressDocType: ProofOfAddressDocType | "";
  proofOfAddressDocFileUrl: string;
  sourceOfFundsDocType: SourceOfFundsDocType | "";
  sourceOfFundsDocFileUrl: string;
  purposeOfTransactions: PurposeOfTransactions | "";
  purposeOfTransactionsExplanation: string;
}

interface CurrentUserNames {
  firstName?: string | null;
  lastName?: string | null;
}

function initialFields(existing?: KycProfile | null, currentUser?: CurrentUserNames | null): FormFields {
  return {
    firstName: currentUser?.firstName ?? "",
    lastName: currentUser?.lastName ?? "",
    dateOfBirth: "",
    country: existing?.country ?? KYC_COUNTRIES[0],
    taxId: existing?.taxId ?? "",
    addressLine1: existing?.addressLine1 ?? "",
    addressLine2: existing?.addressLine2 ?? "",
    city: existing?.city ?? "",
    stateProvinceRegion: existing?.stateProvinceRegion ?? "",
    postalCode: existing?.postalCode ?? "",
    idDocCountry: existing?.idDocCountry ?? KYC_COUNTRIES[0],
    idDocType: existing?.idDocType ?? "PASSPORT",
    selfieFileUrl: existing?.selfieFileUrl ?? "",
    idDocFrontFileUrl: existing?.idDocFrontFileUrl ?? "",
    idDocBackFileUrl: existing?.idDocBackFileUrl ?? "",
    proofOfAddressDocType: existing?.proofOfAddressDocType ?? "",
    proofOfAddressDocFileUrl: existing?.proofOfAddressDocFileUrl ?? "",
    sourceOfFundsDocType: existing?.sourceOfFundsDocType ?? "",
    sourceOfFundsDocFileUrl: existing?.sourceOfFundsDocFileUrl ?? "",
    purposeOfTransactions: existing?.purposeOfTransactions ?? "",
    purposeOfTransactionsExplanation: existing?.purposeOfTransactionsExplanation ?? "",
  };
}

type FormErrors = Partial<Record<keyof FormFields, string>>;

export function KycForm({ existingProfile, onSuccess, onCancel, className }: KycFormProps): React.JSX.Element {
  const token = useAuthStore((state) => state.token);
  const currentUser = useAuthStore((state) => state.user);
  const formId = useId();

  const [fields, setFields] = useState<FormFields>(() => initialFields(existingProfile, currentUser));
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // dateOfBirth lives on the User record, not the KycProfile this form
  // otherwise prefills from, and the auth store's cached user doesn't carry
  // it either — so re-opening "Edit information" always showed it blank even
  // though it was saved correctly. Fetching the profile once per mount fixes
  // that; firstName/lastName are re-filled the same way in case the auth
  // store's cache is stale, but never overwrite anything already typed.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    getProfile(token)
      .then((profile) => {
        if (cancelled) return;
        setFields((prev) => ({
          ...prev,
          firstName: prev.firstName || profile.firstName || "",
          lastName: prev.lastName || profile.lastName || "",
          dateOfBirth: prev.dateOfBirth || profile.dateOfBirth?.slice(0, 10) || "",
        }));
      })
      .catch(() => {
        /* best-effort prefill only — the fields just stay editable and empty */
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const isEnhanced = requiresEnhancedKyc(fields.country);

  function set<K extends keyof FormFields>(key: K, value: FormFields[K]) {
    setFields((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  }

  function validate(): boolean {
    const next: FormErrors = {};
    if (!fields.firstName.trim()) next.firstName = "Enter your first name";
    if (!fields.lastName.trim()) next.lastName = "Enter your last name";
    if (!fields.dateOfBirth) next.dateOfBirth = "Enter your date of birth";
    if (!fields.taxId.trim()) next.taxId = "Enter your tax ID";
    if (!fields.addressLine1.trim()) next.addressLine1 = "Enter your address";
    if (!fields.city.trim()) next.city = "Enter your city";
    if (!fields.stateProvinceRegion.trim()) next.stateProvinceRegion = "Enter your state/province";
    if (!fields.postalCode.trim()) next.postalCode = "Enter your postal code";
    if (!fields.selfieFileUrl) next.selfieFileUrl = "Upload a selfie";
    if (!fields.idDocFrontFileUrl) next.idDocFrontFileUrl = "Upload the front of your ID document";

    if (isEnhanced) {
      if (!fields.proofOfAddressDocType) next.proofOfAddressDocType = "Select a document type";
      if (!fields.proofOfAddressDocFileUrl) next.proofOfAddressDocFileUrl = "Upload a proof of address";
      if (!fields.sourceOfFundsDocType) next.sourceOfFundsDocType = "Select a source of funds";
      if (!fields.sourceOfFundsDocFileUrl) next.sourceOfFundsDocFileUrl = "Upload a source-of-funds document";
      if (!fields.purposeOfTransactions) next.purposeOfTransactions = "Select a purpose";
      if (fields.purposeOfTransactions === "other" && !fields.purposeOfTransactionsExplanation.trim()) {
        next.purposeOfTransactionsExplanation = "Explain the purpose of your transactions";
      }
    }

    setErrors(next);
    return Object.keys(next).length === 0;
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
      const payload: SubmitKycData = {
        firstName: fields.firstName.trim(),
        lastName: fields.lastName.trim(),
        dateOfBirth: fields.dateOfBirth,
        country: fields.country,
        taxId: fields.taxId.trim(),
        addressLine1: fields.addressLine1.trim(),
        addressLine2: fields.addressLine2.trim() || undefined,
        city: fields.city.trim(),
        stateProvinceRegion: fields.stateProvinceRegion.trim(),
        postalCode: fields.postalCode.trim(),
        idDocCountry: fields.idDocCountry,
        idDocType: fields.idDocType,
        selfieFileUrl: fields.selfieFileUrl,
        idDocFrontFileUrl: fields.idDocFrontFileUrl,
        idDocBackFileUrl: fields.idDocBackFileUrl || undefined,
        ...(isEnhanced
          ? {
              proofOfAddressDocType: fields.proofOfAddressDocType || undefined,
              proofOfAddressDocFileUrl: fields.proofOfAddressDocFileUrl || undefined,
              sourceOfFundsDocType: fields.sourceOfFundsDocType || undefined,
              sourceOfFundsDocFileUrl: fields.sourceOfFundsDocFileUrl || undefined,
              purposeOfTransactions: fields.purposeOfTransactions || undefined,
              purposeOfTransactionsExplanation: fields.purposeOfTransactionsExplanation.trim() || undefined,
            }
          : {}),
      };
      const profile = await submitKyc(token, payload);
      onSuccess?.(profile);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Could not submit your KYC profile.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const ids = {
    firstName: `${formId}-first-name`,
    lastName: `${formId}-last-name`,
    dateOfBirth: `${formId}-dob`,
    country: `${formId}-country`,
    taxId: `${formId}-tax-id`,
    addressLine1: `${formId}-address-1`,
    addressLine2: `${formId}-address-2`,
    city: `${formId}-city`,
    stateProvinceRegion: `${formId}-state`,
    postalCode: `${formId}-postal`,
    idDocType: `${formId}-id-doc-type`,
    proofOfAddressDocType: `${formId}-poa-type`,
    sourceOfFundsDocType: `${formId}-sof-type`,
    purposeOfTransactions: `${formId}-purpose`,
    purposeOfTransactionsExplanation: `${formId}-purpose-explanation`,
  };

  return (
    <form onSubmit={handleSubmit} className={cn("space-y-4", className)} noValidate>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor={ids.firstName} className="block text-sm font-medium text-text-primary mb-2">
            First name
          </label>
          <input
            id={ids.firstName}
            type="text"
            value={fields.firstName}
            onChange={(event) => set("firstName", event.target.value)}
            className={cn(NEUMORPHIC_INPUT, errors.firstName && "ring-2 ring-error/50")}
            aria-invalid={Boolean(errors.firstName)}
          />
          {errors.firstName && <p className="mt-1.5 text-xs text-error">{errors.firstName}</p>}
        </div>
        <div>
          <label htmlFor={ids.lastName} className="block text-sm font-medium text-text-primary mb-2">
            Last name
          </label>
          <input
            id={ids.lastName}
            type="text"
            value={fields.lastName}
            onChange={(event) => set("lastName", event.target.value)}
            className={cn(NEUMORPHIC_INPUT, errors.lastName && "ring-2 ring-error/50")}
            aria-invalid={Boolean(errors.lastName)}
          />
          {errors.lastName && <p className="mt-1.5 text-xs text-error">{errors.lastName}</p>}
        </div>
      </div>

      <div>
        <label htmlFor={ids.dateOfBirth} className="block text-sm font-medium text-text-primary mb-2">
          Date of birth
        </label>
        <input
          id={ids.dateOfBirth}
          type="date"
          value={fields.dateOfBirth}
          onChange={(event) => set("dateOfBirth", event.target.value)}
          className={cn(NEUMORPHIC_INPUT, errors.dateOfBirth && "ring-2 ring-error/50")}
          aria-invalid={Boolean(errors.dateOfBirth)}
        />
        {errors.dateOfBirth && <p className="mt-1.5 text-xs text-error">{errors.dateOfBirth}</p>}
      </div>

      <div>
        <label htmlFor={ids.country} className="block text-sm font-medium text-text-primary mb-2">
          Country
        </label>
        <div className="relative">
          <select
            id={ids.country}
            value={fields.country}
            onChange={(event) => {
              set("country", event.target.value);
              set("idDocCountry", event.target.value);
            }}
            className={SELECT_STYLES}
          >
            {KYC_COUNTRIES.map((code) => (
              <option key={code} value={code}>
                {COUNTRY_FLAGS[code]} {KYC_COUNTRY_NAMES[code]}
              </option>
            ))}
          </select>
          <Icon
            path={ICON_PATHS.chevronDown}
            size="sm"
            className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-text-secondary"
          />
        </div>
        {isEnhanced && (
          <p className="mt-1.5 text-xs text-text-secondary">
            BlindPay requires additional documents for this corridor — manual review can take up to 1 business day.
          </p>
        )}
      </div>

      <div>
        <label htmlFor={ids.taxId} className="block text-sm font-medium text-text-primary mb-2">
          Tax ID
        </label>
        <input
          id={ids.taxId}
          type="text"
          value={fields.taxId}
          onChange={(event) => set("taxId", event.target.value)}
          className={cn(NEUMORPHIC_INPUT, errors.taxId && "ring-2 ring-error/50")}
          aria-invalid={Boolean(errors.taxId)}
        />
        {errors.taxId && <p className="mt-1.5 text-xs text-error">{errors.taxId}</p>}
      </div>

      <div>
        <label htmlFor={ids.addressLine1} className="block text-sm font-medium text-text-primary mb-2">
          Address line 1
        </label>
        <input
          id={ids.addressLine1}
          type="text"
          value={fields.addressLine1}
          onChange={(event) => set("addressLine1", event.target.value)}
          className={cn(NEUMORPHIC_INPUT, errors.addressLine1 && "ring-2 ring-error/50")}
          aria-invalid={Boolean(errors.addressLine1)}
        />
        {errors.addressLine1 && <p className="mt-1.5 text-xs text-error">{errors.addressLine1}</p>}
      </div>

      <div>
        <label htmlFor={ids.addressLine2} className="block text-sm font-medium text-text-primary mb-2">
          Address line 2 <span className="text-text-secondary font-normal">(optional)</span>
        </label>
        <input
          id={ids.addressLine2}
          type="text"
          value={fields.addressLine2}
          onChange={(event) => set("addressLine2", event.target.value)}
          className={NEUMORPHIC_INPUT}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label htmlFor={ids.city} className="block text-sm font-medium text-text-primary mb-2">
            City
          </label>
          <input
            id={ids.city}
            type="text"
            value={fields.city}
            onChange={(event) => set("city", event.target.value)}
            className={cn(NEUMORPHIC_INPUT, errors.city && "ring-2 ring-error/50")}
            aria-invalid={Boolean(errors.city)}
          />
          {errors.city && <p className="mt-1.5 text-xs text-error">{errors.city}</p>}
        </div>
        <div>
          <label htmlFor={ids.stateProvinceRegion} className="block text-sm font-medium text-text-primary mb-2">
            State / Province
          </label>
          <input
            id={ids.stateProvinceRegion}
            type="text"
            value={fields.stateProvinceRegion}
            onChange={(event) => set("stateProvinceRegion", event.target.value)}
            className={cn(NEUMORPHIC_INPUT, errors.stateProvinceRegion && "ring-2 ring-error/50")}
            aria-invalid={Boolean(errors.stateProvinceRegion)}
          />
          {errors.stateProvinceRegion && <p className="mt-1.5 text-xs text-error">{errors.stateProvinceRegion}</p>}
        </div>
        <div>
          <label htmlFor={ids.postalCode} className="block text-sm font-medium text-text-primary mb-2">
            Postal code
          </label>
          <input
            id={ids.postalCode}
            type="text"
            value={fields.postalCode}
            onChange={(event) => set("postalCode", event.target.value)}
            className={cn(NEUMORPHIC_INPUT, errors.postalCode && "ring-2 ring-error/50")}
            aria-invalid={Boolean(errors.postalCode)}
          />
          {errors.postalCode && <p className="mt-1.5 text-xs text-error">{errors.postalCode}</p>}
        </div>
      </div>

      <div>
        <label htmlFor={ids.idDocType} className="block text-sm font-medium text-text-primary mb-2">
          ID document type
        </label>
        <div className="relative">
          <select
            id={ids.idDocType}
            value={fields.idDocType}
            onChange={(event) => set("idDocType", event.target.value as KycIdDocType)}
            className={SELECT_STYLES}
          >
            {ID_DOC_TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <Icon
            path={ICON_PATHS.chevronDown}
            size="sm"
            className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-text-secondary"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <KycFileUploadField
          label="Selfie"
          value={fields.selfieFileUrl || undefined}
          onChange={(url) => set("selfieFileUrl", url)}
          error={errors.selfieFileUrl}
        />
        <KycFileUploadField
          label="ID document — front"
          value={fields.idDocFrontFileUrl || undefined}
          onChange={(url) => set("idDocFrontFileUrl", url)}
          error={errors.idDocFrontFileUrl}
        />
      </div>
      <KycFileUploadField
        label="ID document — back"
        value={fields.idDocBackFileUrl || undefined}
        onChange={(url) => set("idDocBackFileUrl", url)}
        optional
      />

      {isEnhanced && (
        <div className="space-y-4 border-t border-black/5 pt-4">
          <p className="text-sm font-medium text-text-primary">Additional documents for Colombia</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor={ids.proofOfAddressDocType} className="block text-sm font-medium text-text-primary mb-2">
                Proof of address type
              </label>
              <div className="relative">
                <select
                  id={ids.proofOfAddressDocType}
                  value={fields.proofOfAddressDocType}
                  onChange={(event) => set("proofOfAddressDocType", event.target.value as ProofOfAddressDocType)}
                  className={SELECT_STYLES}
                  aria-invalid={Boolean(errors.proofOfAddressDocType)}
                >
                  <option value="" disabled>
                    Select one
                  </option>
                  {PROOF_OF_ADDRESS_TYPES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <Icon
                  path={ICON_PATHS.chevronDown}
                  size="sm"
                  className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-text-secondary"
                />
              </div>
              {errors.proofOfAddressDocType && (
                <p className="mt-1.5 text-xs text-error">{errors.proofOfAddressDocType}</p>
              )}
            </div>
            <KycFileUploadField
              label="Proof of address document"
              value={fields.proofOfAddressDocFileUrl || undefined}
              onChange={(url) => set("proofOfAddressDocFileUrl", url)}
              error={errors.proofOfAddressDocFileUrl}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor={ids.sourceOfFundsDocType} className="block text-sm font-medium text-text-primary mb-2">
                Source of funds
              </label>
              <div className="relative">
                <select
                  id={ids.sourceOfFundsDocType}
                  value={fields.sourceOfFundsDocType}
                  onChange={(event) => set("sourceOfFundsDocType", event.target.value as SourceOfFundsDocType)}
                  className={SELECT_STYLES}
                  aria-invalid={Boolean(errors.sourceOfFundsDocType)}
                >
                  <option value="" disabled>
                    Select one
                  </option>
                  {SOURCE_OF_FUNDS_TYPES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <Icon
                  path={ICON_PATHS.chevronDown}
                  size="sm"
                  className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-text-secondary"
                />
              </div>
              {errors.sourceOfFundsDocType && (
                <p className="mt-1.5 text-xs text-error">{errors.sourceOfFundsDocType}</p>
              )}
            </div>
            <KycFileUploadField
              label="Source-of-funds document"
              value={fields.sourceOfFundsDocFileUrl || undefined}
              onChange={(url) => set("sourceOfFundsDocFileUrl", url)}
              error={errors.sourceOfFundsDocFileUrl}
            />
          </div>

          <div>
            <label htmlFor={ids.purposeOfTransactions} className="block text-sm font-medium text-text-primary mb-2">
              Purpose of transactions
            </label>
            <div className="relative">
              <select
                id={ids.purposeOfTransactions}
                value={fields.purposeOfTransactions}
                onChange={(event) => set("purposeOfTransactions", event.target.value as PurposeOfTransactions)}
                className={SELECT_STYLES}
                aria-invalid={Boolean(errors.purposeOfTransactions)}
              >
                <option value="" disabled>
                  Select one
                </option>
                {PURPOSE_OF_TRANSACTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <Icon
                path={ICON_PATHS.chevronDown}
                size="sm"
                className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-text-secondary"
              />
            </div>
            {errors.purposeOfTransactions && (
              <p className="mt-1.5 text-xs text-error">{errors.purposeOfTransactions}</p>
            )}
          </div>

          {fields.purposeOfTransactions === "other" && (
            <div>
              <label
                htmlFor={ids.purposeOfTransactionsExplanation}
                className="block text-sm font-medium text-text-primary mb-2"
              >
                Explain the purpose
              </label>
              <input
                id={ids.purposeOfTransactionsExplanation}
                type="text"
                value={fields.purposeOfTransactionsExplanation}
                onChange={(event) => set("purposeOfTransactionsExplanation", event.target.value)}
                className={cn(NEUMORPHIC_INPUT, errors.purposeOfTransactionsExplanation && "ring-2 ring-error/50")}
                aria-invalid={Boolean(errors.purposeOfTransactionsExplanation)}
              />
              {errors.purposeOfTransactionsExplanation && (
                <p className="mt-1.5 text-xs text-error">{errors.purposeOfTransactionsExplanation}</p>
              )}
            </div>
          )}
        </div>
      )}

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
        <button type="submit" disabled={isSubmitting} className={cn(PRIMARY_BUTTON, "flex-1 justify-center")}>
          {isSubmitting ? (
            <span className="flex items-center justify-center gap-2">
              <LoadingSpinner size="sm" />
              Submitting...
            </span>
          ) : existingProfile ? (
            "Update KYC information"
          ) : (
            "Submit KYC information"
          )}
        </button>
      </div>
    </form>
  );
}
