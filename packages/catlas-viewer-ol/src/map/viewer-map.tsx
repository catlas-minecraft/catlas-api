import { Map as SolidMap, MapItem, useMap } from "@catlas/solid-ol";
import type { BBox, Viewport } from "@catlas/api-client";
import type { ViewerLocale, ViewerMessages } from "../i18n.ts";
import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  type Accessor,
  type JSX,
} from "solid-js";
import Feature from "ol/Feature.js";
import OlMap from "ol/Map.js";
import View from "ol/View.js";
import { unByKey } from "ol/Observable.js";
import type BaseLayer from "ol/layer/Base.js";
import VectorLayer from "ol/layer/Vector.js";
import VectorSource from "ol/source/Vector.js";
import LineString from "ol/geom/LineString.js";
import Point from "ol/geom/Point.js";
import Polygon from "ol/geom/Polygon.js";
import type Geometry from "ol/geom/Geometry.js";
import { Button } from "../components/ui/button.tsx";
import { featureFromLabel, featureFromNode, featureFromPath } from "./styles.ts";
import {
  catlasZoomForResolution,
  catlasProjection,
  CATLAS_INITIAL_RESOLUTION,
  CATLAS_MIN_ZOOM,
  mapExtentToWorldBbox,
  mapToWorldCoordinate,
  resolutionForCatlasZoom,
  type MapCoordinate,
} from "./projection.ts";
import { createCatlasTileLayer } from "./tiles.ts";
import { projectViewport, type ProjectedViewport } from "./viewport.ts";

export type ViewerMapProps = {
  readonly worldSlug: Accessor<string>;
  readonly locale: Accessor<ViewerLocale>;
  readonly messages: Accessor<ViewerMessages>;
  readonly viewport: Accessor<Viewport | undefined>;
  readonly viewportLoading: Accessor<boolean>;
  readonly onViewportRequest: (bbox: BBox) => void;
};

type ViewState = {
  readonly bbox: BBox;
  readonly zoom: number;
  readonly center: MapCoordinate;
};

const initialView = () =>
  new View({
    center: [0, 0],
    constrainOnlyCenter: true,
    enableRotation: false,
    maxResolution: resolutionForCatlasZoom(CATLAS_MIN_ZOOM),
    minResolution: resolutionForCatlasZoom(8),
    projection: catlasProjection,
    resolution: CATLAS_INITIAL_RESOLUTION,
  });

const attachLayer = (map: OlMap, layer: BaseLayer) => {
  map.addLayer(layer);
  return () => map.removeLayer(layer);
};

const formatCoordinate = (coordinate: { readonly x: number; readonly z: number }) =>
  `${Math.round(coordinate.x)}, ${Math.round(coordinate.z)}`;

const MapControls = (props: {
  readonly messages: Accessor<ViewerMessages>;
  readonly viewState: Accessor<ViewState>;
  readonly projected: Accessor<ProjectedViewport>;
  readonly onViewChange: () => void;
}) => {
  const map = useMap();
  const changeZoom = (delta: number) => {
    const view = map.getView();
    const currentZoom = view.getZoom() ?? catlasZoomForResolution(view.getResolution() ?? 1);
    view.setZoom(currentZoom + delta);
    props.onViewChange();
  };
  const resetView = () => {
    const view = map.getView();
    view.setCenter([0, 0]);
    view.setResolution(CATLAS_INITIAL_RESOLUTION);
    props.onViewChange();
  };

  return (
    <>
      <div class="map-controls" aria-label={props.messages().mapControls}>
        <Button
          aria-label={props.messages().zoomIn}
          class="map-control"
          onClick={() => changeZoom(1)}
          size="lg"
          type="button"
          variant="subtle"
        >
          <span aria-hidden="true">+</span>
        </Button>
        <Button
          aria-label={props.messages().zoomOut}
          class="map-control"
          onClick={() => changeZoom(-1)}
          size="lg"
          type="button"
          variant="subtle"
        >
          <span aria-hidden="true">−</span>
        </Button>
        <Button
          aria-label={props.messages().resetView}
          class="map-control map-control-reset"
          onClick={resetView}
          size="lg"
          type="button"
          variant="subtle"
        >
          <span aria-hidden="true">⌂</span>
        </Button>
      </div>
      <output class="map-coordinate" aria-label={props.messages().coordinates}>
        <span class="map-coordinate-label">{props.messages().coordinates}</span>
        <span class="map-coordinate-value">
          {formatCoordinate(mapToWorldCoordinate(props.viewState().center))}
        </span>
      </output>
      <section class="catlas-map-summary" aria-label={props.messages().visibleFeatures}>
        <ul>
          <For each={props.projected().polygons.concat(props.projected().polylines)}>
            {(path) => <li>{path.accessibleName}</li>}
          </For>
          <For each={props.projected().markers}>{(node) => <li>{node.accessibleName}</li>}</For>
        </ul>
      </section>
    </>
  );
};

