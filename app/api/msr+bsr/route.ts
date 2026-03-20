import { NextResponse } from "next/server";
import { db } from "@app/lib/ds";

export async function GET() {
  try {
    const threshold = 5; // you can tune this

    const [rows] = await db.query(
        `WITH txn_summary AS (
        SELECT 
            transaction_id,

            MAX(CASE 
                WHEN reason_code IN ('A','FCA','WA','AP','FA','C','REF','RET') 
                THEN 1 ELSE 0 
            END) AS is_success,

            MAX(beneficiary_account_number) AS beneficiary_account,
            MAX(beneficiary_bank_code) AS beneficiary_bank

        FROM adjustment_outward_history
        GROUP BY transaction_id
        )

        -- MERCHANT MSR
        SELECT 
        'MERCHANT' AS type,
        beneficiary_account AS entity,

        COUNT(*) AS total_disputes,
        SUM(is_success) AS successful_disputes,

        CASE 
            WHEN COUNT(*) > 5
            THEN ROUND(SUM(is_success) * 1.0 / COUNT(*), 3)
            ELSE 0.5
        END AS score

        FROM txn_summary
        GROUP BY beneficiary_account

        UNION ALL

        -- BANK BSR
        SELECT 
        'BANK' AS type,
        beneficiary_bank AS entity,

        COUNT(*) AS total_disputes,
        SUM(is_success) AS successful_disputes,

        ROUND(SUM(is_success) * 1.0 / COUNT(*), 3) AS score

        FROM txn_summary
        GROUP BY beneficiary_bank;`
    );

    return NextResponse.json({
      success: true,
      data: rows,
    });

  } catch (error) {
    console.error(error);
    return NextResponse.json({
      success: false,
      error: "Failed to fetch MSR/BSR",
    });
  }
}