import { useEffect, useRef, useState } from "react";
import { useBlocker } from "@tanstack/react-router";
import type { Layout } from "react-resizable-panels";
import "./App.css";
import {
  EditorChangesetSidebar,
  type ChangesetPanelMode,
} from "./components/editor/editor-changeset-sidebar";
import { EditorInspector } from "./components/editor/editor-inspector";
import { EditorMapOverlays } from "./components/editor/editor-map-overlays";
import { EditorToolRail, EditorTopBar } from "./components/editor/editor-toolbar";
import { ContextMenu, ContextMenuTrigger } from "./components/ui/context-menu";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./components/ui/resizable";
import { CatlasEditor } from "./lib/editor";
import type { World } from "./lib/world-api";

const INSPECTOR_LAYOUT_STORAGE_KEY = "catlas-editor:inspector-layout";
const CHANGESET_PANEL_STORAGE_KEY = "catlas-editor:changeset-panel";
const CANVAS_PANEL_ID = "canvas";
const CHANGESET_PANEL_ID = "changesets";
const INSPECTOR_PANEL_ID = "inspector";
const CHANGESET_PANEL_MIN_SIZE = 280;
const CHANGESET_PANEL_MAX_SIZE = 520;
const CHANGESET_PANEL_DEFAULT_SIZE = 360;
const DOCK_MIN_VIEWPORT_WIDTH = 960;

type ChangesetPanelPreferences = {
  readonly mode: ChangesetPanelMode;
  readonly open: boolean;
  readonly width: number;
};

const defaultChangesetPanelPreferences: ChangesetPanelPreferences = {
  mode: "overlay",
  open: false,
  width: CHANGESET_PANEL_DEFAULT_SIZE,
};

const clampChangesetPanelWidth = (width: number) =>
  Math.min(CHANGESET_PANEL_MAX_SIZE, Math.max(CHANGESET_PANEL_MIN_SIZE, Math.round(width)));

const readChangesetPanelPreferences = (): ChangesetPanelPreferences => {
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(CHANGESET_PANEL_STORAGE_KEY) ?? "null",
    );
    if (!value || typeof value !== "object") return defaultChangesetPanelPreferences;

    const { mode, open, width } = value as Partial<ChangesetPanelPreferences>;
    if ((mode !== "dock" && mode !== "overlay") || typeof open !== "boolean") {
      return defaultChangesetPanelPreferences;
    }

    return {
      mode,
      open,
      width:
        typeof width === "number" && Number.isFinite(width)
          ? clampChangesetPanelWidth(width)
          : CHANGESET_PANEL_DEFAULT_SIZE,
    };
  } catch {
    return defaultChangesetPanelPreferences;
  }
};

const storeChangesetPanelPreferences = (preferences: ChangesetPanelPreferences) => {
  try {
    window.localStorage.setItem(CHANGESET_PANEL_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // The panel remains usable when storage is unavailable.
  }
};

const readStoredLayout = (): Layout | undefined => {
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(INSPECTOR_LAYOUT_STORAGE_KEY) ?? "null",
    );
    if (
      !value ||
      typeof value !== "object" ||
      !(CANVAS_PANEL_ID in value) ||
      !(INSPECTOR_PANEL_ID in value)
    ) {
      return undefined;
    }

    const layout = value as Layout;
    return Number.isFinite(layout[CANVAS_PANEL_ID]) && Number.isFinite(layout[INSPECTOR_PANEL_ID])
      ? layout
      : undefined;
  } catch {
    return undefined;
  }
};

