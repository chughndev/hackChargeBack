import { NextResponse } from "next/server";
import { db } from "@/app/lib/db";
import { RAISE_CODES, SUCCESS_CODES } from "@/app/lib/chargeback";

export async function GET() {
  try {
    const [rows] = await db.query(`
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

          MAX(beneficiary_account_number) AS beneficiary_account,
          MAX(beneficiary_bank_code) AS beneficiary_bank,
          MAX(transaction_type) AS transaction_type

        FROM adjustment_outward_history
        GROUP BY transaction_id
      )

      SELECT 
        raise_reason,

        COUNT(*) AS total_disputes,
        SUM(is_success) AS successful_disputes,

        ROUND(SUM(is_success) / COUNT(*), 3) AS rsr_1

      FROM txn_summary
      WHERE raise_reason IS NOT NULL
      GROUP BY raise_reason
    `, [...RAISE_CODES, ...SUCCESS_CODES]);

    return NextResponse.json({
      success: true,
      data: rows,
    });

  } catch (error) {
    console.error(error);
    return NextResponse.json({
      success: false,
      error: "Failed to fetch RSR",
    }, { status: 500 });
  }
}
