# Chargeback Analytics

This project is a Next.js app that:

- stores source data in SQLite
- accepts an `input_staging` upload from the frontend
- calculates chargeback-related scores
- returns a scored result file for download

The main user flow is:

1. load source CSVs into SQLite
2. upload an `input_staging` file from the UI
3. preview the scored rows
4. download the final scored file

## Stack

- Next.js app router
- SQLite
- `database.db` as the local database file

Database path is configured in [app/lib/db.ts](/Users/user/Desktop/Project/hack_chargeback/app/lib/db.ts).

By default the app uses:

```text
database.db
```

You can override it with:

```bash
SQLITE_DB_FILE=your_file.db
```

## Required Tables

Create these four base tables in SQLite.

```sql
CREATE TABLE transaction_table (
    transaction_id TEXT PRIMARY KEY,
    amount REAL,
    beneficiary_account_number TEXT,
    remitter_account_number TEXT,
    transaction_date TEXT,
    transaction_type TEXT
);

CREATE TABLE complaint (
    crm_id TEXT PRIMARY KEY,
    status TEXT,
    closure_reason TEXT,
    remitter_account_number TEXT,
    beneficiary_account_number TEXT,
    transaction_id TEXT,
    amount REAL,
    transaction_date TEXT,
    FOREIGN KEY (transaction_id)
        REFERENCES transaction_table(transaction_id)
);

CREATE TABLE adjustment_outward_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id TEXT,
    amount REAL,
    beneficiary_account_number TEXT,
    remitter_account_number TEXT,
    branch_code TEXT,
    adjustment_flag TEXT,
    transaction_date TEXT,
    adjustment_date TEXT,
    remitter_bank_code TEXT,
    beneficiary_bank_code TEXT,
    reason_code TEXT,
    penalty_amount REAL,
    transaction_type TEXT,
    FOREIGN KEY (transaction_id)
        REFERENCES transaction_table(transaction_id)
);

CREATE TABLE input_staging (
    crm_id TEXT,
    transaction_id TEXT,
    complaint_amount REAL,
    complaint_reason TEXT,
    remitter_account_number TEXT,
    transaction_date TEXT
);
```

The upload API creates this table automatically when needed:

```sql
CREATE TABLE IF NOT EXISTS input_staging_scored (
    crm_id TEXT,
    transaction_id TEXT,
    complaint_amount REAL,
    complaint_reason TEXT,
    remitter_account_number TEXT,
    transaction_date TEXT,
    success_probability REAL,
    return_probability REAL,
    action_to_be_taken TEXT,
    fraud_detection REAL
);
```

## Create The Database

From the project root:

```bash
cd /Users/user/Desktop/Project/hack_chargeback
sqlite3 database.db
```

Then paste the table schema above into the SQLite shell.

## Source CSV Mapping

Your three source CSVs should be loaded into these tables:

- `transactions_v2.csv` -> `transaction_table`
- `complaints_v2.csv` -> `complaint`
- `adjustments_v2.csv` -> `adjustment_outward_history`

Important mapping for `adjustments_v2.csv`:

- `ADJ_FLAG` must go into `adjustment_flag`
- `REASON_CODE` must go into `reason_code`

The analytics read dispute lifecycle codes like `B`, `WC`, `FA`, `WR`, `PR` from `adjustment_flag`.

## Recommended Indexes

These are not required, but they help query performance.

```sql
CREATE INDEX idx_adjustment_txn_id ON adjustment_outward_history(transaction_id);
CREATE INDEX idx_adjustment_beneficiary ON adjustment_outward_history(beneficiary_account_number);
CREATE INDEX idx_adjustment_remitter ON adjustment_outward_history(remitter_account_number);
CREATE INDEX idx_adjustment_bank ON adjustment_outward_history(beneficiary_bank_code);
CREATE INDEX idx_adjustment_flag ON adjustment_outward_history(adjustment_flag);

CREATE INDEX idx_complaint_remitter ON complaint(remitter_account_number);
CREATE INDEX idx_complaint_beneficiary ON complaint(beneficiary_account_number);
CREATE INDEX idx_complaint_txn_date ON complaint(transaction_date);

CREATE INDEX idx_transaction_remitter ON transaction_table(remitter_account_number);
```

## Upload File Format

