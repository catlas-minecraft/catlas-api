import type { FeatureRegistry, ResolvedFeature } from "@catlas/features";
import type { EditorEntity } from "./types";

const featureKindForEntity = (entity: EditorEntity) =>
  entity.type === "node" ? "node" : entity.geometryKind;

export const assignableFeaturesForEntity = (registry: FeatureRegistry, entity: EditorEntity) => {
  return registry.features.filter(
    (feature) => featureAssignmentTags(registry, entity, feature) !== null,
  );
};

export const featureAssignmentTags = (
  registry: FeatureRegistry,
  entity: EditorEntity,
  feature: ResolvedFeature,
) => {
  const kind = featureKindForEntity(entity);
  if (!feature.editor || !feature.appliesTo.includes(kind)) return null;

  const featureTagKeys = new Set(
    registry.features
      .filter((candidate) => candidate.appliesTo.includes(kind))
      .flatMap((candidate) => Object.keys(candidate.match.tags)),
  );
  const tags = Object.fromEntries(
    Object.entries(entity.tags).filter(([key]) => !featureTagKeys.has(key)),
  );
  Object.assign(tags, feature.editor.create?.tags ?? feature.match.tags);

  return registry.resolve({ kind, tags }).primary?.id === feature.id ? tags : null;
};
