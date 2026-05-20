import { ApiError } from './client';

/** Generic SWR fetcher that returns typed JSON */
export async function fetcher<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    const error = await response.text().catch(() => response.statusText);
    throw new ApiError(response.status, `请求失败 (${response.status}): ${error}`);
  }
  return response.json() as Promise<T>;
}
