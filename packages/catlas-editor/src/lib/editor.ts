import * as d3 from "d3";
import {
  defaultFeatureRegistry,
  type FeatureRegistry,
  type FeatureResolution,
  type ResolvedFeature,
} from "@catlas/features";
import type { Graph } from "./graph";
import { addEntities, insertNodeIntoWay, moveNode, updateEntityProperties } from "./editor/actions";
import { createEditorApi, type EditorApiService } from "./editor/api-client";
import { buildChangesetReview, type ChangesetReview } from "./editor/changeset";
import { History } from "./editor/history";
import { getOperation, type Operation, type OperationId } from "./editor/operations";
import { CanvasClickSuppression } from "./editor/input";
import { snapPoint } from "./editor/snapping";
import { EntitySvgLayer } from "./editor/renderer";
import { loadViewportEntities, saveGraph } from "./editor/sync";
import { TileCanvasLayer } from "./editor/tiles";
import type {
  DrawingState,
  EditorAuthConfig,
  EditorAuthState,
  EditorContextMenu,
  EditorEntity,
  EditorMode,
  EditorSaveState,
  EditorSnapshot,
  EntityRef,
  Point3D,
  SnapPolicy,
} from "./editor/types";
import { entityKey, sameEntityRef } from "./editor/types";
import {
  createSvgElement,
  getElementSize,
  getInitialTransform,
  getViewportBbox,
  getViewportExtent,
  getZoomScaleExtent,
  screenToWorld,
} from "./editor/util";
import { validateFeatureFields, validateGraph } from "./editor/validation";
import { featureAssignmentTags } from "./editor/features";

export type CatlasEditorOptions = {
  readonly worldSlug: string;
  readonly apiBaseUrl?: string;
  readonly featureRegistry?: FeatureRegistry;
  readonly tileUrl?: string;
};

type ActiveDrag = {
  readonly captureTarget: Element;
  readonly nodeId: number;
  readonly pointerId: number;
  readonly start: Point3D;
  current: Point3D;
};

type ChangePreview = {
  readonly graph: Graph;
  readonly ref: EntityRef;
};

const ENTITY_CONTEXT_MENU_EVENT = Symbol("catlas.entity-context-menu");

type EntityContextMenuEvent = MouseEvent & {
  [ENTITY_CONTEXT_MENU_EVENT]?: true;
};

const modeGeometry = (mode: EditorMode) => {
  if (mode === "add-point") return "point";
  if (mode === "draw-line") return "line";
  if (mode === "draw-area") return "area";
  return null;
};

const compactErrorMessage = (message: string) => {
  let compact = message;
  if (message.startsWith("{")) {
    try {
      const parsed = JSON.parse(message) as { readonly message?: unknown };
      if (typeof parsed.message === "string") compact = parsed.message;
    } catch {
      // Keep the original message when it is not valid JSON.
    }
  }
  if (compact.includes("502 GET") || compact.includes("ECONNREFUSED")) {
    return "The Catlas API is unavailable. You can continue editing locally and retry later.";
  }
  return compact;
};

const errorMessage = (error: unknown) => {
  if (error instanceof Error) return compactErrorMessage(error.message);
  if (typeof error === "object" && error !== null && "message" in error) {
    return compactErrorMessage(String(error.message));
  }
  return "An unexpected error occurred.";
};

