import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { db } from "@/app/lib/db";
import {
  FINAL_REJECTION_CODES,
  FRAUD_COMPLAINTS_30_DAY_CAP,
  FRAUD_HIGH_RISK_THRESHOLD,
  FRAUD_SCORE_NORMALIZATION_DENOMINATOR,
  FRAUD_WEIGHTS,
  RAISE_CODES,
  RETURN_PROBABILITY_THRESHOLD,
  SUCCESS_CODES,
  SUCCESS_PROBABILITY_THRESHOLD,
  SUCCESS_PROBABILITY_WEIGHTS,
} from "@/app/lib/chargeback";

export const runtime = "nodejs";

const STAGING_COLUMNS = [
  "crm_id",
  "transaction_id",
  "complaint_amount",
  "complaint_reason",
  "remitter_account_number",
  "transaction_date",
] as const;

const REQUIRED_COLUMNS = [
  "crm_id",
  "transaction_id",
  "complaint_amount",
  "remitter_account_number",
  "transaction_date",
] as const;

type StagingColumn = (typeof STAGING_COLUMNS)[number];
type StagingInsertRow = [
  string,
  string,
  number,
  string | null,
  string,
  string
];

type ScoredInsertRow = [
  string,
  string,
  number,
  string | null,
  string,
  string,
  number,
  number,
  string,
  number
];

type ScoredFileRow = {
  crm_id: string;
  transaction_id: string;
  complaint_amount: number;
  complaint_reason: string | null;
  remitter_account_number: string;
  transaction_date: string;
  success_probability: number;
  return_probability: number;
  action_to_be_taken: string;
  fraud_detection: number;
};

type TransactionContextRow = {
  beneficiary_account_number: string | null;
  beneficiary_bank_code: string | null;
  amount: number | string | null;
};

type SuccessProbabilityMetricsRow = {
  rsr: number | string | null;
  msr: number | string | null;
  bsr: number | string | null;
  total_complaints: number | string | null;
  valid_disputes: number | string | null;
  successful_disputes: number | string | null;
  rejected_complaints: number | string | null;
  avg_user_amount: number | string | null;
};

type ReturnProbabilityMetricsRow = {
  total_complaints: number | string | null;
  refund_processed_complaints: number | string | null;
};

type FraudMetricsRow = {
  total_complaints: number | string | null;
  complaints_last_30_days: number | string | null;
  rejected_complaints: number | string | null;
  disputes_to_same_beneficiary: number | string | null;
};

type DbWriteResult = {
  affectedRows: number;
  lastInsertRowid?: number;
};

type DbConnection = Awaited<ReturnType<typeof db.getConnection>>;

function normalizeHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getColumnFromHeader(header: string): StagingColumn | null {
  const normalized = normalizeHeader(header);

  const aliases: Record<string, StagingColumn> = {
    crm_id: "crm_id",
    complaint_id: "crm_id",
    complaint_reference_id: "crm_id",
    transaction_id: "transaction_id",
    txn_id: "transaction_id",
    complaint_amount: "complaint_amount",
    amount: "complaint_amount",
    disputed_amount: "complaint_amount",
    complaint_reason: "complaint_reason",
    reason: "complaint_reason",
    remitter_account_number: "remitter_account_number",
    sender_account: "remitter_account_number",
    sender_account_number: "remitter_account_number",
    customer_account_number: "remitter_account_number",
    transaction_date: "transaction_date",
    txn_date: "transaction_date",
    complaint_date: "transaction_date",
  };

  return aliases[normalized] ?? null;
}

function excelDateToJsDate(serial: number) {
  const utcDays = Math.floor(serial - 25569);
  const utcValue = utcDays * 86400;
  const dateInfo = new Date(utcValue * 1000);
  const fractionalDay = serial - Math.floor(serial) + 0.0000001;
  let totalSeconds = Math.floor(86400 * fractionalDay);
  const seconds = totalSeconds % 60;
  totalSeconds -= seconds;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds / 60) % 60;

  return new Date(
    dateInfo.getUTCFullYear(),
    dateInfo.getUTCMonth(),
    dateInfo.getUTCDate(),
    hours,
    minutes,
    seconds
  );
}

