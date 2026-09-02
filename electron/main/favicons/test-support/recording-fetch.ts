/**
 * A `fetch` stand-in that **records every URL it is asked for**.
 *
 * This exists because of one acceptance criterion in T-260828-49: no
 * third-party favicon service may be contacted "from any code path — asserted
 * by a test over the source *and over the actual request target*, not by
 * reading the diff". A mock of `fetchFavicon` would assert nothing about that;
 * a mock of `fetch` that discards its argument would assert nothing either.
 * So the tests run the real fetcher, with its real redirect walk, its real
 * size cap and its real timeout, against this — and then read back the exact
 * list of URLs it was handed.
 *
 * Test-support only. Nothing in `electron/main/favicons/` imports it.
 */

export interface RouteResponse {
  readonly status?: number
  readonly headers?: Record<string, string>
  readonly body?: Uint8Array | string
  /** Streams the body in chunks, so the size cap is exercised mid-stream rather than after the fact. */
  readonly chunks?: readonly Uint8Array[]
  /** Never resolves; the fetcher's own AbortController is what ends it. Used for the timeout case. */
  readonly hang?: true
  /** Answers headers at once, then a body stream that never closes — until the request's signal aborts, when the read rejects the way undici's does. */
  readonly stallBody?: true
  /** Rejects, as a DNS failure or a refused connection would. */
  readonly networkError?: true
}

export interface RecordingFetch {
  readonly fetch: typeof globalThis.fetch
  /** Every URL passed to `fetch`, in order, including each redirect hop. */
  readonly calls: string[]
}

const NOT_FOUND: RouteResponse = { status: 404 }

/**
 * `routes` is keyed by exact URL. Anything not listed answers 404, which is
 * the honest default: a host that serves no `/favicon.ico` and declares no
 * `<link rel="icon">` is the ordinary case, not an error.
 */
export function recordingFetch(routes: Record<string, RouteResponse>): RecordingFetch {
  const calls: string[] = []

  // `Parameters<typeof fetch>[0]` rather than the DOM's `RequestInfo`: this
  // file typechecks under tsconfig.node.json, whose lib does not declare that
  // name even though `fetch` itself is present.
  const fetchImpl = (async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push(url)
    const route = routes[url] ?? NOT_FOUND

    if (route.networkError) throw new TypeError('fetch failed')

    if (route.hang) {
      return await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (!signal) return
        signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), { once: true })
      })
    }

    const status = route.status ?? 200
    const headers = new Headers(route.headers ?? {})

    if (route.stallBody) {
      const signal = init?.signal
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          signal?.addEventListener('abort', () => controller.error(new DOMException('The operation was aborted.', 'AbortError')), { once: true })
        }
      })
      return new Response(stream, { status, headers })
    }

    if (route.chunks) {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of route.chunks ?? []) controller.enqueue(chunk)
          controller.close()
        }
      })
      return new Response(stream, { status, headers })
    }

    // A 3xx with no body: `Response` refuses a body for 204/304 anyway, and a
    // redirect's payload is never read.
    if (status >= 300 && status < 400) return new Response(null, { status, headers })

    const body = typeof route.body === 'string' ? new TextEncoder().encode(route.body) : route.body
    return new Response(body ?? new Uint8Array(0), { status, headers })
  }) as typeof globalThis.fetch

  return { fetch: fetchImpl, calls }
}

/** A minimal but genuinely well-formed PNG signature plus filler — enough for `sniffImageContentType`, which reads the header and nothing else. */
export function pngBytes(): Uint8Array {
  const bytes = new Uint8Array(64)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  return bytes
}

/** As `pngBytes`, for the `/favicon.ico` path. */
export function icoBytes(): Uint8Array {
  const bytes = new Uint8Array(64)
  bytes.set([0x00, 0x00, 0x01, 0x00, 0x01, 0x00], 0)
  return bytes
}
