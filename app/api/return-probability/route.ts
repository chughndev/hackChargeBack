import { NextRequest, NextResponse } from "next/server";
import { db } from "@/app/lib/db";
import { RETURN_PROBABILITY_THRESHOLD } from "@/app/lib/chargeback";

type ReturnProbabilityRow = {
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
        SELECT
          COUNT(*) AS total_complaints,
          COALESCE(SUM(CASE
            WHEN UPPER(COALESCE(closure_reason, '')) = 'REFUND_PROCESSED' THEN 1
            ELSE 0
          END), 0) AS refund_processed_complaints
        FROM complaint
        WHERE beneficiary_account_number = ?
      `,
      [beneficiaryAccountNumber]
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