const ViewportLayers = (props: {
  readonly worldSlug: Accessor<string>;
  readonly locale: Accessor<ViewerLocale>;
  readonly viewport: Accessor<Viewport | undefined>;
  readonly onViewportRequest: (bbox: BBox) => void;
  readonly onProjected: (projected: ProjectedViewport) => void;
  readonly onViewState: (state: ViewState) => void;
  readonly registerViewChange: (handler: () => void) => void;
  readonly view: View;
}) => {
  const map = useMap();
  const geometrySource = new VectorSource<Feature<Geometry>>();
  const annotationSource = new VectorSource<Feature<Geometry>>();
  const tileLayer = createCatlasTileLayer();
  const geometryLayer = new VectorLayer({
    renderBuffer: 256,
    source: geometrySource,
    updateWhileInteracting: false,
    zIndex: 10,
  });
  const annotationLayer = new VectorLayer({
    renderBuffer: 256,
    source: annotationSource,
    updateWhileInteracting: false,
    zIndex: 20,
  });

  let currentWorldSlug: string | undefined;
  let mounted = false;
  const emitView = () => {
    const size = (map.getSize() ?? [0, 0]) as [number, number];
    const extent = props.view.calculateExtent(size);
    const resolution = props.view.getResolution() ?? CATLAS_INITIAL_RESOLUTION;
    const state: ViewState = {
      bbox: mapExtentToWorldBbox(extent),
      center: (props.view.getCenter() ?? [0, 0]) as MapCoordinate,
      zoom: catlasZoomForResolution(resolution),
    };
    props.onViewState(state);
    props.onViewportRequest(state.bbox);
    const snapshot = props.viewport();
    const currentSize = (map.getSize() ?? [0, 0]) as [number, number];
    const nextProjected = snapshot
      ? projectViewport(snapshot, state.bbox, state.zoom, props.locale(), undefined, {
          coordinateToPixel: (coordinate) => {
            const pixel = map.getPixelFromCoordinate(coordinate);
            return pixel ? [pixel[0]!, pixel[1]!] : null;
          },
          mapSize: currentSize,
        })
      : { labels: [], markers: [], polygons: [], polylines: [] };
    props.onProjected(nextProjected);
  };

  const resetForWorld = () => {
    props.view.setCenter([0, 0]);
    props.view.setResolution(CATLAS_INITIAL_RESOLUTION);
    if (mounted) emitView();
  };

  createEffect(() => {
    const nextWorldSlug = props.worldSlug();
    if (nextWorldSlug === currentWorldSlug) return;
    currentWorldSlug = nextWorldSlug;
    resetForWorld();
  });

  createEffect(() => {
    const snapshot = props.viewport();
    const currentSize = (map.getSize() ?? [0, 0]) as [number, number];
    const center = (props.view.getCenter() ?? [0, 0]) as MapCoordinate;
    const extent = props.view.calculateExtent(currentSize);
    const state: ViewState = {
      bbox: mapExtentToWorldBbox(extent),
      center,
      zoom: catlasZoomForResolution(props.view.getResolution() ?? CATLAS_INITIAL_RESOLUTION),
    };
    const nextProjected = snapshot
      ? projectViewport(snapshot, state.bbox, state.zoom, props.locale(), undefined, {
          coordinateToPixel: (coordinate) => {
            const pixel = map.getPixelFromCoordinate(coordinate);
            return pixel ? [pixel[0]!, pixel[1]!] : null;
          },
          mapSize: currentSize,
        })
      : { labels: [], markers: [], polygons: [], polylines: [] };
    geometrySource.clear(true);
    annotationSource.clear(true);
    const geometryFeatures: Feature<Geometry>[] = [];
    const annotationFeatures: Feature<Geometry>[] = [];
    for (const path of nextProjected.polygons) {
      geometryFeatures.push(
        featureFromPath(
          new Polygon([path.coordinates.map(([x, y]) => [x, y] as MapCoordinate)]),
          path,
        ),
      );
      const iconId = path.feature?.viewer?.icon;
      if (path.featureVisible && iconId) {
        const iconFeature = new Feature<Geometry>({ geometry: new Point(path.coordinate) });
        iconFeature.setStyle(
          // The style is created through the same node path so icons stay consistent.
          featureFromNode(new Point(path.coordinate), {
            id: path.id,
            coordinate: path.coordinate,
            feature: path.feature,
            accessibleName: path.accessibleName,
          }).getStyle() ?? undefined,
        );
        annotationFeatures.push(iconFeature);
      }
    }
    for (const path of nextProjected.polylines) {
      geometryFeatures.push(
        featureFromPath(
          new LineString(path.coordinates.map(([x, y]) => [x, y] as MapCoordinate)),
          path,
        ),
      );
      const iconId = path.feature?.viewer?.icon;
      if (path.featureVisible && iconId) {
        const iconFeature = new Feature<Geometry>({ geometry: new Point(path.coordinate) });
        iconFeature.setStyle(
          featureFromNode(new Point(path.coordinate), {
            id: path.id,
            coordinate: path.coordinate,
            feature: path.feature,
            accessibleName: path.accessibleName,
          }).getStyle() ?? undefined,
        );
        annotationFeatures.push(iconFeature);
      }
    }
    for (const node of nextProjected.markers) {
      geometryFeatures.push(featureFromNode(new Point(node.coordinate), node));
    }
    for (const label of nextProjected.labels) {
      annotationFeatures.push(featureFromLabel(new Point(label.coordinate), label));
    }
    geometrySource.addFeatures(geometryFeatures);
    annotationSource.addFeatures(annotationFeatures);
    props.onProjected(nextProjected);
  });

  onMount(() => {
    mounted = true;
    map.updateSize();
    props.registerViewChange(emitView);
    const moveEndKey = map.on("moveend", emitView);
    const sizeKey = map.on("change:size", () => {
      map.updateSize();
      emitView();
    });
    const target = map.getTargetElement();
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(() => {
            map.updateSize();
            emitView();
          });
    resizeObserver?.observe(target);
    window.addEventListener("resize", emitView, { passive: true });
    emitView();
    onCleanup(() => {
      unByKey(moveEndKey);
      unByKey(sizeKey);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", emitView);
      props.registerViewChange(() => undefined);
    });
  });

  return (
    <>
      <MapItem value={tileLayer} attach={attachLayer} />
      <MapItem value={geometryLayer} attach={attachLayer} />
      <MapItem value={annotationLayer} attach={attachLayer} />
    </>
  );
};

