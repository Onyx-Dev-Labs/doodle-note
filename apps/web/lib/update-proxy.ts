export function updateProxyRequestHeaders(request: Request): Headers {
  const headers = new Headers();
  const range = request.headers.get("range");
  if (range) headers.set("range", range);
  return headers;
}

export function updateProxyResponseInit(
  name: string,
  upstream: Response,
): { status: number; headers: Headers } {
  const isManifest = name.endsWith(".yml");
  const headers = new Headers({
    "content-type":
      upstream.headers.get("content-type") ?? "application/octet-stream",
    "cache-control": isManifest
      ? "public, max-age=60"
      : "public, max-age=31536000, immutable",
  });

  for (const name of [
    "accept-ranges",
    "content-length",
    "content-range",
    "etag",
    "last-modified",
  ]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }

  return { status: upstream.status, headers };
}
