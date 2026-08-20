export type GitProvider = "github" | "azure";

export function buildAuthUrl(remoteUrl: string, provider: GitProvider, token: string): string {
  if (remoteUrl.startsWith("file://")) {
    // Used only by local test fixtures; no auth needed for filesystem-backed bare repos.
    return remoteUrl;
  }
  const u = new URL(remoteUrl);
  if (provider === "github") {
    u.username = "x-access-token";
    u.password = token;
  } else {
    u.username = "pat";
    u.password = token;
  }
  return u.toString();
}
