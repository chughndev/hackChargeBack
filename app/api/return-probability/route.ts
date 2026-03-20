import { NextRequest, NextResponse } from "next/server";
import { RowDataPacket } from "mysql2";
import { db } from "@/app/lib/db";
import {
  RAISE_CODES,
  REFUND_CODES,
  RETURN_PROBABILITY_THRESHOLD,
} from "@/app/lib/chargeback";

type ReturnProbabilityRow = RowDataPacket & {
  total_complaints: number | string | null;
  refund_processed_complaints: number | string | null;
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
  const beneficiaryAccountNumber =
    request.nextUrl.searchParams.get("beneficiaryAccountNumber")?.trim() ??
    request.nextUrl.searchParams.get("beneficiary")?.trim() ??
    "";

  if (!beneficiaryAccountNumber) {
    return NextResponse.json(
      {
        success: false,
        error: "beneficiaryAccountNumber query parameter is required",
      },
      { status: 400 }
    );
  }

  try {
    const [rows] = await db.query<ReturnProbabilityRow[]>(
      `
        WITH txn_summary AS (
          SELECT
            transaction_id,
            MAX(CASE
              WHEN reason_code IN (${RAISE_CODES.map(() => "?").join(", ")})
              THEN 1 ELSE 0
            END) AS has_complaint,
            MAX(CASE
              WHEN reason_code IN (${REFUND_CODES.map(() => "?").join(", ")})
              THEN 1 ELSE 0
            END) AS is_refund_processed
          FROM adjustment_outward_history
          WHERE beneficiary_account_number = ?
          GROUP BY transaction_id
        )
        SELECT
          COALESCE(SUM(has_complaint), 0) AS total_complaints,
          COALESCE(SUM(CASE
            WHEN has_complaint = 1 AND is_refund_processed = 1 THEN 1
            ELSE 0
          END), 0) AS refund_processed_complaints
        FROM txn_summary
      `,
      [...RAISE_CODES, ...REFUND_CODES, beneficiaryAccountNumber]
    );

    const row = rows[0];
    const totalComplaints = toNumber(row?.total_complaints);
    const refundProcessedComplaints = toNumber(
      row?.refund_processed_complaints
    );
    const returnProbability =
      totalComplaints > 0 ? refundProcessedComplaints / totalComplaints : 0;
    const recommendation =
      returnProbability >= RETURN_PROBABILITY_THRESHOLD
        ? "Merchant Likely to Refund: Under Review"
        : "Wait";

    return NextResponse.json({
      success: true,
      data: {
        beneficiaryAccountNumber,
        totalComplaints,
        refundProcessedComplaints,
        returnProbability: round(returnProbability),
        threshold: RETURN_PROBABILITY_THRESHOLD,
        recommendation,
      },
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        success: false,
        error: "Failed to calculate return probability",
      },
      { status: 500 }
    );
  }
}
