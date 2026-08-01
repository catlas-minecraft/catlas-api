import { useInfiniteQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  HistoryIcon,
  PanelLeftCloseIcon,
  PanelLeftIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CatlasEditor } from "@/lib/editor";
import type { components } from "@/lib/editor/catlas-api.gen";
import { changesetsQueryKey } from "@/lib/query-keys";

const PAGE_SIZE = 50;

export type ChangesetPanelMode = "dock" | "overlay";

const formatPublishedAt = (publishedAt: string | null) => {
  if (publishedAt === null) return "Published date unavailable";

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(Date.parse(publishedAt));
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Could not load changesets.";

export function EditorChangesetSidebar({
  editor,
  mode,
  onClose,
  onModeChange,
}: {
  readonly editor: CatlasEditor;
  readonly mode: ChangesetPanelMode;
  readonly onClose: () => void;
  readonly onModeChange: (mode: ChangesetPanelMode) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const query = useInfiniteQuery({
    queryKey: changesetsQueryKey(editor.worldSlug),
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) =>
      editor.listChangesets({
        beforeId: pageParam ?? undefined,
        limit: PAGE_SIZE,
      }),
    getNextPageParam: (page) => page.nextBeforeId ?? undefined,
  });
  const changesets = useMemo(
    () => query.data?.pages.flatMap((page) => page.changesets) ?? [],
    [query.data],
  );
  const rowCount = changesets.length + (query.hasNextPage ? 1 : 0);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 84,
    overscan: 6,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query;

  useEffect(() => {
    const lastItem = virtualItems.at(-1);
    if (!lastItem || lastItem.index < changesets.length - 1 || !hasNextPage || isFetchingNextPage) {
      return;
    }

    void fetchNextPage();
  }, [changesets.length, fetchNextPage, hasNextPage, isFetchingNextPage, virtualItems]);

  const targetMode = mode === "overlay" ? "dock" : "overlay";
  const targetModeLabel = targetMode === "dock" ? "Dock sidebar" : "Overlay sidebar";

  return (
    <aside
      aria-label="Published changesets"
      className="changeset-sidebar flex h-full min-h-0 min-w-0 flex-col bg-background"
    >
      <header className="flex min-h-16 flex-none items-start justify-between gap-2 border-b border-border p-3 [&>div]:min-w-0">
        <div>
          <span className="text-muted-foreground text-[9px] font-[750] tracking-[0.12em] uppercase">
            History
          </span>
          <h2 className="mt-0.5 truncate text-sm font-[650] leading-tight">Changesets</h2>
          <p className="mt-0.75 text-[11px] text-muted-foreground">Published map changes</p>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={targetModeLabel}
                onClick={() => onModeChange(targetMode)}
                size="icon-xs"
                title={targetModeLabel}
                type="button"
                variant="ghost"
              >
                {targetMode === "dock" ? (
                  <PanelLeftIcon data-icon="inline-start" />
                ) : (
                  <PanelLeftCloseIcon data-icon="inline-start" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={8}>
              {targetModeLabel}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label="Close changesets"
                onClick={onClose}
                size="icon-xs"
                title="Close changesets"
                type="button"
                variant="ghost"
              >
                <XIcon data-icon="inline-start" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={8}>
              Close changesets
            </TooltipContent>
          </Tooltip>
        </div>
      </header>

      {query.isPending ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : query.isError ? (
        <div className="p-3">
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>Could not load changesets</AlertTitle>
            <AlertDescription>{errorMessage(query.error)}</AlertDescription>
            <AlertAction>
              <Button
                onClick={() => void query.refetch()}
                size="xs"
                type="button"
                variant="outline"
              >
                <RefreshCwIcon data-icon="inline-start" />
                Retry
              </Button>
            </AlertAction>
          </Alert>
        </div>
      ) : changesets.length === 0 ? (
        <Empty className="min-h-60 border-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CircleCheckIcon />
            </EmptyMedia>
            <EmptyTitle>No published changesets</EmptyTitle>
            <EmptyDescription>Published map changes will appear here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3" ref={scrollRef}>
          <ItemGroup className="relative gap-0" style={{ height: virtualizer.getTotalSize() }}>
            {virtualItems.map((virtualItem) => {
              const isLoader = virtualItem.index >= changesets.length;
              const changeset = changesets[virtualItem.index];

              return (
                <div
                  data-index={virtualItem.index}
                  key={virtualItem.key}
                  ref={virtualizer.measureElement}
                  style={{
                    left: 0,
                    position: "absolute",
                    top: 0,
                    transform: `translateY(${virtualItem.start}px)`,
                    width: "100%",
                  }}
                >
                  {isLoader ? (
                    <div className="flex items-center justify-center gap-2 p-3 text-xs text-muted-foreground">
                      <Spinner />
                      <span>Loading more changesets</span>
                    </div>
                  ) : changeset ? (
                    <ChangesetListItem changeset={changeset} />
                  ) : null}
                </div>
              );
            })}
          </ItemGroup>
        </div>
      )}
    </aside>
  );
}

function ChangesetListItem({
  changeset,
}: {
  readonly changeset: components["schemas"]["Changeset"];
}) {
  const label = changeset.comment?.trim() || "No comment";
  const publishedAt = formatPublishedAt(changeset.publishedAt);

  return (
    <Item className="mb-2" size="sm" variant="outline">
      <ItemMedia variant="icon">
        <HistoryIcon />
      </ItemMedia>
      <ItemContent>
        <ItemTitle title={label}>{label}</ItemTitle>
        <ItemDescription>
          #{changeset.id} · {changeset.createdBy.username} · {publishedAt}
        </ItemDescription>
      </ItemContent>
      <Badge variant="outline">Published</Badge>
    </Item>
  );
}
