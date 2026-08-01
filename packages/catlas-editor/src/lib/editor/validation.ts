import { Graph } from "../graph";
import type { EntityRef, ValidationIssue } from "./types";

const RESERVED_TAGS = new Set([
  "relation_type",
  "geometry_kind",
  "is_closed",
  "version",
  "deleted_at",
  "changeset_id",
]);

const issue = (
  id: string,
  severity: "error" | "warning",
  message: string,
  entity: EntityRef | null,
): ValidationIssue => ({ id, severity, message, entity });

export const validateGraph = (graph: Graph): readonly ValidationIssue[] => {
  const issues: ValidationIssue[] = [];

  for (const entity of graph.entities()) {
    const ref = { type: entity.type, id: entity.id } as const;

    for (const key of Object.keys(entity.tags)) {
      if (RESERVED_TAGS.has(key)) {
        issues.push(
          issue(
            `${entity.type}-${entity.id}-tag-${key}`,
            "error",
            `Tag '${key}' is reserved.`,
            ref,
          ),
        );
      }
    }

    if (entity.type === "node") {
      if (![entity.geom.x, entity.geom.y, entity.geom.z].every(Number.isFinite)) {
        issues.push(
          issue(`node-${entity.id}-coordinate`, "error", "Coordinates must be finite.", ref),
        );
      }
      continue;
    }

    for (const nodeId of entity.nodeIds) {
      if (!graph.node(nodeId)) {
        issues.push(
          issue(
            `way-${entity.id}-missing-${nodeId}`,
            "error",
            `Referenced node ${nodeId} is missing.`,
            ref,
          ),
        );
      }
    }

    if (entity.nodeIds.some((nodeId, index) => index > 0 && nodeId === entity.nodeIds[index - 1])) {
      issues.push(
        issue(
          `way-${entity.id}-duplicate`,
          "error",
          "Consecutive vertices must be different.",
          ref,
        ),
      );
    }

    if (entity.geometryKind === "line" && entity.nodeIds.length < 2) {
      issues.push(
        issue(`way-${entity.id}-short`, "error", "A line needs at least two vertices.", ref),
      );
    }

    if (entity.geometryKind === "area") {
      const closed = entity.nodeIds[0] === entity.nodeIds.at(-1);
      if (!closed) {
        issues.push(issue(`way-${entity.id}-open`, "error", "An area must be closed.", ref));
      }
      if (new Set(entity.nodeIds.slice(0, -1)).size < 3) {
        issues.push(
          issue(`way-${entity.id}-short`, "error", "An area needs at least three vertices.", ref),
        );
      }
    }
  }

  return issues;
};
