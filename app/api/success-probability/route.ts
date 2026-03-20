import { NextRequest, NextResponse } from "next/server";
import { RowDataPacket } from "mysql2";
import { db } from "@/app/lib/db";
import {
  DISPUTE_ACCEPTANCE_CODES,
  FINAL_REJECTION_CODES,
  RAISE_CODES,
  SUCCESS_CODES,
  SUCCESS_PROBABILITY_WEIGHTS,
} from "@/app/lib/chargeback";

type SuccessProbabilityRow = RowDataPacket & {
  rsr: number | string | null;
  msr: number | string | null;
  bsr: number | string | null;
  total_complaints: number | string | null;
  valid_disputes: number | string | null;
  successful_disputes: number | string | null;
  rejected_complaints: number | string | null;
  avg_user_amount: number | string | null;
  transaction_count: number | string | null;
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
  const beneficiaryBankCode =
    request.nextUrl.searchParams.get("beneficiaryBankCode")?.trim() ?? "";
  const raiseCode = request.nextUrl.searchParams.get("raiseCode")?.trim() ?? "";
  const currentAmountParam = request.nextUrl.searchParams.get("currentAmount");

  if (!customerAccountNumber || !beneficiaryAccountNumber || !beneficiaryBankCode) {
    return NextResponse.json(
      {
        success: false,
        error:
          "customerAccountNumber, beneficiaryAccountNumber, and beneficiaryBankCode are required",
      },
      { status: 400 }
    );
  }

  if (!raiseCode || !RAISE_CODES.includes(raiseCode as (typeof RAISE_CODES)[number])) {
    return NextResponse.json(
      {
        success: false,
        error: `raiseCode must be one of: ${RAISE_CODES.join(", ")}`,
      },
      { status: 400 }
    );
  }

  const currentAmount = Number(currentAmountParam);

  if (
    currentAmountParam == null ||
    Number.isNaN(currentAmount) ||
    currentAmount < 0
  ) {
    return NextResponse.json(
      {
        success: false,
        error: "currentAmount must be a valid non-negative number",
      },
      { status: 400 }
    );
  }

  try {
    const [rows] = await db.query<SuccessProbabilityRow[]>(
      `
        WITH txn_summary AS (
          SELECT
            transaction_id,
            MAX(CASE
              WHEN reason_code IN (${RAISE_CODES.map(() => "?").join(", ")})
              THEN reason_code
            END) AS raise_reason,
            MAX(CASE
              WHEN reason_code IN (${SUCCESS_CODES.map(() => "?").join(", ")})
              THEN 1 ELSE 0
            END) AS is_success,
            MAX(CASE
              WHEN reason_code IN (${RAISE_CODES.map(() => "?").join(", ")})
              THEN 1 ELSE 0
            END) AS has_complaint,
            MAX(CASE
              WHEN reason_code IN (${DISPUTE_ACCEPTANCE_CODES.map(() => "?").join(", ")})
              THEN 1 ELSE 0
            END) AS is_successful_dispute,
            MAX(CASE
              WHEN reason_code IN (${FINAL_REJECTION_CODES.map(() => "?").join(", ")})
              THEN 1 ELSE 0
            END) AS is_rejected_complaint,
            MAX(beneficiary_account_number) AS beneficiary_account,
            MAX(beneficiary_bank_code) AS beneficiary_bank,
            MAX(CASE
              WHEN beneficiary_account_number = ? THEN transaction_amount
            END) AS user_transaction_amount
          FROM adjustment_outward_history
          GROUP BY transaction_id
        )
        SELECT
          COALESCE((
            SELECT ROUND(SUM(is_success) / COUNT(*), 4)
            FROM txn_summary
            WHERE raise_reason = ?
          ), 0) AS rsr,
          COALESCE((
            SELECT CASE
              WHEN COUNT(*) > 5 THEN ROUND(SUM(is_success) / COUNT(*), 4)
              ELSE 0.5
            END
            FROM txn_summary
            WHERE beneficiary_account = ?
          ), 0.5) AS msr,
          COALESCE((
            SELECT ROUND(SUM(is_success) / COUNT(*), 4)
            FROM txn_summary
            WHERE beneficiary_bank = ?
          ), 0) AS bsr,
          COALESCE((
            SELECT SUM(has_complaint)
            FROM txn_summary
            WHERE beneficiary_account = ?
          ), 0) AS total_complaints,
          COALESCE((
            SELECT SUM(CASE WHEN has_complaint = 1 THEN 1 ELSE 0 END)
            FROM txn_summary
            WHERE beneficiary_account = ?
          ), 0) AS valid_disputes,
          COALESCE((
            SELECT SUM(is_successful_dispute)
            FROM txn_summary
            WHERE beneficiary_account = ?
          ), 0) AS successful_disputes,
          COALESCE((
            SELECT SUM(CASE
              WHEN has_complaint = 1 AND is_rejected_complaint = 1 THEN 1
              ELSE 0
            END)
            FROM txn_summary
            WHERE beneficiary_account = ?
          ), 0) AS rejected_complaints,
          COALESCE((
            SELECT AVG(user_transaction_amount)
            FROM txn_summary
            WHERE user_transaction_amount IS NOT NULL
          ), 0) AS avg_user_amount,
          COALESCE((
            SELECT COUNT(*)
            FROM txn_summary
            WHERE user_transaction_amount IS NOT NULL
          ), 0) AS transaction_count
      `,
      [
        ...RAISE_CODES,
        ...SUCCESS_CODES,
        ...RAISE_CODES,
        ...DISPUTE_ACCEPTANCE_CODES,
        ...FINAL_REJECTION_CODES,
        customerAccountNumber,
        raiseCode,
        beneficiaryAccountNumber,
        beneficiaryBankCode,
        customerAccountNumber,
        customerAccountNumber,
        customerAccountNumber,
        customerAccountNumber,
      ]
    );

    const row = rows[0];
    const rsr = toNumber(row?.rsr);
    const msr = toNumber(row?.msr);
    const bsr = toNumber(row?.bsr);
    const totalComplaints = toNumber(row?.total_complaints);
    const validDisputes = toNumber(row?.valid_disputes);
    const successfulDisputes = toNumber(row?.successful_disputes);
    const rejectedComplaints = toNumber(row?.rejected_complaints);
    const avgUserAmount = toNumber(row?.avg_user_amount);
    const transactionCount = toNumber(row?.transaction_count);

    const successRate =
      validDisputes > 0 ? successfulDisputes / validDisputes : 0;
    const rejectionRate =
      totalComplaints > 0 ? rejectedComplaints / totalComplaints : 0;
    const ccs = 0.5 * successRate - 0.5 * rejectionRate;

    let ads = 0.3;
    if (avgUserAmount > 0) {
      if (currentAmount > 2 * avgUserAmount) {
        ads = 1.0;
      } else if (currentAmount > 1.5 * avgUserAmount) {
        ads = 0.7;
      }
    }

    const { x, y, z, v, w } = SUCCESS_PROBABILITY_WEIGHTS;
    const successProbability = x * rsr + y * msr + z * ccs + v * bsr + w * ads;

    return NextResponse.json({
      success: true,
      data: {
        customerAccountNumber,
        beneficiaryAccountNumber,
        beneficiaryBankCode,
        raiseCode,
        currentAmount,
        weights: SUCCESS_PROBABILITY_WEIGHTS,
        metrics: {
          rsr: round(rsr),
          msr: round(msr),
          ccs: round(ccs),
          bsr: round(bsr),
          ads: round(ads),
        },
        ccsBreakdown: {
          totalComplaints,
          validDisputes,
          successfulDisputes,
          rejectedComplaints,
          successRate: round(successRate),
          rejectionRate: round(rejectionRate),
        },
        adsBreakdown: {
          avgUserAmount: round(avgUserAmount, 2),
          transactionCount,
        },
        successProbability: round(successProbability),
      },
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        success: false,
        error: "Failed to calculate success probability",
      },
      { status: 500 }
    );
  }
}
