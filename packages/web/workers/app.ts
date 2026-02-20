/// <reference types="@cloudflare/workers-types" />
import { createRequestHandler } from "react-router";

import * as build from "virtual:react-router/server-build";

const requestHandler = createRequestHandler(build);

export default {
  fetch(request, env, ctx) {
    return requestHandler(request, {
      cloudflare: { env, ctx },
    });
  },
} satisfies ExportedHandler<Env>;
