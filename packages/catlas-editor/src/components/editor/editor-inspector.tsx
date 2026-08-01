import { PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import type { CatlasEditor, EditorSnapshot } from "@/lib/editor";
import { entityKey, geometryTypeForEntity } from "@/lib/editor/types";
import { EditorChangesReview } from "./editor-changes-review";
import { useEditorSnapshot } from "./use-editor-snapshot";

export function EditorInspector({ editor }: { readonly editor: CatlasEditor | null }) {
  if (!editor)
    return <aside className="inspector flex flex-col h-full min-h-0 min-w-0 bg-background" />;
  return <InspectorContent editor={editor} />;
}

function InspectorContent({ editor }: { readonly editor: CatlasEditor }) {
  const snapshot = useEditorSnapshot(editor);
  const key = snapshot.selection ? entityKey(snapshot.selection) : "empty";
  return <Inspector editor={editor} key={key} snapshot={snapshot} />;
}

function Inspector({ editor, snapshot }: { editor: CatlasEditor; snapshot: EditorSnapshot }) {
  const entity = snapshot.selectedEntity;
  const [newTagKey, setNewTagKey] = useState("");
  const [newTagValue, setNewTagValue] = useState("");

  const geometry = entity ? geometryTypeForEntity(entity) : null;

  if (!entity) {
    return <EditorChangesReview editor={editor} snapshot={snapshot} />;
  }

  const addTag = () => {
    const key = newTagKey.trim();
    if (!key) return;
    editor.updateTag(key, newTagValue);
    setNewTagKey("");
    setNewTagValue("");
  };

  return (
    <aside className="inspector flex flex-col h-full min-h-0 min-w-0 bg-background">
      <header className="inspector__header flex items-start justify-between gap-2 flex-[0_0_auto] min-h-16 border-b border-border p-3 [&>div]:min-w-0">
        <div>
          <span className="eyebrow text-muted-foreground text-[9px] font-[750] tracking-[0.12em] uppercase">
            {geometry}
          </span>
          <h2 className="text-sm font-[650] leading-tight mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap">
            {entity.tags.name ||
              (geometry === "point" ? "Point" : geometry === "line" ? "Line" : "Area")}
          </h2>
        </div>
        <Badge variant="outline">
          <code>
            {entity.type[0]}
            {entity.id}
          </code>
        </Badge>
      </header>

      <div className="inspector__body min-h-0 overflow-y-auto overscroll-contain">
        <InspectorSection title="Geometry">
          <FieldGroup className="property-list gap-2">
            {entity.type === "node" ? (
              <Field
                className="property-row items-center grid gap-2 grid-cols-[minmax(64px,80px)_minmax(0,1fr)]"
                orientation="horizontal"
              >
                <FieldLabel
                  className="text-muted-foreground text-[11px] min-w-0"
                  htmlFor="node-height"
                >
                  Height
                </FieldLabel>
                <Input
                  className="h-7 min-w-0 w-full"
                  defaultValue={entity.geom.y}
                  id="node-height"
                  key={`node-${entity.id}-y-${entity.geom.y}`}
                  onBlur={(event) => editor.updateSelectedY(Number(event.target.value))}
                  step="0.5"
                  type="number"
                />
              </Field>
            ) : null}
          </FieldGroup>
        </InspectorSection>

        <Separator />
        <InspectorSection title="All tags">
          <div className="tag-list grid gap-1.5">
            {Object.entries(entity.tags).map(([key, value]) => (
              <div
                className="tag-row items-center grid gap-1.25 grid-cols-[minmax(54px,72px)_minmax(0,1fr)_24px]"
                key={key}
              >
                <code
                  className="text-muted-foreground text-[10px] overflow-hidden text-ellipsis whitespace-nowrap"
                  title={key}
                >
                  {key}
                </code>
                <Input
                  className="h-7 min-w-0 w-full"
                  aria-label={`${key} value`}
                  defaultValue={value}
                  key={`${entityKey(entity)}-${key}-${value}`}
                  onBlur={(event) => editor.updateTag(key, event.target.value)}
                />
                <Button
                  aria-label={`Remove ${key}`}
                  onClick={() => editor.removeTag(key)}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  <XIcon />
                </Button>
              </div>
            ))}
            {Object.keys(entity.tags).length === 0 ? (
              <Empty className="tag-list__empty flex-none min-h-13 p-3 border-0">
                <EmptyHeader>
                  <EmptyDescription>No tags yet.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : null}
          </div>
          <FieldGroup className="tag-add items-end grid gap-1.25 grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_auto] mt-2">
            <Field className="gap-0 min-w-0">
              <FieldLabel className="sr-only" htmlFor="new-tag-key">
                New tag key
              </FieldLabel>
              <Input
                className="h-7 min-w-0 w-full"
                id="new-tag-key"
                onChange={(event) => setNewTagKey(event.target.value)}
                placeholder="key"
                value={newTagKey}
              />
            </Field>
            <Field className="gap-0 min-w-0">
              <FieldLabel className="sr-only" htmlFor="new-tag-value">
                New tag value
              </FieldLabel>
              <Input
                className="h-7 min-w-0 w-full"
                id="new-tag-value"
                onChange={(event) => setNewTagValue(event.target.value)}
                placeholder="value"
                value={newTagValue}
              />
            </Field>
            <Button disabled={!newTagKey.trim()} onClick={addTag} size="sm" type="button">
              <PlusIcon data-icon="inline-start" />
              Add
            </Button>
          </FieldGroup>
        </InspectorSection>
      </div>
    </aside>
  );
}

function InspectorSection({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section className="form-section p-3">
      <h3 className="text-[11px] font-[650] mb-2.5 mt-0">{title}</h3>
      {children}
    </section>
  );
}
