// Minimal structural types for the expo-sqlite surface we use. Local types
// keep the optional peer dependency out of the library's type graph (and out
// of jest's module resolution).

export type SqlParam = string | number | boolean | null | Uint8Array

export interface SqlRunResult {
  changes: number
  lastInsertRowId: number
}

export interface SqlDatabase {
  /** Run one or more semicolon-separated statements with no bindings. */
  execAsync(source: string): Promise<void>
  /** Run a parameterized write (INSERT / UPDATE / DELETE). */
  runAsync(source: string, params?: SqlParam[]): Promise<SqlRunResult>
  /** Fetch the first row, or null. */
  getFirstAsync<T>(source: string, params?: SqlParam[]): Promise<T | null>
  /** Fetch every row at once. */
  getAllAsync<T>(source: string, params?: SqlParam[]): Promise<T[]>
  /** Wrap a block of awaited queries in BEGIN/COMMIT (or ROLLBACK on throw). */
  withTransactionAsync(task: () => Promise<void>): Promise<void>
  /** Close the connection. Subsequent calls reject. */
  closeAsync(): Promise<void>
}

export interface SqlModule {
  openDatabaseAsync(databaseName: string): Promise<SqlDatabase>
  /** Remove the on-disk file. The connection must be closed first. */
  deleteDatabaseAsync(databaseName: string): Promise<void>
}
