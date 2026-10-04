import { NextResponse } from 'next/server'

export function ok<T>(data: T, init?: number) {
  return NextResponse.json(data as object, { status: init ?? 200 })
}

export function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

export async function safe<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    const data = await fn()
    return NextResponse.json(data as object)
  } catch (err) {
    console.error('[API]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error interno del servidor' },
      { status: 500 },
    )
  }
}
