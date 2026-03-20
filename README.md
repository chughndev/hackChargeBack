# 📊 Chargeback Analytics – Database README

This document explains the structure, purpose, and relationships of all tables used in the chargeback analytics system. It is designed to help developers, analysts, and backend engineers understand how data flows and how metrics like **RSR, MSR, BSR, CCS** are derived.

---

# 🧠 System Overview

The system processes dispute/chargeback data and computes:

* **RSR** → Reason Success Rate
* **MSR** → Merchant Success Rate
* **BSR** → Bank Success Rate
* **CCS** → Customer Credibility Score

---

# 🗄️ Tables Overview

```text
input_staging → raw uploaded data (Excel)
transaction_table → transaction master data
complaint → complaint/CRM data
adjustment_outward_history → dispute lifecycle (core table)
```

---

# 📂 1. `input_staging` (Raw Upload Table)

## 📌 Purpose

Stores raw data uploaded from Excel before processing.

## 🧾 Columns

| Column                  | Type     | Description                   |
| ----------------------- | -------- | ----------------------------- |
| crm_id                  | VARCHAR  | Complaint reference ID        |
| transaction_id          | VARCHAR  | Unique transaction identifier |
| complaint_amount        | DECIMAL  | Amount disputed               |
| complaint_reason        | VARCHAR  | Reason for complaint          |
| remitter_account_number | VARCHAR  | Sender account                |
| transaction_date        | DATETIME | Transaction timestamp         |

## 🧠 Notes

* Used as **temporary staging layer**
* Data is later moved to structured tables

---

# 📂 2. `transaction_table` (Transaction Master)

## 📌 Purpose

Stores all financial transactions.

## 🧾 Columns

| Column                     | Type         | Description           |
| -------------------------- | ------------ | --------------------- |
| transaction_id             | VARCHAR (PK) | Unique transaction ID |
| amount                     | DECIMAL      | Transaction amount    |
| beneficiary_account_number | VARCHAR      | Merchant account      |
| remitter_account_number    | VARCHAR      | Customer account      |
| transaction_date           | DATETIME     | Transaction timestamp |
| transaction_type           | VARCHAR      | Type (e.g., P2M, P2P) |

## 🧠 Notes

* Acts as **base reference table**
* Used in joins with complaints and disputes

---

# 📂 3. `complaint` (CRM Data)

## 📌 Purpose

Stores customer complaints raised against transactions.

## 🧾 Columns

| Column                     | Type         | Description                           |
| -------------------------- | ------------ | ------------------------------------- |
| crm_id                     | VARCHAR (PK) | Complaint ID                          |
| status                     | VARCHAR      | Complaint status (SUCCESS / REJECTED) |
| closure_reason             | VARCHAR      | Final resolution reason               |
| remitter_account_number    | VARCHAR      | Customer account                      |
| beneficiary_account_number | VARCHAR      | Merchant account                      |
| transaction_id             | VARCHAR (FK) | Linked transaction                    |
| amount                     | DECIMAL      | Complaint amount                      |
| transaction_date           | DATETIME     | Transaction timestamp                 |

## 🔗 Relationships

* FK → `transaction_table.transaction_id`

---

# 📂 4. `adjustment_outward_history` (Core Dispute Table)

## 📌 Purpose

Tracks the **full lifecycle of chargebacks/disputes**

👉 This is the **most important table**

---

## 🧾 Columns

| Column                     | Type     | Description                |
| -------------------------- | -------- | -------------------------- |
| id                         | INT (PK) | Auto ID                    |
| transaction_id             | VARCHAR  | Transaction reference      |
| amount                     | DECIMAL  | Transaction amount         |
| beneficiary_account_number | VARCHAR  | Merchant account           |
| remitter_account_number    | VARCHAR  | Customer account           |
| branch_code                | VARCHAR  | Bank branch                |
| adjustment_flag            | VARCHAR  | Adjustment indicator       |
| transaction_date           | DATETIME | Original transaction date  |
| adjustment_date            | DATETIME | Adjustment/chargeback date |
| remitter_bank_code         | VARCHAR  | Customer bank              |
| beneficiary_bank_code      | VARCHAR  | Merchant bank              |
| reason_code                | VARCHAR  | Dispute reason / status    |
| penalty_amount             | DECIMAL  | Penalty if applicable      |
| transaction_type           | VARCHAR  | P2M / P2P                  |

---

# 🔁 Data Behavior (VERY IMPORTANT)

Each **transaction_id can have multiple rows**:

### Example:

| transaction_id | reason_code  |
| -------------- | ------------ |
| TXN1           | B (raise)    |
| TXN1           | A (accepted) |

---

## 🧠 Interpretation

* First row → **Dispute Raised**
* Later row → **Final Outcome**

---

# 🧾 Reason Code Categories

## 🔴 Raise Codes (Dispute Initiation)

```text
B, WC, FC, FB
```

## 🟢 Success Codes (Accepted)

```text
A, FCA, WA, AP, FA, C, REF, RET
```

---

# 📊 Derived Metrics

---

# ✅ 1. RSR (Reason Success Rate)

## 📌 Definition

```text
RSR = successful disputes / total disputes (per reason)
```

## 🧠 Logic

* Group by `transaction_id`
* Extract:

  * raise_reason
  * success_flag

---

# ✅ 2. MSR (Merchant Success Rate)

## 📌 Definition

```text
MSR = successful disputes for merchant / total disputes for merchant
```

## ⚠️ Rule

```text
if total_disputes <= threshold → MSR = 0.5
```

---

# ✅ 3. BSR (Bank Success Rate)

## 📌 Definition

```text
BSR = successful disputes for bank / total disputes for bank
```

---

# ✅ 4. CCS (Customer Credibility Score)

## 📌 Definition

```text
success_rate = (successful_disputes + 1) / (valid_disputes + 2)
rejection_rate = (rejected_complaints + 1) / (total_complaints + 2)

CCS = 50 + ((x * success_rate - (1-x) * rejection_rate) * 40)
```

---

# 🔗 Relationships Summary

```text
transaction_table
    ↑
    │
complaint
    │
    ↓
adjustment_outward_history
```

---

# ⚙️ Data Flow

```text
Excel Upload
   ↓
input_staging
   ↓
(transaction + complaint)
   ↓
adjustment_outward_history
   ↓
Analytics (RSR, MSR, BSR, CCS)
```

---

# 🚀 Key Design Principles

* Normalize data across tables
* Use `transaction_id` as primary join key
* Aggregate at **transaction level (NOT row level)**
* Handle multi-row lifecycle carefully

---

# ⚠️ Common Pitfalls

❌ Counting rows instead of transactions
❌ Ignoring multiple lifecycle entries
❌ Mixing raise and success codes
❌ Not handling low sample size

---

# 🔥 Suggested Indexes

```sql
CREATE INDEX idx_txn_id ON adjustment_outward_history(transaction_id);
CREATE INDEX idx_reason ON adjustment_outward_history(reason_code);
CREATE INDEX idx_beneficiary ON adjustment_outward_history(beneficiary_account_number);
CREATE INDEX idx_bank ON adjustment_outward_history(beneficiary_bank_code);
```

---

# 🧠 Final Summary

This system:

* Tracks **end-to-end dispute lifecycle**
* Derives **behavioral + institutional metrics**
* Enables **risk scoring & prediction**

---

# 💬 Future Enhancements

* Add ML model for win prediction
* Time-based trends (last 30 days)
* Fraud detection signals
* Real-time scoring APIs

---
