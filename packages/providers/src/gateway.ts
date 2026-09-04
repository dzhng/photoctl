import { PhotoctlError } from "@photoctl/protocol";

export const DEFAULT_GATEWAY_URL = "https://ai-gateway.vercel.sh/v1";

export interface GatewayResponse<Data> {
  data: Data;
  requestId: string | null;
  attempts: number;
}

export interface GatewayOptions {
  apiKey?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  maxAttempts?: number;
  requestTimeoutMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export class GatewayClient {
  readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetcher: typeof fetch;
  private readonly maxAttempts: number;
  private readonly requestTimeoutMs: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(options: GatewayOptions) {
    this.apiKey = options.apiKey;
    const configuredBase = (options.baseUrl ?? DEFAULT_GATEWAY_URL).replace(/\/$/, "");
    this.baseUrl = configuredBase.endsWith("/v1") ? configuredBase : `${configuredBase}/v1`;
    this.fetcher = options.fetch ?? fetch;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.sleep = options.sleep ?? (async (milliseconds) => await delay(milliseconds));
    if (!Number.isSafeInteger(this.maxAttempts) || this.maxAttempts < 1 || this.maxAttempts > 5) {
      throw new Error("Gateway maxAttempts must be between 1 and 5");
    }
    if (
      !Number.isSafeInteger(this.requestTimeoutMs) ||
      this.requestTimeoutMs < 1 ||
      this.requestTimeoutMs > 120_000
    ) {
      throw new Error("Gateway requestTimeoutMs must be between 1 and 120000");
    }
  }

  async chatCompletions(body: Record<string, unknown>): Promise<GatewayResponse<unknown>> {
    return await this.request("chat/completions", jsonRequest(body));
  }

  async embeddings(body: Record<string, unknown>): Promise<GatewayResponse<unknown>> {
    return await this.request("embeddings", jsonRequest(body));
  }

  async imageGenerations(body: Record<string, unknown>): Promise<GatewayResponse<unknown>> {
    return await this.request("images/generations", jsonRequest(body));
  }

  async imageEdits(body: FormData): Promise<GatewayResponse<unknown>> {
    return await this.request("images/edits", { method: "POST", body });
  }

  private async request(path: string, init: RequestInit): Promise<GatewayResponse<unknown>> {
    if (!this.apiKey) {
      throw new PhotoctlError("provider_unconfigured", "AI_GATEWAY_API_KEY is not configured");
    }
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetcher(`${this.baseUrl}/${path}`, {
          ...init,
          signal: AbortSignal.timeout(this.requestTimeoutMs),
          headers: {
            ...Object.fromEntries(new Headers(init.headers)),
            authorization: `Bearer ${this.apiKey}`,
          },
        });
      } catch (error) {
        throw new PhotoctlError("provider_busy", "The provider request did not complete", {
          message: error instanceof Error ? error.message : String(error),
        });
      }
      if (response.status === 429) {
        if (attempt === this.maxAttempts) {
          throw new PhotoctlError("provider_busy", "The provider remained rate limited", {
            attempts: attempt,
          });
        }
        await this.sleep(retryDelay(response, attempt));
        continue;
      }
      if (!response.ok) {
        const configurationFailure = [400, 401, 403, 404].includes(response.status);
        throw new PhotoctlError(
          configurationFailure ? "provider_unconfigured" : "provider_busy",
          `Gateway request failed with HTTP ${response.status}`,
          { status: response.status },
        );
      }
      return {
        data: (await response.json()) as unknown,
        requestId: response.headers.get("x-request-id"),
        attempts: attempt,
      };
    }
    throw new Error("Unreachable gateway retry state");
  }
}

function jsonRequest(body: Record<string, unknown>): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  const seconds = retryAfter ? Number(retryAfter) : Number.NaN;
  return Number.isFinite(seconds)
    ? Math.min(Math.max(seconds * 1_000, 0), 2_000)
    : Math.min(100 * 2 ** (attempt - 1), 2_000);
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
