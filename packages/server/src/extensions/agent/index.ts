import { createExtension } from "../../extension";
import { createDisposable } from "../../utils/disposable";

export const id = "diffs.agent";

export default createExtension(() => {
  return createDisposable(() => {});
});
