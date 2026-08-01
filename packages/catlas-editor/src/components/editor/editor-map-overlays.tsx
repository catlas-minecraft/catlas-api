import {
  AlertCircleIcon,
  CheckCircle2Icon,
  GitMergeIcon,
  PencilLineIcon,
  RotateCwIcon,
  ScissorsIcon,
  Trash2Icon,
  type LucideIcon,
} from "lucide-react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CatlasEditor, EditorSnapshot, Operation } from "@/lib/editor";
import { entityKey } from "@/lib/editor/types";
import { useEditorSnapshot } from "./use-editor-snapshot";

export function EditorMapOverlays({ editor }: { readonly editor: CatlasEditor | null }) {
  if (!editor) {
    return (
      <div className="editor-loading absolute inset-0 flex flex-col items-center justify-center gap-3">
        <span className="loading-mark inline-flex items-center justify-center bg-foreground text-background rounded-sm font-extrabold h-10 w-10">
          C
        </span>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          Starting editor
        </div>
      </div>
    );
  }
  return <MapOverlayContent editor={editor} />;
}

function MapOverlayContent({ editor }: { readonly editor: CatlasEditor }) {
  const snapshot = useEditorSnapshot(editor);
  return (
    <>
      <DraftControls editor={editor} snapshot={snapshot} />
      <StatusOverlay editor={editor} snapshot={snapshot} />
      <EditorContextMenu editor={editor} snapshot={snapshot} />
      <div className="coordinate-hint absolute bottom-2.5 right-2.5 z-8 px-1.5 py-1 rounded-sm bg-foreground/82 text-background font-mono text-[10px]">
        {snapshot.cursor
          ? `X ${formatCoordinate(snapshot.cursor.x)}  Z ${formatCoordinate(snapshot.cursor.z)}`
          : "X --  Z --"}
      </div>
    </>
  );
}

const formatCoordinate = (value: number) =>
  Number.isInteger(value) ? String(value) : value.toFixed(2);

function EditorContextMenu({
  editor,
  snapshot,
}: {
  editor: CatlasEditor;
  snapshot: EditorSnapshot;
}) {
  const contextMenu = snapshot.contextMenu;
  if (!contextMenu) return null;

  const targetEntity = contextMenu.targetEntity;
  const deleteOperation = contextMenu.target
    ? editor.operation("delete", contextMenu.target)
    : null;
  const joinOperation =
    targetEntity?.type === "way" ? editor.operation("join", contextMenu.target) : null;
  const splitOperation =
    targetEntity?.type === "node" ? editor.operation("split", contextMenu.target) : null;

  return (
    <ContextMenuContent aria-label="Editor context menu" className="editor-context-menu min-w-44">
      {targetEntity ? (
        <ContextMenuLabel className="editor-context-menu__target flex min-w-0 flex-col gap-0.5 text-popover-foreground">
          <span className="editor-context-menu__title text-xs font-[650] leading-tight">
            {formatEntityKind(targetEntity)}
          </span>
          <span className="editor-context-menu__meta flex min-w-0 items-center gap-1.5 text-muted-foreground text-[10px] leading-snug">
            <code className="font-mono">{entityKey(targetEntity)}</code>
            <span className="truncate">
              {targetEntity.tags.name ||
                (targetEntity.type === "node"
                  ? "Point"
                  : targetEntity.geometryKind === "line"
                    ? "Line"
                    : "Area")}
            </span>
          </span>
        </ContextMenuLabel>
      ) : (
        <ContextMenuLabel className="editor-context-menu__title text-xs font-[650] leading-tight text-popover-foreground">
          Nothing here
        </ContextMenuLabel>
      )}

      {joinOperation || splitOperation || deleteOperation ? (
        <>
          <ContextMenuSeparator />
          <ContextMenuGroup>
            {joinOperation ? (
              <EditorOperationContextMenuItem icon={GitMergeIcon} operation={joinOperation} />
            ) : null}
            {splitOperation ? (
              <EditorOperationContextMenuItem icon={ScissorsIcon} operation={splitOperation} />
            ) : null}
            {deleteOperation ? (
              <ContextMenuItem
                className="editor-context-menu__item"
                disabled={!deleteOperation.available}
                onSelect={() => deleteOperation.execute()}
                title={deleteOperation.disabledReason ?? deleteOperation.label}
                variant="destructive"
              >
                <Trash2Icon />
                {deleteOperation.label}
              </ContextMenuItem>
            ) : null}
          </ContextMenuGroup>
        </>
      ) : null}
      <ContextMenuSeparator />
      <ContextMenuLabel className="editor-context-menu__coords whitespace-nowrap font-mono text-[10px] leading-snug">
        X {formatCoordinate(contextMenu.world.x)}&nbsp;&nbsp; Z{" "}
        {formatCoordinate(contextMenu.world.z)}
      </ContextMenuLabel>
    </ContextMenuContent>
  );
}

