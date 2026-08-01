import {
  ArrowLeftIcon,
  HistoryIcon,
  MapPinIcon,
  ListChecksIcon,
  MonitorIcon,
  MoonIcon,
  MousePointer2Icon,
  PentagonIcon,
  Redo2Icon,
  RouteIcon,
  SunIcon,
  Trash2Icon,
  Undo2Icon,
  type LucideIcon,
} from "lucide-react";
import { AuthControl } from "@/components/editor/auth-control";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CatlasEditor, EditorMode } from "@/lib/editor";
import { EditorSavePanel } from "./editor-save-panel";
import { type ThemeMode, useTheme } from "./editor-theme";
import { useEditorSnapshot } from "./use-editor-snapshot";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { listWorlds, type World } from "@/lib/world-api";

const MODE_BUTTONS: readonly {
  mode: EditorMode;
  label: string;
  shortcut: string;
  icon: LucideIcon;
}[] = [
  { mode: "browse", label: "Browse", shortcut: "Esc", icon: MousePointer2Icon },
  { mode: "add-point", label: "Point", shortcut: "1", icon: MapPinIcon },
  { mode: "draw-line", label: "Line", shortcut: "2", icon: RouteIcon },
  { mode: "draw-area", label: "Area", shortcut: "3", icon: PentagonIcon },
];

const THEME_OPTIONS: readonly {
  value: ThemeMode;
  label: string;
  icon: LucideIcon;
}[] = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
];

export function EditorTopBar({
  editor,
  world,
  onNavigateWorld,
  onNavigateHome,
}: {
  readonly editor: CatlasEditor | null;
  readonly world: World;
  readonly onNavigateWorld: (slug: string) => void;
  readonly onNavigateHome: () => void;
}) {
  return (
    <header
      className="topbar flex items-center gap-1.5 bg-background border-b border-border px-2 relative z-20 min-w-0"
      aria-label="Editor controls"
    >
      <div className="topbar__brand flex items-center gap-2 flex-[0_0_auto] min-w-0">
        <span
          className="topbar__mark inline-flex items-center justify-center bg-foreground text-background rounded-sm font-extrabold text-xs h-6.5 w-6.5"
          aria-hidden="true"
        >
          C
        </span>
        <span className="topbar__title hidden text-[13px] font-[650] whitespace-nowrap min-[560px]:inline">
          Catlas Editor
        </span>
      </div>
      <Separator className="topbar__separator h-5 mx-0.5" orientation="vertical" />
      <WorldSelector
        editor={editor}
        onNavigateHome={onNavigateHome}
        onNavigateWorld={onNavigateWorld}
        world={world}
      />
      {editor ? <TopBarContent editor={editor} /> : <TopBarLoading />}
    </header>
  );
}

