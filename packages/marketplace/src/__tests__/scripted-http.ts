import type { MarketplaceHttpRequest, MarketplaceHttpResponse } from "../core/adapter";

/** Answer each request with the next scripted response (the last one repeats). */
export function scriptedHttp(
  responses: MarketplaceHttpResponse[] | ((req: MarketplaceHttpRequest) => MarketplaceHttpResponse | Promise<MarketplaceHttpResponse>),
) {
  const requests: MarketplaceHttpRequest[] = [];
  const http = async (request: MarketplaceHttpRequest): Promise<MarketplaceHttpResponse> => {
    requests.push(request);
    if (typeof responses === "function") return responses(request);
    const response = responses[Math.min(requests.length - 1, responses.length - 1)];
    if (!response) throw new Error("no scripted response");
    return response;
  };
  return { http, requests };
}