function EditorOperationContextMenuItem({
  icon: Icon,
  operation,
}: {
  readonly icon: LucideIcon;
  readonly operation: Operation;
}) {
  const item = (
    <ContextMenuItem
      className="editor-context-menu__item"
      disabled={!operation.available}
      onSelect={() => operation.execute()}
      title={operation.disabledReason ?? operation.label}
    >
      <Icon />
      {operation.label}
    </ContextMenuItem>
  );

  if (operation.available || !operation.disabledReason) return item;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="block">{item}</span>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {operation.disabledReason}
      </TooltipContent>
    </Tooltip>
  );
}

const formatEntityKind = (entity: NonNullable<EditorSnapshot["contextMenu"]>["targetEntity"]) => {
  if (!entity) return "Feature";
  if (entity.type === "node") return "Node";
  return entity.geometryKind === "line" ? "Line" : "Area";
};

function DraftControls({ editor, snapshot }: { editor: CatlasEditor; snapshot: EditorSnapshot }) {
  if (!snapshot.drawing) return null;
  const minimum = snapshot.drawing.geometryKind === "area" ? 3 : 2;
  const canFinish = snapshot.drawing.vertices.length >= minimum;

  return (
    <Alert className="draft-controls absolute top-3 left-1/2 z-15 max-w-[min(480px,calc(100%-28px))] w-max -translate-x-1/2 pr-36 bg-popover/96 border border-border shadow-[0_10px_30px_color-mix(in_oklab,var(--foreground)_14%,transparent)]">
      <PencilLineIcon />
      <AlertTitle>Drawing {snapshot.drawing.geometryKind}</AlertTitle>
      <AlertDescription>{snapshot.drawing.vertices.length} vertices</AlertDescription>
      <AlertAction>
        <ButtonGroup>
          <Button
            disabled={!canFinish}
            onClick={() => editor.finishDrawing()}
            size="sm"
            type="button"
          >
            Finish
          </Button>
          <Button onClick={() => editor.cancelDrawing()} size="sm" type="button" variant="outline">
            Cancel
          </Button>
        </ButtonGroup>
      </AlertAction>
    </Alert>
  );
}

function StatusOverlay({ editor, snapshot }: { editor: CatlasEditor; snapshot: EditorSnapshot }) {
  const message = snapshot.loadError
    ? snapshot.loadError
    : snapshot.save.status === "error" || snapshot.save.status === "saved"
      ? snapshot.save.message
      : null;
  const issue = snapshot.issues[0];

  if (!message && !issue) return null;
  const isError =
    Boolean(snapshot.loadError) || snapshot.save.status === "error" || issue?.severity === "error";

  return (
    <Alert
      className="notice absolute bottom-3.5 left-3.5 z-15 max-w-[min(420px,calc(100%-28px))] bg-popover/96 border border-border shadow-[0_10px_30px_color-mix(in_oklab,var(--foreground)_14%,transparent)]"
      variant={isError ? "destructive" : "default"}
    >
      {isError ? <AlertCircleIcon /> : <CheckCircle2Icon />}
      <AlertTitle>
        {message ? (isError ? "Request needs attention" : "Saved") : issue?.severity}
      </AlertTitle>
      <AlertDescription>{message ?? issue?.message}</AlertDescription>
      {snapshot.loadError ? (
        <AlertAction>
          <Button onClick={() => editor.reload()} size="sm" type="button" variant="outline">
            <RotateCwIcon data-icon="inline-start" />
            Retry
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  );
}
