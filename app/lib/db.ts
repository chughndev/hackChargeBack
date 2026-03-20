import path from "node:path";
import sqlite3 from "sqlite3";

const databaseFilename = process.env.SQLITE_DB_FILE ?? "database.db";
const databasePath = path.join(process.cwd(), databaseFilename);
const sqlite = new sqlite3.Database(databasePath);

type StatementParams = readonly unknown[] | unknown[];

type QueryResult = {
  affectedRows: number;
  lastInsertRowid?: number;
};

function normalizeParams(params?: StatementParams) {
  return params ?? [];
}

function isSelectStatement(sql: string) {
  return /^\s*(with\b[\s\S]*?select\b|select\b)/i.test(sql);
}

function all<T>(sql: string, params?: StatementParams) {
  return new Promise<T[]>((resolve, reject) => {
    sqlite.all(sql, normalizeParams(params), (error, rows) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(rows as T[]);
    });
  });
}

function run(sql: string, params?: StatementParams) {
  return new Promise<QueryResult>((resolve, reject) => {
    sqlite.run(sql, normalizeParams(params), function onRun(error) {
      if (error) {
        reject(error);
        return;
      }

      resolve({
        affectedRows: this.changes ?? 0,
        lastInsertRowid:
          typeof this.lastID === "number" ? this.lastID : undefined,
      });
    });
  });
}

function exec(sql: string) {
  return new Promise<void>((resolve, reject) => {
    sqlite.exec(sql, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function query<T>(sql: string, params?: StatementParams): Promise<[T]> {
  if (isSelectStatement(sql)) {
    return [(await all(sql, params)) as T];
  }

  return [(await run(sql, params)) as T];
}

type TransactionConnection = {
  beginTransaction: () => Promise<void>;
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
  query: <T>(sql: string, params?: StatementParams) => Promise<[T]>;
  release: () => void;
};

async function getConnection(): Promise<TransactionConnection> {
  return {
    async beginTransaction() {
      await exec("BEGIN TRANSACTION");
    },
    async commit() {
      await exec("COMMIT");
    },
    async rollback() {
      await exec("ROLLBACK");
    },
    async query<T>(sql: string, params?: StatementParams) {
      return query<T>(sql, params);
    },
    release() {},
  };
}

export const db = {
  query,
  getConnection,
};
