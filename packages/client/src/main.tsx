import "@fontsource/jetbrains-mono";

import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./components/app";
import { Toaster } from "./components/ui/toaster";
import { queryClient } from "./lib/query-client";
import { init } from "./lib/rpc";

init().then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
        <Toaster />
      </QueryClientProvider>
    </React.StrictMode>,
  );
});
