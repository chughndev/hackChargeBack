import { NextRequest, NextResponse } from "next/server";
import { RowDataPacket } from "mysql2";
import { db } from "@/app/lib/db";
import {
  DISPUTE_ACCEPTANCE_CODES,
  FINAL_REJECTION_CODES,
  RAISE_CODES,
} from "@/app/lib/chargeback";

type CcsRow = RowDataPacket & {
  total_complaints: number | string | null;
  valid_disputes: number | string | null;
  successful_disputes: number | string | null;
  rejected_complaints: number | string | null;
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

export async function GET(request: NextRequest) {
  const customerAccountNumber =
    request.nextUrl.searchParams.get("customerAccountNumber")?.trim() ??
    request.nextUrl.searchParams.get("customer")?.trim() ??
    "";

  if (!customerAccountNumber) {
    return NextResponse.json(
      {
        success: false,
        error: "customerAccountNumber query parameter is required",
      },
      { status: 400 }
    );
  }

  const xParam = request.nextUrl.searchParams.get("x");
  const x = xParam == null ? 0.5 : Number(xParam);

  if (Number.isNaN(x) || x < 0 || x > 1) {
    return NextResponse.json(
      {
        success: false,
        error: "x must be a number between 0 and 1",
      },
      { status: 400 }
    );
  }

  try {
    const sql = `
      WITH txn_summary AS (
        SELECT
          transaction_id,
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
          END) AS is_rejected_complaint
        FROM adjustment_outward_history
        WHERE beneficiary_account_number = ?
        GROUP BY transaction_id
      )
      SELECT
        COALESCE(SUM(has_complaint), 0) AS total_complaints,
        COALESCE(SUM(CASE WHEN has_complaint = 1 THEN 1 ELSE 0 END), 0) AS valid_disputes,
        COALESCE(SUM(is_successful_dispute), 0) AS successful_disputes,
        COALESCE(SUM(CASE
          WHEN has_complaint = 1 AND is_rejected_complaint = 1 THEN 1
          ELSE 0
        END), 0) AS rejected_complaints
      FROM txn_summary
    `;

    const params = [
      ...RAISE_CODES,
      ...DISPUTE_ACCEPTANCE_CODES,
      ...FINAL_REJECTION_CODES,
      customerAccountNumber,
    ];

    const [rows] = await db.query<CcsRow[]>(sql, params);
    const row = rows[0];

    const totalComplaints = toNumber(row?.total_complaints);
    const validDisputes = toNumber(row?.valid_disputes);
    const successfulDisputes = toNumber(row?.successful_disputes);
    const rejectedComplaints = toNumber(row?.rejected_complaints);

    const successRate =
      validDisputes > 0 ? successfulDisputes / validDisputes : 0;
    const rejectionRate =
      totalComplaints > 0 ? rejectedComplaints / totalComplaints : 0;
    const ccs = x * successRate - (1 - x) * rejectionRate;

    return NextResponse.json({
      success: true,
      data: {
        customerAccountNumber,
        x,
        totalComplaints,
        validDisputes,
        successfulDisputes,
        rejectedComplaints,
        successRate: Number(successRate.toFixed(4)),
        rejectionRate: Number(rejectionRate.toFixed(4)),
        ccs: Number(ccs.toFixed(4)),
      },
      codeGroups: {
        raise: [...RAISE_CODES],
        reject: [...FINAL_REJECTION_CODES],
        accept: [...DISPUTE_ACCEPTANCE_CODES],
      },
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        success: false,
        error: "Failed to calculate CCS",
      },
      { status: 500 }
    );
  }
}
