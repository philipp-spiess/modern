import type { AppLoadContext, EntryContext } from "react-router";
import { ServerRouter } from "react-router";
import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server";

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: AppLoadContext,
) {
  let body;
  const userAgent = request.headers.get("user-agent");

  if (isbot(userAgent)) {
    await (routerContext as any).ready;
    body = await renderToReadableStream(<ServerRouter context={routerContext} url={request.url} />, {
      signal: request.signal,
      onError(error: unknown) {
        responseStatusCode = 500;
        // Log streaming rendering errors from inside the shell
        console.error(error);
      },
    });
    await body.allReady;
  } else {
    body = await renderToReadableStream(<ServerRouter context={routerContext} url={request.url} />, {
      signal: request.signal,
      onError(error: unknown) {
        responseStatusCode = 500;
        // Log streaming rendering errors from inside the shell
        console.error(error);
      },
    });
  }

  responseHeaders.set("Content-Type", "text/html");
  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}