function formatDateTime(date: Date) {
  const pad = (value: number) => value.toString().padStart(2, "0");

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") +
    " " +
    [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join(":");
}

function coerceDate(value: unknown) {
  if (value == null || value === "") {
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDateTime(value);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return formatDateTime(excelDateToJsDate(value));
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (!trimmed) {
      return null;
    }

    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return formatDateTime(parsed);
    }
  }

  return null;
}

function coerceString(value: unknown) {
  if (value == null) {
    return "";
  }

  return String(value).trim();
}

function coerceOptionalString(value: unknown) {
  const normalized = coerceString(value);
  return normalized || null;
}

function coerceAmount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.replace(/,/g, "").trim();
    const amount = Number(normalized);
    if (!Number.isNaN(amount)) {
      return amount;
    }
  }

  return null;
}

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

function getBaseFilename(filename: string) {
  return filename.replace(/\.[^.]+$/, "");
}

function getRaiseCode(complaintReason: string | null) {
  const normalized = normalizeHeader(complaintReason ?? "").toUpperCase();
  const matchingCode = RAISE_CODES.find((code) => code === normalized);
  return matchingCode ?? "B";
}

function mapWorkbookRows(buffer: Buffer, filename: string) {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
    raw: false,
  });

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error("The uploaded file does not contain any sheets");
  }

  const sheet = workbook.Sheets[firstSheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: false,
  });

  const insertRows: StagingInsertRow[] = [];
  const skippedRows: Array<{ rowNumber: number; reason: string }> = [];
  const discoveredColumns = new Set<StagingColumn>();

  rawRows.forEach((rawRow, index) => {
    const mappedRow = {} as Partial<Record<StagingColumn, unknown>>;

    for (const [header, value] of Object.entries(rawRow)) {
      const mappedColumn = getColumnFromHeader(header);
      if (mappedColumn) {
        mappedRow[mappedColumn] = value;
        discoveredColumns.add(mappedColumn);
      }
    }

    const rowNumber = index + 2;
    const crmId = coerceString(mappedRow.crm_id);
    const transactionId = coerceString(mappedRow.transaction_id);
    const complaintAmount = coerceAmount(mappedRow.complaint_amount);
    const complaintReason = coerceOptionalString(mappedRow.complaint_reason);
    const remitterAccountNumber = coerceString(mappedRow.remitter_account_number);
    const transactionDate = coerceDate(mappedRow.transaction_date);

    const isCompletelyBlank =
      !crmId &&
      !transactionId &&
      complaintAmount == null &&
      !complaintReason &&
      !remitterAccountNumber &&
      !transactionDate;

    if (isCompletelyBlank) {
      return;
    }

    if (
      !crmId ||
      !transactionId ||
      complaintAmount == null ||
      !remitterAccountNumber ||
      !transactionDate
    ) {
      skippedRows.push({
        rowNumber,
        reason: "Missing one or more required values",
      });
      return;
    }

    insertRows.push([
      crmId,
      transactionId,
      complaintAmount,
      complaintReason,
      remitterAccountNumber,
      transactionDate,
    ]);
  });

  const missingColumns = REQUIRED_COLUMNS.filter(
    (column) => !discoveredColumns.has(column)
  );

  return {
    filename,
    totalRows: rawRows.length,
    insertRows,
    skippedRows,
    missingColumns,
    sheetName: firstSheetName,
  };
}

async function truncateIfRequested(
  connection: DbConnection,
  shouldReplace: boolean
) {
  if (!shouldReplace) {
    return;
  }

  await connection.query("DELETE FROM input_staging");
  await connection.query("DELETE FROM input_staging_scored");
}