function WorldSelector({
  editor,
  world,
  onNavigateWorld,
  onNavigateHome,
}: {
  readonly editor: CatlasEditor | null;
  readonly world: World;
  readonly onNavigateWorld: (slug: string) => void;
  readonly onNavigateHome: () => void;
}) {
  const worlds = useQuery({ queryKey: ["worlds"], queryFn: listWorlds });
  const [editorState, setEditorState] = useState(() => editor?.getSnapshot());
  useEffect(() => {
    if (!editor) return;
    const update = () => setEditorState(editor.getSnapshot());
    update();
    return editor.subscribe(update);
  }, [editor]);
  const saving = editorState?.save.status === "saving";
  const worldsBySlug = new Map((worlds.data ?? []).map((item) => [item.slug, item]));
  worldsBySlug.set(world.slug, world);
  const change = (slug: string) => {
    if (slug === world.slug || saving) return;
    onNavigateWorld(slug);
  };
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Select value={world.slug} onValueChange={change} disabled={saving}>
        <SelectTrigger className="min-w-0 max-w-40 sm:max-w-56" aria-label="Select world">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Worlds</SelectLabel>
            {[...worldsBySlug.values()].map((item) => (
              <SelectItem key={item.slug} value={item.slug}>
                {item.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Button
        aria-label="Back to worlds"
        disabled={saving}
        onClick={onNavigateHome}
        size="icon-sm"
        title="Back to worlds"
        type="button"
        variant="ghost"
      >
        <ArrowLeftIcon />
      </Button>
    </div>
  );
}

function TopBarLoading() {
  return (
    <div className="topbar__loading flex items-center gap-1.5 text-xs text-muted-foreground">
      <Spinner />
      <span>Starting editor</span>
    </div>
  );
}

function TopBarContent({ editor }: { readonly editor: CatlasEditor }) {
  const snapshot = useEditorSnapshot(editor);
  const review = editor.getChangesetReview();

  return (
    <>
      <ButtonGroup aria-label="History controls">
        <Button
          aria-label="Undo"
          disabled={!snapshot.canUndo}
          onClick={() => editor.undo()}
          size="icon-sm"
          title="Undo"
          type="button"
          variant="ghost"
        >
          <Undo2Icon data-icon="inline-start" />
        </Button>
        <Button
          aria-label="Redo"
          disabled={!snapshot.canRedo}
          onClick={() => editor.redo()}
          size="icon-sm"
          title="Redo"
          type="button"
          variant="ghost"
        >
          <Redo2Icon data-icon="inline-start" />
        </Button>
      </ButtonGroup>

      <Button
        aria-label={`Review ${review.counts.total} pending changes`}
        disabled={review.counts.total === 0}
        onClick={() => editor.select(null)}
        size="sm"
        type="button"
        variant={snapshot.selection ? "ghost" : "secondary"}
      >
        <ListChecksIcon data-icon="inline-start" />
        <span className="topbar__changes-label hidden min-[860px]:inline">Changes</span>
        <Badge variant="outline">{review.counts.total}</Badge>
      </Button>

      <div className="topbar__spacer flex-1" />
      <Badge
        className="topbar__status whitespace-nowrap"
        variant={snapshot.dirty ? "secondary" : "outline"}
      >
        {snapshot.loading ? (
          <Spinner />
        ) : (
          <span className="status-dot bg-editor-success rounded-full h-1.5 w-1.5" />
        )}
        {snapshot.loading ? "Loading viewport" : snapshot.dirty ? "Unsaved changes" : "Up to date"}
      </Badge>
      <ThemeMenu />
      <AuthControl editor={editor} snapshot={snapshot} />
      <EditorSavePanel editor={editor} />
    </>
  );
}

function ThemeMenu() {
  const { theme, setTheme } = useTheme();
  const ActiveThemeIcon =
    THEME_OPTIONS.find((option) => option.value === theme)?.icon ?? MonitorIcon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="Choose theme"
          size="icon-sm"
          title="Theme"
          type="button"
          variant="ghost"
        >
          <ActiveThemeIcon data-icon="inline-start" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          onValueChange={(value) => setTheme(value as ThemeMode)}
          value={theme}
        >
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function EditorToolRail({
  editor,
  changesetsOpen,
  onToggleChangesets,
}: {
  readonly editor: CatlasEditor | null;
  readonly changesetsOpen: boolean;
  readonly onToggleChangesets: () => void;
}) {
  if (!editor)
    return (
      <nav
        className="tool-rail flex flex-col items-center gap-2 bg-background border-r border-border py-2 px-1.75 relative z-12 min-h-0"
        aria-label="Editing tools"
      />
    );
  return (
    <ToolRailContent
      changesetsOpen={changesetsOpen}
      editor={editor}
      onToggleChangesets={onToggleChangesets}
    />
  );
}

function ToolRailContent({
  changesetsOpen,
  editor,
  onToggleChangesets,
}: {
  readonly changesetsOpen: boolean;
  readonly editor: CatlasEditor;
  readonly onToggleChangesets: () => void;
}) {
  const snapshot = useEditorSnapshot(editor);
  const deleteOperation = editor.operation("delete");

  return (
    <nav
      className="tool-rail flex flex-col items-center gap-2 bg-background border-r border-border py-2 px-1.75 relative z-12 min-h-0"
      aria-label="Editing tools"
    >
      <ToggleGroup
        aria-label="Editor mode"
        className="tool-rail__modes flex-col"
        onValueChange={(mode) => {
          if (mode) editor.setMode(mode as EditorMode);
        }}
        orientation="vertical"
        spacing={2}
        type="single"
        value={snapshot.mode}
      >
        {MODE_BUTTONS.map(({ mode, label, shortcut, icon: Icon }) => (
          <Tooltip key={mode}>
            <TooltipTrigger asChild>
              <span className="tool-rail__tooltip-trigger inline-flex">
                <ToggleGroupItem aria-label={`${label} mode`} value={mode}>
                  <Icon />
                </ToggleGroupItem>
              </span>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              <span>{label}</span>
              <kbd
                className="rounded-[3px] font-mono text-[10px] leading-none opacity-70"
                data-slot="kbd"
              >
                {shortcut}
              </kbd>
            </TooltipContent>
          </Tooltip>
        ))}
      </ToggleGroup>

      <Separator />

      <Tooltip>
        <TooltipTrigger asChild>
          <span className="tool-rail__tooltip-trigger inline-flex">
            <Button
              aria-label="Delete selected feature"
              disabled={!deleteOperation.available}
              onClick={deleteOperation.execute}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Trash2Icon data-icon="inline-start" />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          <span>{deleteOperation.disabledReason ?? "Delete"}</span>
          <kbd
            className="rounded-[3px] font-mono text-[10px] leading-none opacity-70"
            data-slot="kbd"
          >
            ⌫
          </kbd>
        </TooltipContent>
      </Tooltip>

      <div className="flex-1" />

      <Tooltip>
        <TooltipTrigger asChild>
          <span className="tool-rail__tooltip-trigger inline-flex">
            <Button
              aria-label="Toggle published changesets"
              aria-pressed={changesetsOpen}
              onClick={onToggleChangesets}
              size="icon"
              title="Published changesets"
              type="button"
              variant={changesetsOpen ? "secondary" : "ghost"}
            >
              <HistoryIcon data-icon="inline-start" />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          Published changesets
        </TooltipContent>
      </Tooltip>
    </nav>
  );
}
