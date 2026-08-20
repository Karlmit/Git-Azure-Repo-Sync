import { api } from "../api/client";
import { usePolling } from "./usePolling";

export function useConnections(intervalMs = 10_000) {
  return usePolling(() => api.listConnections(), intervalMs);
}
