import { NextRequest, NextResponse } from "next/server";
import { RowDataPacket } from "mysql2";
import { db } from "@/app/lib/db";

type AdsRow = RowDataPacket & {
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

  const currentAmountParam = request.nextUrl.searchParams.get("currentAmount");
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
    const [rows] = await db.query<AdsRow[]>(
      `
        SELECT
          AVG(transaction_amount) AS avg_user_amount,
          COUNT(*) AS transaction_count
        FROM adjustment_outward_history
        WHERE beneficiary_account_number = ?
      `,
      [customerAccountNumber]
    );

    const row = rows[0];
    const avgUserAmount = toNumber(row?.avg_user_amount);
    const transactionCount = toNumber(row?.transaction_count);

    let ads = 0.3;

    if (avgUserAmount > 0) {
      if (currentAmount > 2 * avgUserAmount) {
        ads = 1.0;
      } else if (currentAmount > 1.5 * avgUserAmount) {
        ads = 0.7;
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        customerAccountNumber,
        currentAmount,
        avgUserAmount: Number(avgUserAmount.toFixed(2)),
        transactionCount,
        ads,
      },
      thresholds: avgUserAmount
        ? {
            onePointFiveX: Number((1.5 * avgUserAmount).toFixed(2)),
            twoX: Number((2 * avgUserAmount).toFixed(2)),
          }
        : null,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        success: false,
        error: "Failed to calculate ADS",
      },
      { status: 500 }
    );
  }
}
