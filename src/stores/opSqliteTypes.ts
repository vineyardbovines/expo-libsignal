// Minimal structural types for the op-sqlite surface we use. Local types
// instead of op-sqlite's own keep the optional peer dependency out of the
// library's type graph (and out of jest's module resolution).

export type SqlScalar = string | number | boolean | null | ArrayBuffer | ArrayBufferView

export interface SqlQueryResult {
  rows: Record<string, SqlScalar>[]
}

export interface SqlTransaction {
  execute(query: string, params?: SqlScalar[]): Promise<SqlQueryResult>
}

export interface SqlDatabase {
  execute(query: string, params?: SqlScalar[]): Promise<SqlQueryResult>
  transaction(fn: (tx: SqlTransaction) => Promise<void>): Promise<void>
  close(): void
  delete(): void
}

export interface OpSqliteModule {
  open(params: { name: string; location?: string; encryptionKey?: string }): SqlDatabase
}
