/**
 * The public endpoint is an unofficial DeepLX deployment. Keep it explicit so
 * users can replace it with a local or self-hosted endpoint at any time.
 */
export const DEFAULT_DEEPLX_ENDPOINT = "https://deeplx.1stg.me/translate"

const DEEPLX_TOKEN_PLACEHOLDER = /\{\{(?:apiKey|token)\}\}/g

const DEEPLX_ENDPOINT_SEPARATOR = /[\n,]+/

export function parseDeepLXEndpoints(value: unknown): string[] {
  if (typeof value !== "string") {
    return []
  }

  return [...new Set(value.split(DEEPLX_ENDPOINT_SEPARATOR).map((endpoint) => endpoint.trim()).filter(Boolean))]
}

function resolveDeepLXEndpoint(endpoint: string, token: string): string | null {
  if (DEEPLX_TOKEN_PLACEHOLDER.test(endpoint) && !token) {
    DEEPLX_TOKEN_PLACEHOLDER.lastIndex = 0
    return null
  }

  DEEPLX_TOKEN_PLACEHOLDER.lastIndex = 0
  return endpoint.replace(DEEPLX_TOKEN_PLACEHOLDER, encodeURIComponent(token))
}

/** Configured endpoints in fallback order; the public deployment is used when none is usable. */
export function getDeepLXEndpoints(configuredURL: unknown, token = ""): string[] {
  const resolvedEndpoints = parseDeepLXEndpoints(configuredURL)
    .map((endpoint) => resolveDeepLXEndpoint(endpoint, token))
    .filter((endpoint): endpoint is string => endpoint !== null)
  return resolvedEndpoints.length > 0 ? resolvedEndpoints : [DEFAULT_DEEPLX_ENDPOINT]
}
