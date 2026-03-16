import { z } from "zod";

export const uuidQueryParam = z.preprocess(
  (value) => (Array.isArray(value) ? value[0] : value),
  z.string().trim().uuid()
);
