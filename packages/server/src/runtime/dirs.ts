import { tmpdir } from "node:os"

import { resolve } from "./path"

/** Wipeable runtime cache for derived/temporary media work. */
export const MEDIA_CACHE_DIR = resolve(tmpdir(), "alloy-server", "media")
