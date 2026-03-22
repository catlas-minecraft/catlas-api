import { HttpApiBuilder, HttpMiddleware } from "@effect/platform";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Layer } from "effect";
import { createServer } from "node:http";
import { ApiLive } from "./Api.js";
import { makeDatabaseLayerFromConfig } from "@catlas/db";
import { JwtServiceLive } from "./auth/AuthSessionManager.js";
import { SessionRepositoryLive } from "./auth/KyselySessionRepository.js";
import { DevTools } from "@effect/experimental";

const DevToolsLive = DevTools.layer();

const HttpLive = HttpApiBuilder.serve(HttpMiddleware.logger).pipe(
  Layer.provide(ApiLive),
  Layer.provide(SessionRepositoryLive),
  Layer.provide(JwtServiceLive),
  Layer.provide(makeDatabaseLayerFromConfig()),
  Layer.provide(DevToolsLive),
  Layer.provide(NodeHttpServer.layer(createServer, { port: 3000 })),
);

NodeRuntime.runMain(Layer.launch(HttpLive));
