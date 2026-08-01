import {
  ArrowRightIcon,
  BracesIcon,
  CircleCheckIcon,
  CirclePlusIcon,
  PencilIcon,
  Trash2Icon,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemHeader,
  ItemTitle,
} from "@/components/ui/item";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CatlasEditor, ChangesetReview, EditorSnapshot } from "@/lib/editor";
import type { ChangesetReviewEntry, ChangesetReviewValue } from "@/lib/editor/changeset";
import { entityKey } from "@/lib/editor/types";

const KIND_DETAILS: Record<
  ChangesetReviewEntry["kind"],
  { readonly label: string; readonly heading: string; readonly icon: LucideIcon }
> = {
  create: { label: "Created", heading: "Created", icon: CirclePlusIcon },
  modify: { label: "Modified", heading: "Modified", icon: PencilIcon },
  delete: { label: "Deleted", heading: "Deleted", icon: Trash2Icon },
};

const KINDS: readonly ChangesetReviewEntry["kind"][] = ["create", "modify", "delete"];

const formatValue = (value: ChangesetReviewValue) => {
  if (value === null) return "Not set";
  if (Array.isArray(value)) return `[${value.join(", ")}]`;
  if (value === "") return '""';
  return String(value);
};

export function EditorChangesReview({
  editor,
  snapshot,
}: {
  readonly editor: CatlasEditor;
  readonly snapshot: EditorSnapshot;
}) {
  const review = editor.getChangesetReview();
  const previewedKey = snapshot.changePreview ? entityKey(snapshot.changePreview) : null;
  const blockingIssues = snapshot.issues.filter((issue) => issue.severity === "error").length;

  const clearPreview = () => {
    editor.previewChange(null);
  };

  const selectEntry = (entry: ChangesetReviewEntry) => {
    if (entry.kind === "delete") {
      const nextKey = previewedKey === entry.key ? null : entry.key;
      editor.previewChange(nextKey ? entry.ref : null);
      return;
    }

    clearPreview();
    editor.select(entry.ref);
  };

  return (
    <aside className="inspector changes-review flex flex-col h-full min-h-0 min-w-0 bg-background overflow-hidden">
      <header className="changes-review__header flex items-start justify-between gap-2 flex-[0_0_auto] min-h-18.5 p-3 border-b border-border [&>div]:min-w-0">
        <div>
          <span className="eyebrow text-muted-foreground text-[9px] font-[750] tracking-[0.12em] uppercase">
            Changeset
          </span>
          <h2 className="text-sm font-[650] leading-tight mt-0.5">Changes</h2>
          <p className="text-muted-foreground text-[11px] mt-0.75">
            {review.counts.total === 1
              ? "1 pending change"
              : `${review.counts.total} pending changes`}
          </p>
        </div>
        {blockingIssues ? (
          <Badge variant="destructive">{blockingIssues} blocking</Badge>
        ) : snapshot.issues.length ? (
          <Badge variant="outline">{snapshot.issues.length} warnings</Badge>
        ) : null}
      </header>

      <Tabs
        className="changes-review__tabs flex-1 gap-0 min-h-0 overflow-hidden"
        defaultValue="review"
        onValueChange={(value) => {
          if (value !== "review") clearPreview();
        }}
      >
        <TabsList
          className="changes-review__tab-list flex-[0_0_auto] mx-3 w-[calc(100%-24px)]"
          variant="line"
        >
          <TabsTrigger value="review">Review</TabsTrigger>
          <TabsTrigger value="payload">
            <BracesIcon data-icon="inline-start" />
            Payload
          </TabsTrigger>
        </TabsList>

        <TabsContent
          className="changes-review__content m-0 min-h-0 overflow-auto overscroll-contain"
          value="review"
        >
          <ReviewSummary review={review} />
          {review.counts.total === 0 ? (
            <Empty className="changes-review__empty min-h-60 border-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CircleCheckIcon />
                </EmptyMedia>
                <EmptyTitle>No pending changes</EmptyTitle>
                <EmptyDescription>Your map is up to date.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="changes-review__groups flex flex-col gap-4.5 p-3">
              {KINDS.map((kind) => (
                <ChangeGroup
                  entries={review.entries.filter((entry) => entry.kind === kind)}
                  key={kind}
                  kind={kind}
                  onSelect={selectEntry}
                  previewedKey={previewedKey}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent
          className="changes-review__content m-0 min-h-0 overflow-auto overscroll-contain"
          value="payload"
        >
          <div className="changes-review__payload-header flex items-center justify-between text-[11px] font-[650] p-[10px_12px] border-b border-border">
            <span>Upload payload</span>
            <Badge variant="outline">JSON</Badge>
          </div>
          <pre className="changes-review__payload bg-muted font-mono text-[10px] leading-[1.55] m-3 min-h-[calc(100%-58px)] overflow-auto p-2.5 [tab-size:2]">
            <code>{JSON.stringify(review.payload, null, 2)}</code>
          </pre>
        </TabsContent>
      </Tabs>
    </aside>
  );
}

function ReviewSummary({ review }: { readonly review: ChangesetReview }) {
  return (
    <div
      className="changes-review__summary flex flex-wrap gap-1.5 p-[10px_12px] border-b border-border"
      aria-label="Change counts"
    >
      <Badge variant="secondary">{review.counts.created} created</Badge>
      <Badge variant="secondary">{review.counts.modified} modified</Badge>
      <Badge variant={review.counts.deleted ? "destructive" : "secondary"}>
        {review.counts.deleted} deleted
      </Badge>
    </div>
  );
}

function ChangeGroup({
  entries,
  kind,
  onSelect,
  previewedKey,
}: {
  readonly entries: readonly ChangesetReviewEntry[];
  readonly kind: ChangesetReviewEntry["kind"];
  readonly onSelect: (entry: ChangesetReviewEntry) => void;
  readonly previewedKey: string | null;
}) {
  if (entries.length === 0) return null;
  const details = KIND_DETAILS[kind];

  return (
    <section className="change-group flex flex-col gap-2">
      <header className="change-group__header flex items-center justify-between">
        <h3 className="text-[11px] font-[650] m-0">{details.heading}</h3>
        <Badge variant="outline">{entries.length}</Badge>
      </header>
      <ItemGroup>
        {entries.map((entry) => (
          <ChangeItem
            active={previewedKey === entry.key}
            entry={entry}
            key={`${entry.kind}-${entry.key}`}
            onSelect={onSelect}
          />
        ))}
      </ItemGroup>
    </section>
  );
}

const newLocal =
  "bg-muted rounded-sm text-[10px] leading-[1.4] max-w-full [overflow-wrap:anywhere] px-1 py-0.5";
function ChangeItem({
  active,
  entry,
  onSelect,
}: {
  readonly active: boolean;
  readonly entry: ChangesetReviewEntry;
  readonly onSelect: (entry: ChangesetReviewEntry) => void;
}) {
  const details = KIND_DETAILS[entry.kind];
  const Icon = details.icon;

  return (
    <Item asChild size="xs" variant={active ? "muted" : "outline"}>
      <button
        aria-pressed={entry.kind === "delete" ? active : undefined}
        className="change-item bg-transparent text-inherit cursor-pointer font-inherit text-left aria-pressed:border-destructive"
        onClick={() => onSelect(entry)}
        type="button"
      >
        <ItemHeader>
          <ItemContent>
            <ItemTitle>
              <Icon />
              {entry.label ||
                (entry.geometry === "point"
                  ? "Point"
                  : entry.geometry === "line"
                    ? "Line"
                    : "Area")}
            </ItemTitle>
            <ItemDescription>
              {entry.geometry} · {entry.key}
              {entry.expectedVersion === null ? "" : ` · v${entry.expectedVersion}`}
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <Badge variant={entry.kind === "delete" ? "destructive" : "outline"}>
              {details.label}
            </Badge>
          </ItemActions>
        </ItemHeader>

        <div className="change-item__fields flex flex-col gap-1.25 min-w-0 basis-full">
          {entry.fields.map((field) => (
            <div
              className="change-field items-start grid gap-1.5 grid-cols-[minmax(58px,78px)_minmax(0,1fr)]"
              key={field.key}
            >
              <span className="text-muted-foreground text-[10px] leading-[1.6] wrap-anywhere">
                {field.label}
              </span>
              <div className="change-field__values flex flex-wrap gap-1 items-center min-w-0">
                {entry.kind !== "create" ? (
                  <code className={newLocal}>{formatValue(field.before)}</code>
                ) : null}
                {entry.kind === "modify" ? (
                  <ArrowRightIcon className="text-muted-foreground h-3 w-3" aria-hidden="true" />
                ) : null}
                {entry.kind !== "delete" ? (
                  <code className="bg-muted rounded-sm text-[10px] leading-[1.4] max-w-full wrap-anywhere px-1 py-0.5">
                    {formatValue(field.after)}
                  </code>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </button>
    </Item>
  );
}
