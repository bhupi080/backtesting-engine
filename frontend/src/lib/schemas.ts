import { type } from "arktype"

export const Health = type({ status: "string" })
export const Dataset = type({
  id: "string",
  symbol: "string",
  path_glob: "string",
  file_count: "number",
  row_count: "number",
  "min_time_utc?": "string | null",
  "max_time_utc?": "string | null",
})
