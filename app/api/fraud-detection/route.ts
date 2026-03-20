import { NextRequest, NextResponse } from "next/server";
import { db } from "@/app/lib/db";
import {
  FRAUD_COMPLAINTS_30_DAY_CAP,
  FRAUD_HIGH_RISK_THRESHOLD,
  FRAUD_MEDIUM_RISK_THRESHOLD,
  FRAUD_SCORE_NORMALIZATION_DENOMINATOR,
  FRAUD_WEIGHTS,
} from "@/app/lib/chargeback";

type FraudRow = {
  total_complaints: number | string | null;
  complaints_last_30_days: number | string | null;
  rejected_complaints: number | string | null;
  disputes_to_same_beneficiary: number | string | null;
};

function toNumber(value: number | string | null | undefined) {
  if (value == null) {
    return 0;
  }

  if (typeof value === "number") {
    return value;
  }

  return Number(value);
}

function round(value: number, places = 4) {
  return Number(value.toFixed(places));
}

export async function GET(request: NextRequest) {
  const customerAccountNumber =
    request.nextUrl.searchParams.get("customerAccountNumber")?.trim() ??
    request.nextUrl.searchParams.get("customer")?.trim() ??
    "";
  const beneficiaryAccountNumber =
    request.nextUrl.searchParams.get("beneficiaryAccountNumber")?.trim() ??
    request.nextUrl.searchParams.get("beneficiary")?.trim() ??
    "";

  if (!customerAccountNumber || !beneficiaryAccountNumber) {
    return NextResponse.json(
      {
        success: false,
        error:
          "customerAccountNumber and beneficiaryAccountNumber are required",
      },
      { status: 400 }
    );
  }

  try {
    const [rows] = await db.query<FraudRow[]>(
      `
        SELECT
          COUNT(*) AS total_complaints,
          COALESCE(SUM(CASE
            WHEN transaction_date >= datetime('now', '-30 days')
            THEN 1
            ELSE 0
          END), 0) AS complaints_last_30_days,
          COALESCE(SUM(CASE
            WHEN UPPER(COALESCE(closure_reason, '')) IN ('WRONG_REASON', 'DISPUTE_LOST') THEN 1
            ELSE 0
          END), 0) AS rejected_complaints,
          COALESCE(SUM(CASE
            WHEN beneficiary_account_number = ? THEN 1
            ELSE 0
          END), 0) AS disputes_to_same_beneficiary
        FROM complaint
        WHERE remitter_account_number = ?
      `,
      [beneficiaryAccountNumber, customerAccountNumber]
    );

    const row = rows[0];
    const totalComplaints = toNumber(row?.total_complaints);
    const complaintsLast30Days = toNumber(row?.complaints_last_30_days);
    const rejectedComplaints = toNumber(row?.rejected_complaints);
    const disputesToSameBeneficiary = toNumber(
      row?.disputes_to_same_beneficiary
    );

    const complaintsLast30DaysNormalized = Math.min(
      complaintsLast30Days / FRAUD_COMPLAINTS_30_DAY_CAP,
      1
    );
    const rejectionRate =
      totalComplaints > 0 ? rejectedComplaints / totalComplaints : 0;
    const repeatBeneficiaryRatio =
      totalComplaints > 0 ? disputesToSameBeneficiary / totalComplaints : 0;

    const rawScore =
      FRAUD_WEIGHTS.complaintsLast30Days * complaintsLast30DaysNormalized +
      FRAUD_WEIGHTS.rejectionRate * rejectionRate +
      FRAUD_WEIGHTS.repeatBeneficiaryRatio * repeatBeneficiaryRatio;
    const fraudScore =
      FRAUD_SCORE_NORMALIZATION_DENOMINATOR > 0
        ? rawScore / FRAUD_SCORE_NORMALIZATION_DENOMINATOR
        : 0;

    let risk = "LOW";
    if (fraudScore >= FRAUD_HIGH_RISK_THRESHOLD) {
      risk = "HIGH RISK (Likely abuse)";
    } else if (fraudScore >= FRAUD_MEDIUM_RISK_THRESHOLD) {
      risk = "MEDIUM";
    }

    const reasons: string[] = [];

    if (complaintsLast30Days > 0) {
      reasons.push(`User has ${complaintsLast30Days} complaints in last 30 days`);
    }

    if (rejectedComplaints > 0 && totalComplaints > 0) {
      reasons.push(
        `${Math.round(rejectionRate * 100)}% complaints previously rejected`
      );
    }

    if (disputesToSameBeneficiary >= 2) {
      reasons.push("Multiple disputes against same beneficiary");
    }

    if (reasons.length === 0) {
      reasons.push("No strong fraud indicators from current complaint history");
    }

    return NextResponse.json({
      success: true,
      data: {
        customerAccountNumber,
        beneficiaryAccountNumber,
        score: round(fraudScore),
        risk,
        reasons,
        metrics: {
          totalComplaints,
          complaintsLast30Days,
          complaintsLast30DaysNormalized: round(complaintsLast30DaysNormalized),
          rejectedComplaints,
          rejectionRate: round(rejectionRate),
          disputesToSameBeneficiary,
          repeatBeneficiaryRatio: round(repeatBeneficiaryRatio),
        },
        weights: FRAUD_WEIGHTS,
        normalization: {
          complaints30DayCap: FRAUD_COMPLAINTS_30_DAY_CAP,
          scoreDivisor: FRAUD_SCORE_NORMALIZATION_DENOMINATOR,
          mediumRiskThreshold: FRAUD_MEDIUM_RISK_THRESHOLD,
          highRiskThreshold: FRAUD_HIGH_RISK_THRESHOLD,
          timestampColumnAssumption: "complaint.transaction_date",
        },
      },
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        success: false,
        error: "Failed to calculate fraud detection score",
      },
      { status: 500 }
    );
  }
}