const storeLayout = (layout: Layout) => {
  try {
    window.localStorage.setItem(INSPECTOR_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Resizing should still work when storage is unavailable.
  }
};

export function EditorWorkspace({
  worldSlug,
  world,
  onNavigateWorld,
  onNavigateHome,
}: {
  readonly worldSlug: string;
  readonly world: World;
  readonly onNavigateWorld: (slug: string) => void;
  readonly onNavigateHome: () => void;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<CatlasEditor | null>(null);
  const [defaultLayout] = useState(readStoredLayout);
  const [changesetPanel, setChangesetPanel] = useState(readChangesetPanelPreferences);
  const [canDockChangesets, setCanDockChangesets] = useState(
    () => window.innerWidth >= DOCK_MIN_VIEWPORT_WIDTH,
  );

  useEffect(() => {
    if (!mapRef.current) return;
    const nextEditor = new CatlasEditor(mapRef.current, { worldSlug });
    setEditor(nextEditor);
    return () => {
      setEditor(null);
      nextEditor.dispose();
    };
  }, [worldSlug]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!editor || (!editor.getSnapshot().dirty && editor.getSnapshot().save.status !== "saving"))
        return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [editor]);

  const blocker = useBlocker({
    withResolver: true,
    enableBeforeUnload: false,
    shouldBlockFn: () => {
      const snapshot = editor?.getSnapshot();
      return Boolean(snapshot?.dirty || snapshot?.save.status === "saving");
    },
  });

  useEffect(() => {
    if (blocker.status !== "blocked") return;
    const snapshot = editor?.getSnapshot();
    if (snapshot?.save.status === "saving") {
      blocker.reset();
      return;
    }
    if (window.confirm("Discard unsaved changes and leave this world?")) {
      blocker.proceed();
    } else {
      blocker.reset();
    }
  }, [blocker, editor]);

  useEffect(() => {
    const updateCanDock = () => setCanDockChangesets(window.innerWidth >= DOCK_MIN_VIEWPORT_WIDTH);
    window.addEventListener("resize", updateCanDock);
    return () => window.removeEventListener("resize", updateCanDock);
  }, []);

  useEffect(() => {
    storeChangesetPanelPreferences(changesetPanel);
  }, [changesetPanel]);

  const changesetPanelMode: ChangesetPanelMode =
    changesetPanel.mode === "dock" && canDockChangesets ? "dock" : "overlay";
  const updateChangesetPanelWidth = (width: number) => {
    setChangesetPanel((current) => ({ ...current, width: clampChangesetPanelWidth(width) }));
  };
  const closeChangesetPanel = () => setChangesetPanel((current) => ({ ...current, open: false }));
  const setChangesetPanelMode = (mode: ChangesetPanelMode) =>
    setChangesetPanel((current) => ({ ...current, mode }));
  const toggleChangesetPanel = () =>
    setChangesetPanel((current) => ({ ...current, open: !current.open }));

  return (
    <div className="editor-shell grid grid-rows-[44px_minmax(0,1fr)] h-dvh w-screen overflow-hidden bg-background text-foreground">
      <EditorTopBar
        editor={editor}
        onNavigateHome={onNavigateHome}
        onNavigateWorld={onNavigateWorld}
        world={world}
      />
      <div className="editor-body grid grid-cols-[48px_minmax(0,1fr)] min-h-0 min-w-0">
        <EditorToolRail
          changesetsOpen={changesetPanel.open}
          editor={editor}
          onToggleChangesets={toggleChangesetPanel}
        />
        <ResizablePanelGroup
          defaultLayout={
            changesetPanel.open && changesetPanelMode === "dock" ? undefined : defaultLayout
          }
          id="catlas-editor-workspace"
          onLayoutChanged={storeLayout}
          orientation="horizontal"
        >
          {changesetPanel.open && changesetPanelMode === "dock" ? (
            <>
              <ResizablePanel
                defaultSize={changesetPanel.width}
                groupResizeBehavior="preserve-pixel-size"
                id={CHANGESET_PANEL_ID}
                maxSize={CHANGESET_PANEL_MAX_SIZE}
                minSize={CHANGESET_PANEL_MIN_SIZE}
                onResize={(size) => updateChangesetPanelWidth(size.inPixels)}
              >
                {editor ? (
                  <EditorChangesetSidebar
                    editor={editor}
                    mode={changesetPanelMode}
                    onClose={closeChangesetPanel}
                    onModeChange={setChangesetPanelMode}
                  />
                ) : null}
              </ResizablePanel>
              <ResizableHandle className="bg-border transition-colors duration-150 ease hover:bg-editor-selection focus-visible:bg-editor-selection" />
            </>
          ) : null}
          <ResizablePanel id={CANVAS_PANEL_ID} minSize={360}>
            <main className="workspace relative h-full min-h-0 min-w-0 overflow-hidden">
              <ContextMenu
                modal={false}
                onOpenChange={(open) => {
                  if (!open) editor?.closeContextMenu();
                }}
              >
                <div className="map-frame relative h-full min-h-0 min-w-0 overflow-hidden">
                  <ContextMenuTrigger asChild disabled={!editor}>
                    <div
                      className="map-pane absolute inset-0 overflow-hidden bg-editor-canvas"
                      ref={mapRef}
                    />
                  </ContextMenuTrigger>
                  <EditorMapOverlays editor={editor} />
                </div>
              </ContextMenu>
              {changesetPanel.open && changesetPanelMode === "overlay" && editor ? (
                <ChangesetOverlay
                  editor={editor}
                  mode={changesetPanelMode}
                  onClose={closeChangesetPanel}
                  onModeChange={setChangesetPanelMode}
                  onResize={updateChangesetPanelWidth}
                  width={changesetPanel.width}
                />
              ) : null}
            </main>
          </ResizablePanel>
          <ResizableHandle className="inspector-resize-handle bg-border transition-colors duration-150 ease z-[11] hover:bg-editor-selection focus-visible:bg-editor-selection" />
          <ResizablePanel
            defaultSize={300}
            groupResizeBehavior="preserve-pixel-size"
            id={INSPECTOR_PANEL_ID}
            maxSize={420}
            minSize={240}
          >
            <EditorInspector editor={editor} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}

function ChangesetOverlay({
  editor,
  mode,
  onClose,
  onModeChange,
  onResize,
  width,
}: {
  readonly editor: CatlasEditor;
  readonly mode: ChangesetPanelMode;
  readonly onClose: () => void;
  readonly onModeChange: (mode: ChangesetPanelMode) => void;
  readonly onResize: (width: number) => void;
  readonly width: number;
}) {
  return (
    <ResizablePanelGroup
      className="pointer-events-none absolute inset-0 z-[12]"
      orientation="horizontal"
    >
      <ResizablePanel
        className="pointer-events-auto shadow-lg"
        defaultSize={width}
        groupResizeBehavior="preserve-pixel-size"
        id={CHANGESET_PANEL_ID}
        maxSize={CHANGESET_PANEL_MAX_SIZE}
        minSize={CHANGESET_PANEL_MIN_SIZE}
        onResize={(size) => onResize(size.inPixels)}
      >
        <EditorChangesetSidebar
          editor={editor}
          mode={mode}
          onClose={onClose}
          onModeChange={onModeChange}
        />
      </ResizablePanel>
      <ResizableHandle className="pointer-events-auto bg-border hover:bg-editor-selection focus-visible:bg-editor-selection" />
      <ResizablePanel className="pointer-events-none" id="changeset-overlay-spacer" />
    </ResizablePanelGroup>
  );
}
