import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BankAccountForm } from "@/components/bank-accounts/BankAccountForm";

const mockAddBankAccount = vi.fn();

vi.mock("@/lib/api/bank-accounts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/bank-accounts")>();
  return {
    ...actual,
    addBankAccount: (...args: unknown[]) => mockAddBankAccount(...args),
  };
});

vi.mock("@/stores/auth-store", () => ({
  useAuthStore: (selector: (s: { token: string | null }) => unknown) => selector({ token: "jwt-token" }),
}));

const NEW_ACCOUNT = {
  id: "ba_1",
  userId: "usr_1",
  country: "MX",
  rail: "SPEI_BITSO",
  accountNumber: "032180000118359719",
  bankName: "BBVA",
  holderName: "Jane Doe",
  blindpayBankAccountId: null,
  isDefault: false,
  details: { spei_protocol: "clabe" },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BankAccountForm", () => {
  it("defaults to the first corridor's country and rail", () => {
    render(<BankAccountForm />);
    expect(screen.getByLabelText("Country")).toHaveValue("BR");
    expect(screen.getByLabelText("Payout method")).toHaveValue("PIX");
  });

  it("updates the rail options when the country changes", async () => {
    const user = userEvent.setup();
    render(<BankAccountForm />);

    await user.selectOptions(screen.getByLabelText("Country"), "MX");

    const railSelect = screen.getByLabelText("Payout method") as HTMLSelectElement;
    expect(railSelect).toHaveValue("SPEI_BITSO");
    expect(Array.from(railSelect.options).map((o) => o.value)).toEqual(["SPEI_BITSO"]);
  });

  it("shows rail-specific detail fields and requires them", async () => {
    const user = userEvent.setup();
    render(<BankAccountForm />);

    await user.selectOptions(screen.getByLabelText("Country"), "BR");
    await user.selectOptions(screen.getByLabelText("Payout method"), "PIX_SAFE");

    expect(screen.getByLabelText("Account Type")).toBeInTheDocument();
    expect(screen.getByLabelText("Pix Safe Bank Code")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add bank account" }));

    expect(await screen.findByText("Enter account type")).toBeInTheDocument();
    expect(mockAddBankAccount).not.toHaveBeenCalled();
  });

  it("blocks submission and reports errors when required fields are empty", async () => {
    const user = userEvent.setup();
    render(<BankAccountForm />);

    await user.click(screen.getByRole("button", { name: "Add bank account" }));

    expect(await screen.findByText("Enter the account number")).toBeInTheDocument();
    expect(screen.getByText("Enter the bank name")).toBeInTheDocument();
    expect(screen.getByText("Enter the account holder's name")).toBeInTheDocument();
    expect(mockAddBankAccount).not.toHaveBeenCalled();
  });

  it("submits a valid account and reports the created account", async () => {
    mockAddBankAccount.mockResolvedValue(NEW_ACCOUNT);
    const onSuccess = vi.fn();
    const user = userEvent.setup();
    render(<BankAccountForm onSuccess={onSuccess} />);

    await user.selectOptions(screen.getByLabelText("Country"), "MX");
    await user.type(screen.getByLabelText("Account number"), "032180000118359719");
    await user.type(screen.getByLabelText("Bank name"), "BBVA");
    await user.type(screen.getByLabelText("Account holder name"), "Jane Doe");
    await user.type(screen.getByLabelText("Spei Protocol"), "clabe");
    await user.click(screen.getByLabelText("Set as default payout account"));

    await user.click(screen.getByRole("button", { name: "Add bank account" }));

    await waitFor(() =>
      expect(mockAddBankAccount).toHaveBeenCalledWith("jwt-token", {
        country: "MX",
        rail: "SPEI_BITSO",
        accountNumber: "032180000118359719",
        bankName: "BBVA",
        holderName: "Jane Doe",
        isDefault: true,
        details: { spei_protocol: "clabe" },
      })
    );
    expect(onSuccess).toHaveBeenCalledWith(NEW_ACCOUNT);
  });

  it("surfaces an API error without losing the entered data", async () => {
    mockAddBankAccount.mockRejectedValue(new Error("BlindPay rejected this account"));
    const user = userEvent.setup();
    render(<BankAccountForm />);

    await user.type(screen.getByLabelText("Account number"), "00012345-6");
    await user.type(screen.getByLabelText("Bank name"), "Banco do Brasil");
    await user.type(screen.getByLabelText("Account holder name"), "Jane Doe");
    await user.type(screen.getByLabelText("Pix Key"), "jane@example.com");

    await user.click(screen.getByRole("button", { name: "Add bank account" }));

    expect(await screen.findByText("BlindPay rejected this account")).toBeInTheDocument();
    expect(screen.getByLabelText("Bank name")).toHaveValue("Banco do Brasil");
  });

  it("calls onCancel when the cancel button is used", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<BankAccountForm onCancel={onCancel} />);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
