/** TorBox-style envelope used on every consumer-facing response. */
export type Envelope<T = unknown> = { success: boolean; error: string | null; detail: string; data: T };
export const ok = <T>(data: T, detail = 'OK'): Envelope<T> => ({ success: true, error: null, detail, data });
export const fail = (error: string, detail: string, data: unknown = null): Envelope => ({ success: false, error, detail, data });

export class GatewayError extends Error {
  constructor(public status: number, public code: string, message: string, public data: unknown = null) {
    super(message);
  }
}
/** TorBox error codes ending in _ERROR are upstream faults (retryable); others are client faults. */
export const isUpstreamFault = (code: string | null | undefined) => !!code && code.endsWith('_ERROR');
