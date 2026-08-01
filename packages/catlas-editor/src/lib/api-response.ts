const responseError = async (response: Response, error: unknown) => {
  let detail = "";
  if (error !== undefined) {
    detail = typeof error === "string" ? error : JSON.stringify(error);
  } else {
    const text = await response.text();
    if (text) {
      try {
        const body: unknown = JSON.parse(text);
        detail =
          typeof body === "object" && body !== null && "message" in body
            ? String(body.message)
            : text;
      } catch {
        detail = text;
      }
    }
  }
  return new Error(
    detail || `API request failed (${response.status} ${response.statusText || "Unknown error"}).`,
    { cause: response },
  );
};

export const json = async <T>(result: {
  data?: T;
  error?: unknown;
  response: Response;
}): Promise<T> => {
  if (!result.response.ok) throw await responseError(result.response, result.error);
  if (result.error !== undefined || result.data === undefined) {
    throw await responseError(result.response, result.error);
  }
  return result.data;
};

export const noContent = async (result: { error?: unknown; response: Response }) => {
  if (!result.response.ok || result.error !== undefined) {
    throw await responseError(result.response, result.error);
  }
};
