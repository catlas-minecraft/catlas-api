import { Api } from "@catlas/domain/Api";
import type { BBox2D } from "@catlas/domain/GeospatialApi";
import { BBox2D as BBox2DSchema, CurrentActor, ValidationError } from "@catlas/domain/GeospatialApi";
import { HttpApiBuilder } from "@effect/platform";
import { Effect, Layer } from "effect";
import { AuthSessionManagerLive } from "../auth/AuthSessionManager.js";
import { WriteAuthorizationLive } from "../auth/CurrentActor.js";
import { GeospatialRepository, GeospatialRepositoryLive } from "./GeospatialRepository.js";

const parseBbox = (raw: string): Effect.Effect<BBox2D, ValidationError> => {
  const parts = raw.split(",").map((part) => Number(part.trim()));

  if (parts.length !== 4 || parts.some((value) => Number.isNaN(value))) {
    return Effect.fail(
      new ValidationError({
        message: "bbox must be a comma separated list of minX,minY,maxX,maxY",
      }),
    );
  }

  const [minX, minY, maxX, maxY] = parts as [number, number, number, number];

  if (minX > maxX || minY > maxY) {
    return Effect.fail(
      new ValidationError({
        message: "bbox min values must not exceed max values",
      }),
    );
  }

  return Effect.succeed(new BBox2DSchema({ minX, minY, maxX, maxY }));
};

export const ViewportApiLive = HttpApiBuilder.group(Api, "viewport", (handlers) =>
  Effect.gen(function* () {
    const repository = yield* GeospatialRepository;

    return handlers.handle("getViewport", ({ urlParams: { bbox, includeRelations } }) =>
      parseBbox(bbox).pipe(
        Effect.flatMap((parsedBbox) =>
          repository.loadViewport({
            bbox: parsedBbox,
            includeRelations,
          }),
        ),
      ),
    );
  }),
);

export const ChangesetsApiLive = HttpApiBuilder.group(Api, "changesets", (handlers) =>
  Effect.gen(function* () {
    const repository = yield* GeospatialRepository;

    return handlers
      .handle("createChangeset", ({ payload: { comment } }) =>
        CurrentActor.pipe(
          Effect.flatMap(({ actorId }) => repository.createChangeset(comment, actorId))
        ),
      )
      .handle("publishChangeset", ({ path: { id } }) => repository.publishChangeset(id))
      .handle("abandonChangeset", ({ path: { id } }) => repository.abandonChangeset(id));
  }),
);

export const NodesApiLive = HttpApiBuilder.group(Api, "nodes", (handlers) =>
  Effect.gen(function* () {
    const repository = yield* GeospatialRepository;

    return handlers
      .handle("createNode", ({ payload }) =>
        CurrentActor.pipe(
          Effect.flatMap(({ actorId }) => repository.createNode({ ...payload, actorId }))
        ),
      )
      .handle("updateNode", ({ path: { id }, payload }) =>
        CurrentActor.pipe(
          Effect.flatMap(({ actorId }) => repository.updateNode(id, { ...payload, actorId }))
        ),
      )
      .handle("deleteNode", ({ path: { id }, payload }) =>
        CurrentActor.pipe(
          Effect.flatMap(({ actorId }) => repository.deleteNode(id, { ...payload, actorId }))
        ),
      );
  }),
);

export const WaysApiLive = HttpApiBuilder.group(Api, "ways", (handlers) =>
  Effect.gen(function* () {
    const repository = yield* GeospatialRepository;

    return handlers
      .handle("createWay", ({ payload }) =>
        CurrentActor.pipe(
          Effect.flatMap(({ actorId }) => repository.createWay({ ...payload, actorId }))
        ),
      )
      .handle("updateWay", ({ path: { id }, payload }) =>
        CurrentActor.pipe(
          Effect.flatMap(({ actorId }) => repository.updateWay(id, { ...payload, actorId }))
        ),
      )
      .handle("deleteWay", ({ path: { id }, payload }) =>
        CurrentActor.pipe(
          Effect.flatMap(({ actorId }) => repository.deleteWay(id, { ...payload, actorId }))
        ),
      );
  }),
);

export const RelationsApiLive = HttpApiBuilder.group(Api, "relations", (handlers) =>
  Effect.gen(function* () {
    const repository = yield* GeospatialRepository;

    return handlers
      .handle("createRelation", ({ payload }) =>
        CurrentActor.pipe(
          Effect.flatMap(({ actorId }) => repository.createRelation({ ...payload, actorId }))
        ),
      )
      .handle("updateRelation", ({ path: { id }, payload }) =>
        CurrentActor.pipe(
          Effect.flatMap(({ actorId }) => repository.updateRelation(id, { ...payload, actorId }))
        ),
      )
      .handle("deleteRelation", ({ path: { id }, payload }) =>
        CurrentActor.pipe(
          Effect.flatMap(({ actorId }) => repository.deleteRelation(id, { ...payload, actorId }))
        ),
      );
  }),
);

const GeospatialApiLive = Layer.mergeAll(
  ViewportApiLive,
  ChangesetsApiLive,
  NodesApiLive,
  WaysApiLive,
  RelationsApiLive,
);

export const GeospatialLive = Layer.provide(GeospatialApiLive, GeospatialRepositoryLive).pipe(
  Layer.provide(WriteAuthorizationLive),
  Layer.provide(AuthSessionManagerLive),
);