The frontend upload is for `input_staging`, not for the three source tables.

Expected columns:

```csv
crm_id,transaction_id,complaint_amount,complaint_reason,remitter_account_number,transaction_date
```

Example:

```csv
crm_id,transaction_id,complaint_amount,complaint_reason,remitter_account_number,transaction_date
71ff282a-1,d97c4c78-bb6,38064,WC,REM977175,2025-07-07 00:00:00
38401322-f,b99acb4e-9de,24880,B,REM850135,2025-11-24 00:00:00
77e259d0-c,973c05b8-775,45690,FC,REM279705,2025-08-15 00:00:00
```

Notes:

- `transaction_id` must exist in `transaction_table`
- `remitter_account_number` is treated as the customer account
- `complaint_reason` should ideally be one of the raise codes: `B`, `WC`, `FC`, `FB`

## Frontend Upload Flow

Open the app and upload the `input_staging` file from the home page.

The upload endpoint:

```text
POST /api/input-staging/upload
```

Supported file types:

- `.csv`
- `.xls`
- `.xlsx`

The upload route:

1. reads the file
2. inserts raw rows into `input_staging`
3. computes scores for each row
4. inserts scored rows into `input_staging_scored`
5. returns a downloadable scored file

## Final Output Columns

The generated file contains all uploaded columns plus these four columns:

- `success_probability`
- `return_probability`
- `action_to_be_taken`
- `fraud_detection`

## What Each Score Means

### `success_probability`

Weighted combination of:

- `RSR`
- `MSR`
- `CCS`
- `BSR`
- `ADS`

Current weights are defined in [app/lib/chargeback.ts](/Users/user/Desktop/Project/hack_chargeback/app/lib/chargeback.ts):

```text
RSR = 0.20
MSR = 0.25
CCS = 0.30
BSR = 0.10
ADS = 0.15
```

Current action threshold:

```text
success_probability >= 0.34
```

### `return_probability`

Measures how often complaints for the beneficiary end in refund processing.

Current action threshold:

```text
return_probability >= 0.18
```

### `fraud_detection`

Uses:

- complaints in last 30 days
- rejected complaint ratio
- repeat disputes to the same beneficiary

Current risk bands:

```text
LOW    < 0.14
MEDIUM >= 0.14
HIGH   >= 0.18
```

## Action Logic

The current action logic is:

1. if `return_probability >= 0.18` -> `merchant likely to refund`
2. else if `fraud_detection >= 0.18` -> `do not raise`
3. else if `success_probability >= 0.34` -> `raise chargeback`
4. else -> `do not raise`

## Dispute Code Buckets

Defined in [app/lib/chargeback.ts](/Users/user/Desktop/Project/hack_chargeback/app/lib/chargeback.ts).

Raise:

```text
B, WC, FC, FB
```

Accept:

```text
A, WA, FCA, FA
```

Reject:

```text
R, WR, FCR, FR
```

Re-raise:

```text
FP, P
```

Re-raise accept:

```text
AP, FAP
```

Re-raise reject:

```text
PR, FPR
```

Refund:

```text
C, REF, RET
```

## API Summary

Main APIs in this project:

- `GET /api/ccs`
- `GET /api/ads`
- `GET /api/rsr`
- `GET /api/msr+bsr`
- `GET /api/success-probability`
- `GET /api/return-probability`
- `GET /api/fraud-detection`
- `POST /api/input-staging/upload`

## Assumptions Used By The Code

- customer = `remitter_account_number`
- beneficiary / merchant = `beneficiary_account_number`
- bank = `beneficiary_bank_code`
- complaint timestamp for fraud = `complaint.transaction_date`
- ADS uses `transaction_table.amount`
- dispute lifecycle codes are read from `adjustment_flag`

If your CSV import puts lifecycle codes into the wrong column, score outputs will be wrong even if the app runs.

## Run The App

```bash
npm install
npm run dev
```

Then open:

```text
http://localhost:3000
```

## Quick Checklist

Before testing the upload UI, make sure:

- `database.db` exists
- all four base tables exist
- source CSVs are loaded into `transaction_table`, `complaint`, and `adjustment_outward_history`
- `adjustment_flag` contains values like `B`, `WC`, `FA`, `WR`, `PR`
- your upload file matches the `input_staging` format
