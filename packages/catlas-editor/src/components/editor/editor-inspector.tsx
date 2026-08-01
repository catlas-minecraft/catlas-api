import { Badge } from "@/components/ui/badge";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { CatlasEditor, EditorSnapshot } from "@/lib/editor";
import { entityKey, geometryTypeForEntity } from "@/lib/editor/types";
import { EditorChangesReview } from "./editor-changes-review";
import { InspectorSection } from "./inspector/editor-inspector-section";
import { EditorTagsSection } from "./inspector/editor-tags-section";
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

  const geometry = entity ? geometryTypeForEntity(entity) : null;

  if (!entity) {
    return <EditorChangesReview editor={editor} snapshot={snapshot} />;
  }

  return (
    <aside className="inspector tags-inspector dark flex h-full min-h-0 min-w-0 flex-col bg-background text-foreground">
      <header className="inspector__header flex min-h-16 flex-[0_0_auto] items-start justify-between gap-2 border-b border-border/70 bg-background p-3 [&>div]:min-w-0">
        <div>
          <span className="eyebrow text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            {geometry}
          </span>
          <h2 className="mt-0.5 truncate text-sm font-semibold leading-tight text-foreground">
            {entity.tags.name ||
              (geometry === "point" ? "Point" : geometry === "line" ? "Line" : "Area")}
          </h2>
        </div>
        <Badge className="border-border bg-muted/55 text-foreground" variant="outline">
          <code>
            {entity.type[0]}
            {entity.id}
          </code>
        </Badge>
      </header>

      <div className="inspector__body min-h-0 overflow-y-auto overscroll-contain">
        <InspectorSection title="Geometry">
          <FieldGroup className="property-list gap-2.5">
            {entity.type === "node" ? (
              <Field
                className="property-row grid grid-cols-[minmax(58px,0.72fr)_minmax(0,1.28fr)] items-center gap-1.5"
                orientation="horizontal"
              >
                <FieldLabel
                  className="min-w-0 truncate text-[11px] text-muted-foreground"
                  htmlFor="node-height"
                >
                  Height
                </FieldLabel>
                <Input
                  className="h-8 min-w-0 w-full rounded-lg border-input bg-muted/70 px-2.5 text-xs text-foreground shadow-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
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
        <EditorTagsSection editor={editor} entity={entity} />
      </div>
    </aside>
  );
}
