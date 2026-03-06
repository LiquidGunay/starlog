export class ApiError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(`HTTP ${status}: ${body}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export async function apiRequest<T>(
  apiBase: string,
  token: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new ApiError(response.status, body);
  }

  const body = await response.text();
  if (!body.trim()) {
    return undefined as T;
  }
  return JSON.parse(body) as T;
}
