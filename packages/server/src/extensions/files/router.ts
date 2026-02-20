import { os } from "@orpc/server";
import * as z from "zod";
import { executeCommand } from "../../extension";
import { loadFile, saveFile } from "./shared";

const open = os
  .input(
    z.object({
      uri: z.string(),
    }),
  )
  .handler(async ({ input }) => executeCommand<{ uri: string }>("files.open", input.uri));

const load = os
  .input(
    z.object({
      uri: z.string(),
    }),
  )
  .handler(async ({ input }) => loadFile(input.uri));

const save = os
  .input(
    z.object({
      uri: z.string(),
      content: z.string(),
      mtime: z.number().optional(),
    }),
  )
  .handler(async ({ input }) => saveFile(input.uri, input.content, input.mtime));

const setDirty = os
  .input(
    z.object({
      uri: z.string(),
      dirty: z.boolean(),
    }),
  )
  .handler(async ({ input }) => executeCommand("files.setDirty", input.uri, input.dirty));

export const filesRouter = {
  open,
  load,
  save,
  setDirty,
};
