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

export const SUCCESS_PROBABILITY_WEIGHTS = {
  x: 0.2,
  y: 0.25,
  z: 0.3,
  v: 0.1,
  w: 0.15,
} as const;

export const SUCCESS_PROBABILITY_THRESHOLD = 0.34;

export const RETURN_PROBABILITY_THRESHOLD = 0.18;

export const FRAUD_WEIGHTS = {
  complaintsLast30Days: 0.4,
  rejectionRate: 0.35,
  repeatBeneficiaryRatio: 0.25,
} as const;

export const FRAUD_MEDIUM_RISK_THRESHOLD = 0.14;

export const FRAUD_HIGH_RISK_THRESHOLD = 0.18;

export const FRAUD_SCORE_NORMALIZATION_DENOMINATOR =
  FRAUD_WEIGHTS.complaintsLast30Days +
  FRAUD_WEIGHTS.rejectionRate +
  FRAUD_WEIGHTS.repeatBeneficiaryRatio;

export const FRAUD_COMPLAINTS_30_DAY_CAP = 10;
