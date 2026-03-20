export const RAISE_CODES = ["B", "WC", "FC", "FB"] as const;
export const ACCEPT_CODES = ["A", "WA", "FCA", "FA"] as const;
export const REJECT_CODES = ["R", "WR", "FCR", "FR"] as const;
export const RE_RAISE_CODES = ["FP", "P"] as const;
export const RE_RAISE_ACCEPT_CODES = ["AP", "FAP"] as const;
export const RE_RAISE_REJECT_CODES = ["PR", "FPR"] as const;
export const REFUND_CODES = ["C", "REF", "RET"] as const;

export const SUCCESS_CODES = [
  ...ACCEPT_CODES,
  ...RE_RAISE_ACCEPT_CODES,
  ...REFUND_CODES,
] as const;

export const FINAL_REJECTION_CODES = [
  ...REJECT_CODES,
  ...RE_RAISE_REJECT_CODES,
] as const;

export const DISPUTE_ACCEPTANCE_CODES = [
  ...ACCEPT_CODES,
  ...RE_RAISE_ACCEPT_CODES,
] as const;