async function insertRows(
  connection: DbConnection,
  rows: StagingInsertRow[]
) {
  if (!rows.length) {
    return 0;
  }

  const columns = STAGING_COLUMNS.join(", ");
  const placeholders = rows.map(() => "(?, ?, ?, ?, ?, ?)").join(", ");
  const values = rows.flat();

  const [result] = await connection.query<DbWriteResult>(
    `
      INSERT INTO input_staging (${columns})
      VALUES ${placeholders}
    `,
    values
  );

  return result.affectedRows;
}

async function ensureScoredTable(connection: DbConnection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS input_staging_scored (
      crm_id VARCHAR(255),
      transaction_id VARCHAR(255),
      complaint_amount DECIMAL(18, 2),
      complaint_reason VARCHAR(255),
      remitter_account_number VARCHAR(255),
      transaction_date DATETIME,
      success_probability DECIMAL(10, 4),
      return_probability DECIMAL(10, 4),
      action_to_be_taken VARCHAR(255),
      fraud_detection DECIMAL(10, 4)
    )
  `);
}

async function getTransactionContext(
  connection: DbConnection,
  transactionId: string
) {
  const [rows] = await connection.query<TransactionContextRow[]>(
    `
      SELECT
        t.beneficiary_account_number,
        (
          SELECT MAX(a.beneficiary_bank_code)
          FROM adjustment_outward_history a
          WHERE a.transaction_id = t.transaction_id
        ) AS beneficiary_bank_code,
        t.amount
      FROM transaction_table t
      WHERE t.transaction_id = ?
      LIMIT 1
    `,
    [transactionId]
  );

  return rows[0] ?? null;
}

async function getSuccessProbability(
  connection: DbConnection,
  customerAccountNumber: string,
  beneficiaryAccountNumber: string,
  beneficiaryBankCode: string,
  raiseCode: string,
  currentAmount: number
) {
  const [rows] = await connection.query<SuccessProbabilityMetricsRow[]>(
    `
      WITH txn_summary AS (
        SELECT
          transaction_id,
          MAX(CASE
            WHEN adjustment_flag IN (${RAISE_CODES.map(() => "?").join(", ")})
            THEN adjustment_flag
          END) AS raise_reason,
          MAX(CASE
            WHEN adjustment_flag IN (${SUCCESS_CODES.map(() => "?").join(", ")})
            THEN 1 ELSE 0
          END) AS is_success,
          MAX(CASE
            WHEN adjustment_flag IN (${RAISE_CODES.map(() => "?").join(", ")})
            THEN 1 ELSE 0
          END) AS has_complaint,
          MAX(CASE
            WHEN adjustment_flag IN (${FINAL_REJECTION_CODES.map(() => "?").join(", ")})
            THEN 1 ELSE 0
          END) AS is_rejected_complaint,
            MAX(remitter_account_number) AS remitter_account,
            MAX(beneficiary_account_number) AS beneficiary_account,
            MAX(beneficiary_bank_code) AS beneficiary_bank
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
          WHERE remitter_account = ?
        ), 0) AS total_complaints,
        COALESCE((
          SELECT SUM(CASE WHEN has_complaint = 1 THEN 1 ELSE 0 END)
          FROM txn_summary
          WHERE remitter_account = ?
        ), 0) AS valid_disputes,
        COALESCE((
          SELECT SUM(is_success)
          FROM txn_summary
          WHERE remitter_account = ?
        ), 0) AS successful_disputes,
        COALESCE((
          SELECT SUM(CASE
            WHEN has_complaint = 1 AND is_rejected_complaint = 1 THEN 1
            ELSE 0
          END)
          FROM txn_summary
          WHERE remitter_account = ?
        ), 0) AS rejected_complaints,
        COALESCE((
          SELECT AVG(amount)
          FROM transaction_table
          WHERE remitter_account_number = ?
        ), 0) AS avg_user_amount
    `,
    [
      ...RAISE_CODES,
      ...SUCCESS_CODES,
      ...RAISE_CODES,
      ...FINAL_REJECTION_CODES,
      raiseCode,
      beneficiaryAccountNumber,
      beneficiaryBankCode,
      customerAccountNumber,
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
  return round(x * rsr + y * msr + z * ccs + v * bsr + w * ads);
}

async function getReturnProbability(
  connection: DbConnection,
  beneficiaryAccountNumber: string
) {
  const [rows] = await connection.query<ReturnProbabilityMetricsRow[]>(
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

  return totalComplaints > 0
    ? round(refundProcessedComplaints / totalComplaints)
    : 0;
}

async function getFraudScore(
  connection: DbConnection,
  customerAccountNumber: string,
  beneficiaryAccountNumber: string
) {
  const [rows] = await connection.query<FraudMetricsRow[]>(
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

  return FRAUD_SCORE_NORMALIZATION_DENOMINATOR > 0
    ? round(rawScore / FRAUD_SCORE_NORMALIZATION_DENOMINATOR)
    : 0;
}

function getActionToBeTaken(
  successProbability: number,
  returnProbability: number,
  fraudDetection: number
) {
  if (returnProbability >= RETURN_PROBABILITY_THRESHOLD) {
    return "merchant likely to refund";
  }

  if (fraudDetection >= FRAUD_HIGH_RISK_THRESHOLD) {
    return "do not raise";
  }

  if (successProbability >= SUCCESS_PROBABILITY_THRESHOLD) {
    return "raise chargeback";
  }

  return "do not raise";
}

async function buildScoredRows(
  connection: DbConnection,
  rows: StagingInsertRow[]
) {
  const scoredRows: ScoredInsertRow[] = [];

  for (const row of rows) {
    const [
      crmId,
      transactionId,
      complaintAmount,
      complaintReason,
      remitterAccountNumber,
      transactionDate,
    ] = row;

    const transactionContext = await getTransactionContext(
      connection,
      transactionId
    );

    if (!transactionContext?.beneficiary_account_number) {
      scoredRows.push([
        crmId,
        transactionId,
        complaintAmount,
        complaintReason,
        remitterAccountNumber,
        transactionDate,
        0,
        0,
        "do not raise",
        0,
      ]);
      continue;
    }

    const beneficiaryAccountNumber = transactionContext.beneficiary_account_number;
    const beneficiaryBankCode = transactionContext.beneficiary_bank_code ?? "";
    const currentAmount =
      complaintAmount > 0 ? complaintAmount : toNumber(transactionContext.amount);
    const raiseCode = getRaiseCode(complaintReason);

    const successProbability = await getSuccessProbability(
      connection,
      remitterAccountNumber,
      beneficiaryAccountNumber,
      beneficiaryBankCode,
      raiseCode,
      currentAmount
    );
    const returnProbability = await getReturnProbability(
      connection,
      beneficiaryAccountNumber
    );
    const fraudDetection = await getFraudScore(
      connection,
      remitterAccountNumber,
      beneficiaryAccountNumber
    );
    const actionToBeTaken = getActionToBeTaken(
      successProbability,
      returnProbability,
      fraudDetection
    );

    scoredRows.push([
      crmId,
      transactionId,
      complaintAmount,
      complaintReason,
      remitterAccountNumber,
      transactionDate,
      successProbability,
      returnProbability,
      actionToBeTaken,
      fraudDetection,
    ]);
  }

  return scoredRows;
}

async function insertScoredRows(
  connection: DbConnection,
  rows: ScoredInsertRow[]
) {
  if (!rows.length) {
    return 0;
  }

  const placeholders = rows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
  const values = rows.flat();

  const [result] = await connection.query<DbWriteResult>(
    `
      INSERT INTO input_staging_scored (
        crm_id,
        transaction_id,
        complaint_amount,
        complaint_reason,
        remitter_account_number,
        transaction_date,
        success_probability,
        return_probability,
        action_to_be_taken,
        fraud_detection
      )
      VALUES ${placeholders}
    `,
    values
  );

  return result.affectedRows;
}

function buildScoredFileRows(rows: ScoredInsertRow[]): ScoredFileRow[] {
  return rows.map(
    ([
      crmId,
      transactionId,
      complaintAmount,
      complaintReason,
      remitterAccountNumber,
      transactionDate,
      successProbability,
      returnProbability,
      actionToBeTaken,
      fraudDetection,
    ]) => ({
      crm_id: crmId,
      transaction_id: transactionId,
      complaint_amount: complaintAmount,
      complaint_reason: complaintReason,
      remitter_account_number: remitterAccountNumber,
      transaction_date: transactionDate,
      success_probability: successProbability,
      return_probability: returnProbability,
      action_to_be_taken: actionToBeTaken,
      fraud_detection: fraudDetection,
    })
  );
}

function buildDownloadResponse(
  rows: ScoredFileRow[],
  originalFilename: string,
  downloadFormat: "xlsx" | "csv"
) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, "scored_results");

  const baseFilename = getBaseFilename(originalFilename);

  if (downloadFormat === "csv") {
    const csv = XLSX.utils.sheet_to_csv(worksheet);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${baseFilename}_scored.csv"`,
      },
    });
  }

  const buffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
  }) as Buffer;

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${baseFilename}_scored.xlsx"`,
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const replaceExisting =
      String(formData.get("replaceExisting") ?? "").toLowerCase() === "true";
    const responseMode =
      String(formData.get("responseMode") ?? "file").toLowerCase() === "json"
        ? "json"
        : "file";
    const downloadFormat =
      String(formData.get("downloadFormat") ?? "xlsx").toLowerCase() === "csv"
        ? "csv"
        : "xlsx";

    if (!(file instanceof File)) {
      return NextResponse.json(
        {
          success: false,
          error: "file is required in multipart form-data",
        },
        { status: 400 }
      );
    }

    const lowerName = file.name.toLowerCase();
    const isSupportedFile =
      lowerName.endsWith(".csv") ||
      lowerName.endsWith(".xls") ||
      lowerName.endsWith(".xlsx");

    if (!isSupportedFile) {
      return NextResponse.json(
        {
          success: false,
          error: "Only .csv, .xls, and .xlsx files are supported",
        },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const parsed = mapWorkbookRows(Buffer.from(arrayBuffer), file.name);

    if (parsed.missingColumns.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Uploaded file is missing required columns",
          missingColumns: parsed.missingColumns,
          expectedColumns: [...STAGING_COLUMNS],
        },
        { status: 400 }
      );
    }

    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();
      await ensureScoredTable(connection);
      await truncateIfRequested(connection, replaceExisting);
      const insertedRows = await insertRows(connection, parsed.insertRows);
      const scoredRows = await buildScoredRows(connection, parsed.insertRows);
      const insertedScoredRows = await insertScoredRows(connection, scoredRows);
      await connection.commit();

      const scoredFileRows = buildScoredFileRows(scoredRows);
      const generatedFileName = `${getBaseFilename(parsed.filename)}_scored.${downloadFormat}`;

      if (responseMode === "file") {
        return buildDownloadResponse(
          scoredFileRows,
          parsed.filename,
          downloadFormat
        );
      }

      return NextResponse.json({
        success: true,
        data: {
          fileName: parsed.filename,
          sheetName: parsed.sheetName,
          replaceExisting,
          totalRowsRead: parsed.totalRows,
          insertedRows,
          insertedScoredRows,
          responseMode,
          downloadFormat,
          generatedFileName,
          skippedRows: parsed.skippedRows.length,
          expectedColumns: [...STAGING_COLUMNS],
          scoredTable: "input_staging_scored",
          previewRows: scoredFileRows.slice(0, 10),
          skippedRowDetails: parsed.skippedRows.slice(0, 20),
        },
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        success: false,
        error: "Failed to upload data into input_staging",
      },
      { status: 500 }
    );
  }
}
