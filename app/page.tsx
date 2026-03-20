"use client";

import { ChangeEvent, useState, useTransition } from "react";

type PreviewRow = {
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

type UploadResult = {
  fileName: string;
  generatedFileName: string;
  totalRowsRead: number;
  insertedRows: number;
  insertedScoredRows: number;
  skippedRows: number;
  previewRows: PreviewRow[];
};

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [downloadFormat, setDownloadFormat] = useState<"xlsx" | "csv">("xlsx");
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    setError(null);
  }

  async function upload(responseMode: "json" | "file") {
    if (!file) {
      setError("Select a .csv, .xls, or .xlsx file first.");
      return;
    }

    setError(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("replaceExisting", String(replaceExisting));
    formData.append("responseMode", responseMode);
    formData.append("downloadFormat", downloadFormat);

    const response = await fetch("/api/input-staging/upload", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      throw new Error(payload?.error ?? "Upload failed");
    }

    if (responseMode === "file") {
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition");
      const fileName =
        disposition?.match(/filename="(.+)"/)?.[1] ??
        `scored_upload.${downloadFormat}`;

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      return;
    }

    const payload = (await response.json()) as { data: UploadResult };
    setResult(payload.data);
  }

  function handlePreview() {
    startTransition(async () => {
      try {
        await upload("json");
      } catch (uploadError) {
        setError(
          uploadError instanceof Error ? uploadError.message : "Upload failed"
        );
      }
    });
  }

  function handleDownload() {
    startTransition(async () => {
      try {
        await upload("file");
      } catch (uploadError) {
        setError(
          uploadError instanceof Error ? uploadError.message : "Download failed"
        );
      }
    });
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f4efe6_0%,#fffaf1_45%,#f3f7f0_100%)] px-4 py-10 text-slate-900 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <section className="overflow-hidden rounded-[28px] border border-black/10 bg-white/85 p-6 shadow-[0_24px_80px_rgba(82,61,24,0.12)] backdrop-blur sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-amber-700">
                Chargeback Upload Desk
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-5xl">
                Upload raw complaints and preview the scored decision output.
              </h1>
              <p className="mt-4 max-w-xl text-sm leading-7 text-slate-600 sm:text-base">
                The file is staged, enriched with success probability, return
                probability, action to be taken, and fraud detection, then made
                available as a scored result file.
              </p>
            </div>
            <div className="rounded-3xl bg-slate-950 px-5 py-4 text-sm text-slate-100">
              <p className="font-medium">Accepted formats</p>
              <p className="mt-1 text-slate-300">CSV, XLS, XLSX</p>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[28px] border border-black/10 bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
            <h2 className="text-xl font-semibold">Upload</h2>
            <p className="mt-2 text-sm text-slate-600">
              Choose a file, preview the scored rows, then download the final
              result.
            </p>

            <div className="mt-6 space-y-5">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">
                  Input file
                </span>
                <input
                  type="file"
                  accept=".csv,.xls,.xlsx"
                  onChange={onFileChange}
                  className="block w-full rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-700 file:mr-4 file:rounded-full file:border-0 file:bg-amber-600 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-amber-700"
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">
                    Result format
                  </span>
                  <select
                    value={downloadFormat}
                    onChange={(event) =>
                      setDownloadFormat(event.target.value as "xlsx" | "csv")
                    }
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800"
                  >
                    <option value="xlsx">Excel (.xlsx)</option>
                    <option value="csv">CSV (.csv)</option>
                  </select>
                </label>

                <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={replaceExisting}
                    onChange={(event) => setReplaceExisting(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-amber-600"
                  />
                  <span className="text-sm text-slate-700">
                    Replace existing staged rows
                  </span>
                </label>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={handlePreview}
                  disabled={isPending}
                  className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                >
                  {isPending ? "Processing..." : "Upload and Preview"}
                </button>
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={isPending}
                  className="rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-medium text-slate-900 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                >
                  Download Result File
                </button>
              </div>

              {file ? (
                <div className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  Selected file: <span className="font-medium">{file.name}</span>
                </div>
              ) : null}

              {error ? (
                <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {error}
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-[28px] border border-black/10 bg-slate-950 p-6 text-slate-50 shadow-[0_18px_40px_rgba(15,23,42,0.18)]">
            <h2 className="text-xl font-semibold">Result Summary</h2>
            <p className="mt-2 text-sm text-slate-300">
              Preview mode returns metadata and the first scored rows so you can
              inspect the output before downloading.
            </p>

            {result ? (
              <div className="mt-6 grid gap-3 text-sm">
                <SummaryItem label="Source file" value={result.fileName} />
                <SummaryItem
                  label="Generated file"
                  value={result.generatedFileName}
                />
                <SummaryItem
                  label="Rows read"
                  value={String(result.totalRowsRead)}
                />
                <SummaryItem
                  label="Inserted to staging"
                  value={String(result.insertedRows)}
                />
                <SummaryItem
                  label="Inserted to scored table"
                  value={String(result.insertedScoredRows)}
                />
                <SummaryItem
                  label="Skipped rows"
                  value={String(result.skippedRows)}
                />
              </div>
            ) : (
              <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 px-4 py-5 text-sm text-slate-300">
                No preview yet. Upload a file to inspect the first scored rows.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-[28px] border border-black/10 bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold">Preview Rows</h2>
              <p className="text-sm text-slate-600">
                First 10 scored rows returned by the upload endpoint in preview
                mode.
              </p>
            </div>
          </div>

          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
              <thead>
                <tr className="text-slate-500">
                  {[
                    "CRM ID",
                    "Transaction ID",
                    "Amount",
                    "Reason",
                    "Remitter",
                    "Success Prob",
                    "Return Prob",
                    "Action",
                    "Fraud",
                  ].map((label) => (
                    <th
                      key={label}
                      className="border-b border-slate-200 px-4 py-3 font-medium"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result?.previewRows?.length ? (
                  result.previewRows.map((row) => (
                    <tr key={`${row.crm_id}-${row.transaction_id}`}>
                      <td className="border-b border-slate-100 px-4 py-3">
                        {row.crm_id}
                      </td>
                      <td className="border-b border-slate-100 px-4 py-3">
                        {row.transaction_id}
                      </td>
                      <td className="border-b border-slate-100 px-4 py-3">
                        {row.complaint_amount}
                      </td>
                      <td className="border-b border-slate-100 px-4 py-3">
                        {row.complaint_reason ?? "-"}
                      </td>
                      <td className="border-b border-slate-100 px-4 py-3">
                        {row.remitter_account_number}
                      </td>
                      <td className="border-b border-slate-100 px-4 py-3">
                        {row.success_probability}
                      </td>
                      <td className="border-b border-slate-100 px-4 py-3">
                        {row.return_probability}
                      </td>
                      <td className="border-b border-slate-100 px-4 py-3">
                        <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900">
                          {row.action_to_be_taken}
                        </span>
                      </td>
                      <td className="border-b border-slate-100 px-4 py-3">
                        {row.fraud_detection}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-4 py-10 text-center text-sm text-slate-500"
                    >
                      Upload a file to populate the preview table.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
      <span className="text-slate-300">{label}</span>
      <span className="font-medium text-white">{value}</span>
    </div>
  );
}
