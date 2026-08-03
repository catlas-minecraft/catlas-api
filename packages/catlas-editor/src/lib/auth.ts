const validReturnTo = (value: string) =>
  value.startsWith("/") && !value.startsWith("//") ? value : "/";

export const oidcLoginUrl = (returnTo = `${window.location.pathname}${window.location.search}`) => {
  const params = new URLSearchParams({ returnTo: validReturnTo(returnTo) });
  return `/api/auth/oidc/login?${params.toString()}`;
};

export const startOidcLogin = (returnTo?: string) => {
  window.location.assign(oidcLoginUrl(returnTo));
};
