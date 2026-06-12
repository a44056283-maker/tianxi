declare module 'pg' {
  export class Client {
    constructor(config?: Record<string, unknown>)
    connect(): Promise<void>
    query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>
    end(): Promise<void>
  }
}

