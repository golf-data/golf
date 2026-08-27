export function requireSpendConfirmation(
  confirmSpend: boolean,
  credits: number,
  toolName: string,
): void {
  if (!confirmSpend) {
    throw new Error(
      `${toolName} costs ${credits} credit${credits === 1 ? "" : "s"}. ` +
        "Set confirm_spend=true to confirm this paid API call.",
    );
  }
}
