import createClient from "openapi-fetch";
import { json, noContent } from "./api-response";
import type { components } from "./editor/catlas-api.gen";
import type { paths } from "./editor/catlas-api.gen";

export type World = components["schemas"]["World"];
export type Session = components["schemas"]["SessionInfo"];

const client = createClient<paths>({
  baseUrl: "/api",
  credentials: "include",
});

export const listWorlds = async () => json<World[]>(await client.GET("/worlds"));
export const getWorld = async (worldSlug: string) =>
  json<World>(
    await client.GET("/worlds/{worldSlug}", {
      params: { path: { worldSlug } },
    }),
  );
export const createWorld = async (body: components["schemas"]["WorldInput"]) =>
  json<World>(await client.POST("/worlds", { body }));

export const getSession = async () => json<Session>(await client.GET("/auth/session"));
export const createSession = async (userId: string) =>
  json<Session>(await client.POST("/auth/session", { body: { userId } }));
export const deleteSession = async () => noContent(await client.DELETE("/auth/session"));

export const validWorldSlug = (value: string) =>
  value.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