export const ViewerMap = (props: ViewerMapProps): JSX.Element => {
  const view = initialView();
  const [viewState, setViewState] = createSignal<ViewState>({
    bbox: [0, 0, 0, 0],
    center: [0, 0],
    zoom: 0,
  });
  const [projected, setProjected] = createSignal<ProjectedViewport>({
    labels: [],
    markers: [],
    polygons: [],
    polylines: [],
  });
  let triggerViewChange: () => void = () => undefined;

  return (
    <div class="map-frame">
      <SolidMap
        aria-busy={props.viewportLoading()}
        aria-label={props.messages().mapLabel}
        class="catlas-map"
        options={{
          controls: [],
          interactions: undefined,
          view,
        }}
        role="application"
        tabIndex={0}
      >
        <ViewportLayers
          locale={props.locale}
          onProjected={setProjected}
          registerViewChange={(handler) => {
            triggerViewChange = handler;
          }}
          onViewState={setViewState}
          onViewportRequest={props.onViewportRequest}
          view={view}
          viewport={props.viewport}
          worldSlug={props.worldSlug}
        />
        <MapControls
          messages={props.messages}
          onViewChange={() => triggerViewChange()}
          projected={projected}
          viewState={viewState}
        />
      </SolidMap>
    </div>
  );
};
