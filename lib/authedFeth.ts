type AuthUser = {
  getIdToken: () => Promise<string>;
};

export async function authedFetch(
  user: AuthUser,
  input: RequestInfo | URL,
  init: RequestInit = {},
) {
  const token = await user.getIdToken();
  const orgId = localStorage.getItem("pf_active_org") || "";

  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Content-Type", "application/json");
  if (orgId) headers.set("x-org-id", orgId);

  return fetch(input, { ...init, headers });
}


