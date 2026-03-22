import { HttpApiBuilder, HttpApiScalar, HttpMiddleware } from "@effect/platform";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Layer } from "effect";
import { createServer } from "node:http";
import { makeDatabaseLayerFromConfig } from "@catlas/db";
import { DevTools } from "@effect/experimental";
import { ApiLive } from "./Api.js";
import { JwtServiceLive } from "./auth/AuthSessionManager.js";
import { SessionRepositoryLive } from "./auth/KyselySessionRepository.js";

const DevToolsLive = DevTools.layer();

const DocsLive = HttpApiScalar.layer({
  path: "/docs",
  scalar: {
    theme: "bluePlanet",
    layout: "modern",
    darkMode: false,
  },
});

const HttpLive = HttpApiBuilder.serve(HttpMiddleware.logger).pipe(
  Layer.provide(DocsLive),
  Layer.provide(ApiLive),
  Layer.provide(SessionRepositoryLive),
  Layer.provide(JwtServiceLive),
  Layer.provide(makeDatabaseLayerFromConfig()),
  Layer.provide(DevToolsLive),
  Layer.provide(NodeHttpServer.layer(createServer, { port: 3000 })),
);

NodeRuntime.runMain(Layer.launch(HttpLive));