export class CatlasEditor {
  readonly worldSlug: string;
  readonly #api: EditorApiService;
  readonly #featureRegistry: FeatureRegistry;
  readonly #history = new History();
  readonly #listeners = new Set<() => void>();
  readonly #overlay: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  readonly #renderer: EntitySvgLayer;
  readonly #resizeObserver: ResizeObserver;
  readonly #root: HTMLDivElement;
  readonly #tiles: TileCanvasLayer;
  readonly #zoom: d3.ZoomBehavior<SVGSVGElement, unknown>;
  #activeDrag: ActiveDrag | null = null;
  #activeFeatureId: string | null = null;
  #authState: EditorAuthState = { status: "checking" };
  #authConfig: EditorAuthConfig = { oidcEnabled: false, developerAuthEnabled: false };
  readonly #canvasClickSuppression = new CanvasClickSuppression();
  #changePreview: ChangePreview | null = null;
  #changesetReviewCache: {
    readonly base: Graph;
    readonly current: Graph;
    readonly review: ChangesetReview;
  } | null = null;
  #contextMenu: EditorContextMenu | null = null;
  #cursor: Point3D | null = null;
  #cursorFrame: number | null = null;
  #disposed = false;
  #drawing: DrawingState | null = null;
  #loadError: string | null = null;
  #loading = true;
  #mode: EditorMode = "browse";
  #nextLocalNodeId = -1;
  #nextLocalWayId = -1;
  #requestId = 0;
  #saveState: EditorSaveState = { status: "idle" };
  #selection: EntityRef | null = null;
  #snapshot: EditorSnapshot;
  #transform: d3.ZoomTransform;
  #transientNode: { readonly id: number; readonly geom: Point3D } | null = null;

  constructor(root: HTMLDivElement, options: CatlasEditorOptions) {
    this.#root = root;
    this.worldSlug = options.worldSlug;
    this.#api = createEditorApi(options.apiBaseUrl ?? window.location.origin, options.worldSlug);
    this.#featureRegistry = options.featureRegistry ?? defaultFeatureRegistry;
    this.#tiles = new TileCanvasLayer(root, options.tileUrl);

    const overlay = createSvgElement();
    overlay.setAttribute("aria-label", "Catlas game map editor");
    overlay.setAttribute("role", "application");
    overlay.tabIndex = 0;
    root.append(overlay);
    this.#overlay = d3.select(overlay);
    this.#renderer = new EntitySvgLayer(overlay, {
      onEntityContextMenu: (event, entity) => this.#handleEntityContextMenu(event, entity),
      onEntityPointerDown: (event, entity) => this.#handleEntityPointerDown(event, entity),
      onMidpointPointerDown: (event, wayId, insertionIndex, point) =>
        this.#handleMidpointPointerDown(event, wayId, insertionIndex, point),
    });

    const size = getElementSize(root);
    this.#transform = getInitialTransform(size);
    this.#zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent(getZoomScaleExtent())
      .extent(getViewportExtent(size))
      .filter((event) => {
        if (event.type === "wheel") return true;
        const target = event.target as Element | null;
        return !target?.closest?.("[data-interactive='true']") && event.button === 0;
      })
      .on("zoom", (event) => {
        this.#transform = event.transform;
        this.#tiles.setTransform(this.#transform);
        this.#render();
      })
      .on("end", () => void this.#loadViewport());

    this.#overlay.call(this.#zoom);
    this.#zoom.transform(this.#overlay, this.#transform);
    this.#overlay.on("dblclick.zoom", null);
    this.#overlay.on("click.editor", (event: MouseEvent) => this.#handleCanvasClick(event));
    this.#overlay.on("contextmenu.editor", (event: MouseEvent) =>
      this.#handleCanvasContextMenu(event),
    );
    this.#overlay.on("dblclick.editor", (event: MouseEvent) => {
      event.preventDefault();
      if (this.#mode === "draw-line") this.finishDrawing();
    });
    this.#overlay.on("pointermove.editor", (event: PointerEvent) => this.#handlePointerMove(event));
    this.#overlay.on("pointerleave.editor", () => this.#setCursor(null));
    this.#overlay.on("pointerup.editor pointercancel.editor", (event: PointerEvent) =>
      this.#handlePointerUp(event),
    );
    this.#overlay.on("keydown.editor", (event: KeyboardEvent) => this.#handleKeyDown(event));

    this.#resizeObserver = new ResizeObserver(() => {
      const nextSize = getElementSize(root);
      this.#zoom.extent(getViewportExtent(nextSize));
      this.#tiles.resize();
      this.#tiles.setTransform(this.#transform);
      this.#render();
    });
    this.#resizeObserver.observe(root);
    this.#tiles.setTransform(this.#transform);
    this.#snapshot = this.#createSnapshot();
    this.#render();
    void this.#checkSession();
    void this.#loadAuthConfig();
    void this.#loadViewport();
  }

  readonly getSnapshot = () => this.#snapshot;

  readonly subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  get featureRegistry() {
    return this.#featureRegistry;
  }

  resolveFeature(entity: EditorEntity): FeatureResolution {
    return this.#featureRegistry.resolve({
      kind: entity.type === "node" ? "node" : entity.geometryKind,
      tags: entity.tags,
    });
  }

  getChangesetReview() {
    const base = this.#history.base;
    const current = this.#history.graph;
    const cached = this.#changesetReviewCache;
    if (cached?.base === base && cached.current === current) return cached.review;

    const review = buildChangesetReview(base, current);
    this.#changesetReviewCache = { base, current, review };
    return review;
  }

  async listChangesets(input: { readonly beforeId?: number | undefined; readonly limit: number }) {
    return this.#api.listChangesets(input);
  }

  previewChange(ref: EntityRef | null) {
    if (!ref) {
      if (this.#clearChangePreview()) this.#emit();
      return;
    }

    const entry = this.getChangesetReview().entries.find(
      (candidate) => candidate.ref.type === ref.type && candidate.ref.id === ref.id,
    );
    if (!entry || entry.kind !== "delete" || !this.#history.base.has(ref)) return;

    this.#changePreview = { graph: this.#history.base, ref };
    this.#emit();
  }

  operation(id: OperationId, target: EntityRef | null = null): Operation {
    const operation = getOperation(
      id,
      this.#history.graph,
      this.#selection,
      target,
      this.#nextLocalWayId,
    );
    return {
      id: operation.id,
      label: operation.label,
      available: operation.available,
      disabledReason: operation.disabledReason,
      execute: () => {
        if (!operation.action) return;
        const contextMenuCleared = this.#clearContextMenu();
        this.#changePreview = null;
        if (this.#history.perform(operation.action, operation.annotation)) {
          if (operation.id === "split") this.#nextLocalWayId -= 1;
          this.#selection =
            operation.selection && this.#history.graph.has(operation.selection)
              ? operation.selection
              : null;
          this.#emit();
        } else if (contextMenuCleared) {
          this.#emit();
        }
      },
    };
  }

  setMode(mode: EditorMode) {
    this.#setMode(mode, null);
  }

  setCreationFeature(featureId: string) {
    const feature = this.#featureRegistry.featuresById.get(featureId);
    const create = feature?.editor?.create;
    if (!feature || !create) return;
    const mode =
      create.kind === "node" ? "add-point" : create.kind === "line" ? "draw-line" : "draw-area";
    this.#setMode(mode, feature.id);
  }

  #setMode(mode: EditorMode, activeFeatureId: string | null) {
    const previewCleared = this.#clearChangePreview();
    const contextMenuCleared = this.#clearContextMenu();
    if (mode === this.#mode && activeFeatureId === this.#activeFeatureId) {
      if (previewCleared || contextMenuCleared) this.#emit();
      return;
    }
    this.#mode = mode;
    this.#activeFeatureId = activeFeatureId;
    const geometry = modeGeometry(mode);
    this.#drawing =
      geometry === "line" || geometry === "area"
        ? { geometryKind: geometry, vertices: [], pointer: null }
        : null;
    this.#transientNode = null;
    this.#emit();
  }

  select(entity: EntityRef | null) {
    const previewCleared = this.#clearChangePreview();
    const nextSelection = entity && this.#history.graph.has(entity) ? entity : null;
    if (sameEntityRef(this.#selection, nextSelection)) {
      if (previewCleared) this.#emit();
      return;
    }
    this.#selection = nextSelection;
    this.#emit();
  }

  undo() {
    const previewCleared = this.#clearChangePreview();
    if (!this.#history.undo()) {
      if (previewCleared) this.#emit();
      return;
    }
    this.#repairSelection();
    this.#emit();
  }

  redo() {
    const previewCleared = this.#clearChangePreview();
    if (!this.#history.redo()) {
      if (previewCleared) this.#emit();
      return;
    }
    this.#repairSelection();
    this.#emit();
  }

  deleteSelection() {
    this.operation("delete").execute();
  }

  async login(userId: string) {
    const normalizedUserId = userId.trim();
    if (!normalizedUserId || this.#authState.status === "authenticating") return;

    this.#authState = { status: "authenticating" };
    this.#emit();
    try {
      const session = await this.#api.createSession(normalizedUserId);
      if (!session.user) throw new Error("The API did not create a session.");
      this.#authState = { status: "authenticated", user: session.user };
      this.#saveState = this.#saveState.status === "error" ? { status: "idle" } : this.#saveState;
      this.#emit();
    } catch (error) {
      this.#authState = { status: "error", message: errorMessage(error) };
      this.#emit();
    }
  }

  async logout() {
    this.#authState = { status: "anonymous" };
    this.#emit();

    try {
      await this.#api.deleteSession();
    } catch {
      // The local state is cleared even when the development session store is unavailable.
    }
  }

  updateSelectedY(y: number) {
    if (!Number.isFinite(y)) return;
    this.#updateSelection({ y }, "Change height");
  }

  updateTag(key: string, value: string) {
    if (!this.#selection) return;
    this.updateEntityTag(this.#selection, key, value);
  }

  updateEntityTag(ref: EntityRef, key: string, value: string) {
    if (key.trim() === "") return;
    const entity = this.#history.graph.entity(ref);
    if (!entity) return;
    this.#updateEntity(ref, { tags: { ...entity.tags, [key.trim()]: value } }, `Change ${key} tag`);
  }

  removeTag(key: string) {
    if (!this.#selection) return;
    this.removeEntityTag(this.#selection, key);
  }

  removeEntityTag(ref: EntityRef, key: string) {
    const entity = this.#history.graph.entity(ref);
    if (!entity || !Object.hasOwn(entity.tags, key)) return;
    const tags = { ...entity.tags };
    delete tags[key];
    this.#updateEntity(ref, { tags }, `Remove ${key} tag`);
  }

  applyFeature(ref: EntityRef, featureId: string) {
    const entity = this.#history.graph.entity(ref);
    const feature = this.#featureRegistry.featuresById.get(featureId);
    if (!entity || !feature || this.resolveFeature(entity).primary) return false;
    const tags = featureAssignmentTags(this.#featureRegistry, entity, feature);
    if (!tags) return false;
    return this.#updateEntity(ref, { tags }, `Apply ${feature.id} feature`);
  }

  finishDrawing() {
    const drawing = this.#drawing;
    if (!drawing) return;
    const minimum = drawing.geometryKind === "area" ? 3 : 2;
    if (drawing.vertices.length < minimum) return;

    const createdNodes = drawing.vertices.flatMap((vertex) => {
      if (vertex.nodeId !== null) return [];
      const id = this.#nextLocalNodeId--;
      return [
        {
          type: "node" as const,
          id,
          version: 0,
          tags: {},
          geom: vertex.point,
          draftPoint: vertex.point,
        },
      ];
    });
    let createdNodeIndex = 0;
    const nodeIds = drawing.vertices.map((vertex) => {
      if (vertex.nodeId !== null) return vertex.nodeId;
      return createdNodes[createdNodeIndex++]!.id;
    });
    if (drawing.geometryKind === "area") nodeIds.push(nodeIds[0]!);

    const wayId = this.#nextLocalWayId--;
    const way = {
      type: "way" as const,
      id: wayId,
      version: 0,
      tags: { ...this.#activeCreationFeature(drawing.geometryKind)?.editor?.create?.tags },
      geometryKind: drawing.geometryKind,
      nodeIds,
    };
    const nodes = createdNodes.map(({ draftPoint: _draftPoint, ...node }) => node);

    if (
      this.#history.perform(
        addEntities([...nodes, way]),
        `Add ${drawing.geometryKind === "line" ? "Line" : "Area"}`,
      )
    ) {
      this.#clearContextMenu();
      this.#selection = { type: "way", id: wayId };
      this.#mode = "browse";
      this.#activeFeatureId = null;
      this.#drawing = null;
      this.#emit();
    }
  }

  cancelDrawing() {
    if (!this.#drawing) return;
    this.#clearContextMenu();
    this.#mode = "browse";
    this.#activeFeatureId = null;
    this.#drawing = null;
    this.#emit();
  }

  async save(comment: string | null) {
    if (!this.#history.isDirty() || this.#saveState.status === "saving") return;
    if (this.#authState.status !== "authenticated") {
      this.#saveState = {
        status: "error",
        message: "Sign in before publishing changes.",
      };
      this.#emit();
      return;
    }
    const issues = this.#validationIssues();
    if (issues.some((issue) => issue.severity === "error")) {
      this.#saveState = {
        status: "error",
        message: "Resolve validation errors before saving.",
      };
      this.#emit();
      return;
    }

    this.#changePreview = null;
    this.#saveState = { status: "saving" };
    const review = this.getChangesetReview();
    this.#emit();
    try {
      const session = await this.#api.getSession();
      if (!session.user) {
        this.#authState = {
          status: "error",
          message: "Your session expired. Sign in again to publish these changes.",
        };
        throw new Error("Authentication required");
      }
      const saved = await saveGraph(this.#api, this.#history.graph, review.payload, comment);
      if (this.#selection) {
        const remap = saved.remaps.get(entityKey(this.#selection));
        if (remap) this.#selection = { ...this.#selection, id: remap.id };
      }
      this.#history.reset(saved.graph);
      this.#saveState = { status: "saved", message: "Changes published." };
      this.#emit();
      await this.#loadViewport();
    } catch (error) {
      if (error instanceof Error && error.cause instanceof Response && error.cause.status === 401) {
        this.#authState = {
          status: "error",
          message: "Your session expired. Sign in again to publish these changes.",
        };
      }
      this.#saveState = {
        status: "error",
        message: errorMessage(error),
      };
      this.#emit();
    }
  }

  reload() {
    void this.#loadViewport();
  }

  dispose() {
    this.#disposed = true;
    this.#requestId += 1;
    if (this.#cursorFrame !== null) cancelAnimationFrame(this.#cursorFrame);
    this.#canvasClickSuppression.clear();
    this.#resizeObserver.disconnect();
    this.#overlay.on(".zoom", null).on(".editor", null);
    this.#renderer.destroy();
    this.#overlay.remove();
    this.#tiles.destroy();
    this.#listeners.clear();
  }

  #clearChangePreview() {
    if (!this.#changePreview) return false;
    this.#changePreview = null;
    return true;
  }

  #clearContextMenu() {
    if (!this.#contextMenu) return false;
    this.#contextMenu = null;
    return true;
  }

  closeContextMenu() {
    if (this.#clearContextMenu()) this.#emit();
  }

  #updateSelection(properties: Parameters<typeof updateEntityProperties>[1], annotation: string) {
    if (!this.#selection) return;
    this.#updateEntity(this.#selection, properties, annotation);
  }

  #updateEntity(
    ref: EntityRef,
    properties: Parameters<typeof updateEntityProperties>[1],
    annotation: string,
  ) {
    if (this.#history.perform(updateEntityProperties(ref, properties), annotation)) {
      this.#emit();
      return true;
    }
    return false;
  }

  #handleCanvasClick(event: MouseEvent) {
    if (this.#canvasClickSuppression.consume()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const contextMenuCleared = this.#clearContextMenu();
    const point = this.#pointFromEvent(event);
    if (this.#mode === "add-point") {
      this.#createPoint(point);
      if (contextMenuCleared) this.#emit();
      return;
    }
    if (this.#mode === "draw-line" || this.#mode === "draw-area") {
      this.#appendDraftVertex({ nodeId: null, point: this.#snapForMode(point) });
      if (contextMenuCleared) this.#emit();
      return;
    }
    this.select(null);
    if (contextMenuCleared) this.#emit();
  }

  #handleCanvasContextMenu(event: MouseEvent) {
    if ((event as EntityContextMenuEvent)[ENTITY_CONTEXT_MENU_EVENT]) return;
    this.#openContextMenu(event, null);
  }

  #handleEntityContextMenu(event: MouseEvent, ref: EntityRef) {
    (event as EntityContextMenuEvent)[ENTITY_CONTEXT_MENU_EVENT] = true;
    if (!this.#history.graph.has(ref)) return;
    this.#openContextMenu(event, ref);
  }

  #openContextMenu(event: MouseEvent, target: EntityRef | null) {
    const [x, y] = d3.pointer(event, this.#overlay.node());
    this.#contextMenu = {
      target,
      targetEntity: target ? (this.#history.graph.entity(target) ?? null) : null,
      world: this.#pointFromEvent(event),
      x,
      y,
    };
    this.#emit();
  }

  #handleEntityPointerDown(event: PointerEvent, ref: EntityRef) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.#canvasClickSuppression.arm();
    const contextMenuCleared = this.#clearContextMenu();
    const entity = this.#history.graph.entity(ref);
    if (!entity) {
      if (contextMenuCleared) this.#emit();
      return;
    }

    if ((this.#mode === "draw-line" || this.#mode === "draw-area") && entity.type === "node") {
      this.#appendDraftVertex({ nodeId: entity.id, point: entity.geom });
      if (contextMenuCleared) this.#emit();
      return;
    }

    if (this.#mode === "add-point") {
      this.#mode = "browse";
      this.#activeFeatureId = null;
      this.select(ref);
      if (contextMenuCleared) this.#emit();
      return;
    }

    if (this.#mode !== "browse") {
      if (contextMenuCleared) this.#emit();
      return;
    }
    this.select(ref);
    if (entity.type !== "node") {
      if (contextMenuCleared) this.#emit();
      return;
    }

    const captureTarget = event.currentTarget as Element;
    this.#activeDrag = {
      captureTarget,
      nodeId: entity.id,
      pointerId: event.pointerId,
      start: entity.geom,
      current: entity.geom,
    };
    captureTarget.setPointerCapture(event.pointerId);
    if (contextMenuCleared) this.#emit();
  }

  #handleMidpointPointerDown(
    event: PointerEvent,
    wayId: number,
    insertionIndex: number,
    point: Point3D,
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.#canvasClickSuppression.arm();
    const contextMenuCleared = this.#clearContextMenu();
    if (this.#mode !== "browse") {
      if (contextMenuCleared) this.#emit();
      return;
    }
    const way = this.#history.graph.way(wayId);
    if (!way) {
      if (contextMenuCleared) this.#emit();
      return;
    }
    const feature = this.resolveFeature(way).primary;
    const snapped = snapPoint(
      point,
      feature?.editor?.snapPolicy ?? (way.geometryKind === "area" ? "integer" : "half"),
    );
    const nodeId = this.#nextLocalNodeId--;
    const node = {
      type: "node" as const,
      id: nodeId,
      version: 0,
      tags: {},
      geom: snapped,
    };
    if (this.#history.perform(insertNodeIntoWay(wayId, insertionIndex, node), "Insert vertex")) {
      this.#selection = { type: "node", id: nodeId };
      this.#emit();
    } else if (contextMenuCleared) {
      this.#emit();
    }
  }

  #handlePointerMove(event: PointerEvent) {
    const cursor = this.#pointFromEvent(event);
    this.#setCursor(cursor);

    if (this.#activeDrag?.pointerId === event.pointerId) {
      const graph = this.#history.graph;
      const node = graph.node(this.#activeDrag.nodeId);
      if (!node) return;
      const point = { ...cursor, y: node.geom.y };
      const policy = this.#snapPolicyForNode(node.id);
      const snapped = snapPoint(point, policy);
      this.#activeDrag.current = snapped;
      this.#transientNode = { id: node.id, geom: snapped };
      this.#render();
      return;
    }

    if (this.#drawing) {
      this.#drawing = { ...this.#drawing, pointer: this.#snapForMode(cursor) };
      this.#render();
    }
  }

  #setCursor(cursor: Point3D | null) {
    this.#cursor = cursor;
    if (this.#cursorFrame !== null) return;
    this.#cursorFrame = requestAnimationFrame(() => {
      this.#cursorFrame = null;
      if (this.#disposed) return;
      this.#snapshot = this.#createSnapshot();
      for (const listener of this.#listeners) listener();
    });
  }

  #handlePointerUp(event: PointerEvent) {
    this.#canvasClickSuppression.releaseAfterPointerEnd();
    const drag = this.#activeDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    this.#activeDrag = null;
    this.#transientNode = null;
    if (drag.captureTarget.hasPointerCapture(event.pointerId)) {
      drag.captureTarget.releasePointerCapture(event.pointerId);
    }

    if (
      drag.start.x !== drag.current.x ||
      drag.start.y !== drag.current.y ||
      drag.start.z !== drag.current.z
    ) {
      this.#history.perform(moveNode(drag.nodeId, drag.current), "Move vertex");
    }
    this.#emit();
  }

  #handleKeyDown(event: KeyboardEvent) {
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) {
        this.redo();
      } else {
        this.undo();
      }
      return;
    }
    if (modifier && event.key.toLowerCase() === "y") {
      event.preventDefault();
      this.redo();
      return;
    }
    if (event.key === "Escape") {
      if (this.#clearContextMenu()) {
        event.preventDefault();
        this.#emit();
        return;
      }
      this.cancelDrawing();
      this.setMode("browse");
      return;
    }
    if (event.key === "Enter") {
      this.finishDrawing();
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      this.deleteSelection();
      return;
    }
    if (event.key === "1") this.setMode("add-point");
    if (event.key === "2") this.setMode("draw-line");
    if (event.key === "3") this.setMode("draw-area");
  }

  #appendDraftVertex(vertex: DrawingState["vertices"][number]) {
    if (!this.#drawing) return;
    const previous = this.#drawing.vertices.at(-1);
    if (
      previous &&
      ((previous.nodeId !== null && previous.nodeId === vertex.nodeId) ||
        (previous.nodeId === null &&
          vertex.nodeId === null &&
          previous.point.x === vertex.point.x &&
          previous.point.z === vertex.point.z))
    ) {
      if (this.#drawing.geometryKind === "line") this.finishDrawing();
      return;
    }

    if (
      this.#drawing.geometryKind === "area" &&
      this.#drawing.vertices.length >= 3 &&
      vertex.nodeId !== null &&
      vertex.nodeId === this.#drawing.vertices[0]?.nodeId
    ) {
      this.finishDrawing();
      return;
    }

    this.#drawing = {
      ...this.#drawing,
      vertices: [...this.#drawing.vertices, vertex],
      pointer: vertex.point,
    };
    this.#emit();
  }

  #createPoint(point: Point3D) {
    const feature = this.#activeCreationFeature("node");
    const id = this.#nextLocalNodeId--;
    const node = {
      type: "node" as const,
      id,
      version: 0,
      tags: { ...feature?.editor?.create?.tags },
      geom: snapPoint(point, feature?.editor?.snapPolicy ?? "half"),
    };
    if (this.#history.perform(addEntities([node]), "Add Point")) {
      this.#clearContextMenu();
      this.#selection = { type: "node", id };
      this.#mode = "browse";
      this.#activeFeatureId = null;
      this.#emit();
    }
  }

  #snapForMode(point: Point3D) {
    const geometry = modeGeometry(this.#mode);
    if (!geometry) return point;
    const feature = this.#activeCreationFeature(geometry === "point" ? "node" : geometry);
    return snapPoint(
      point,
      feature?.editor?.snapPolicy ?? (geometry === "area" ? "integer" : "half"),
    );
  }

  #snapPolicyForNode(nodeId: number): SnapPolicy {
    const parentWays = this.#history.graph.parentWays(nodeId);
    const parentPolicies = parentWays.map(
      (way) =>
        this.resolveFeature(way).primary?.editor?.snapPolicy ??
        (way.geometryKind === "area" ? "integer" : "half"),
    );
    if (parentPolicies.includes("integer")) return "integer";
    if (parentPolicies.includes("half")) return "half";
    if (parentPolicies.includes("free")) return "free";
    const node = this.#history.graph.node(nodeId);
    if (!node) return "half";
    return this.resolveFeature(node).primary?.editor?.snapPolicy ?? "half";
  }

  #activeCreationFeature(kind: "node" | "line" | "area"): ResolvedFeature | null {
    if (!this.#activeFeatureId) return null;
    const feature = this.#featureRegistry.featuresById.get(this.#activeFeatureId);
    return feature?.editor?.create?.kind === kind ? feature : null;
  }

  #pointFromEvent(event: MouseEvent | PointerEvent, y = 0) {
    const point = d3.pointer(event, this.#overlay.node());
    return screenToWorld(this.#transform, [point[0], point[1]], y);
  }

  #repairSelection() {
    if (this.#selection && !this.#history.graph.has(this.#selection)) this.#selection = null;
  }

  async #loadViewport() {
    if (this.#disposed) return;
    const requestId = ++this.#requestId;
    this.#loading = true;
    this.#loadError = null;
    this.#emit();
    const bbox = getViewportBbox(this.#transform, getElementSize(this.#root));

    try {
      const viewport = await loadViewportEntities(this.#api, bbox);
      if (this.#disposed || requestId !== this.#requestId) return;
      this.#history.rebase(viewport.entities);
      this.#changePreview = null;
      this.#loading = false;
      this.#repairSelection();
      this.#emit();
    } catch (error) {
      if (this.#disposed || requestId !== this.#requestId) return;
      this.#loading = false;
      this.#loadError = errorMessage(error);
      this.#emit();
    }
  }

  #createSnapshot(): EditorSnapshot {
    const selectedEntity = this.#selection
      ? (this.#history.graph.entity(this.#selection) ?? null)
      : null;
    return {
      mode: this.#mode,
      activeFeatureId: this.#activeFeatureId,
      cursor: this.#cursor,
      selection: this.#selection,
      selectedEntity,
      changePreview: this.#changePreview?.ref ?? null,
      canUndo: this.#history.canUndo,
      canRedo: this.#history.canRedo,
      dirty: this.#history.isDirty(),
      loading: this.#loading,
      loadError: this.#loadError,
      drawing: this.#drawing,
      contextMenu: this.#contextMenu,
      issues: this.#validationIssues(),
      save: this.#saveState,
      auth: this.#authState,
      authConfig: this.#authConfig,
    };
  }

  #validationIssues() {
    return [
      ...validateGraph(this.#history.graph),
      ...validateFeatureFields(this.#history.graph, this.#featureRegistry),
    ];
  }

  async #loadAuthConfig() {
    try {
      this.#authConfig = await this.#api.getAuthConfig();
      if (!this.#disposed) this.#emit();
    } catch {
      // Keep sign-in controls hidden when the API cannot provide its configuration.
    }
  }

  async #checkSession() {
    try {
      const session = await this.#api.getSession();
      this.#authState = session.user
        ? { status: "authenticated", user: session.user }
        : { status: "anonymous" };
      if (!this.#disposed) this.#emit();
    } catch (error) {
      if (this.#disposed) return;
      this.#authState = { status: "error", message: errorMessage(error) };
      this.#emit();
    }
  }

  #render() {
    this.#renderer.render({
      graph: this.#history.graph,
      selection: this.#selection,
      preview: this.#changePreview,
      drawing: this.#drawing,
      transientNode: this.#transientNode,
      transform: this.#transform,
    });
  }

  #emit() {
    if (this.#history.isDirty() && this.#saveState.status === "saved") {
      this.#saveState = { status: "idle" };
    }
    this.#snapshot = this.#createSnapshot();
    this.#render();
    for (const listener of this.#listeners) listener();
  }
}

export type { Operation, OperationId } from "./editor/operations";
export type { ChangesetReview } from "./editor/changeset";
export type {
  EditorAuthConfig,
  EditorAuthState,
  EditorContextMenu,
  EditorMode,
  EditorSnapshot,
  EntityRef,
} from "./editor/types";
