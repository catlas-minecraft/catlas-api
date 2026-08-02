export const changesetsQueryKey = (worldSlug: string) =>
  ["worlds", worldSlug, "changesets"] as const;
