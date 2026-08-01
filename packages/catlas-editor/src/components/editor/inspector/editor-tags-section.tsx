import { useState } from "react";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import type { CatlasEditor } from "@/lib/editor";
import type { EditorEntity } from "@/lib/editor/types";
import { EditorTagAddRow } from "./editor-tag-add-row";
import { EditorTagRow } from "./editor-tag-row";
import { InspectorSection } from "./editor-inspector-section";

type EditorTagsSectionProps = {
  readonly editor: CatlasEditor;
  readonly entity: EditorEntity;
};

export function EditorTagsSection({ editor, entity }: EditorTagsSectionProps) {
  const [newTagKey, setNewTagKey] = useState("");
  const [newTagValue, setNewTagValue] = useState("");

  const addTag = () => {
    const key = newTagKey.trim();
    if (!key) return;
    editor.updateTag(key, newTagValue);
    setNewTagKey("");
    setNewTagValue("");
  };

  return (
    <InspectorSection title="All tags">
      <div className="tag-table overflow-hidden rounded-lg border border-border/80 bg-card/45">
        <div className="tag-list grid gap-0">
          {Object.entries(entity.tags).map(([key, value]) => (
            <EditorTagRow
              entity={entity}
              key={key}
              onRemove={(tagKey) => editor.removeTag(tagKey)}
              onUpdate={(tagKey, value) => editor.updateTag(tagKey, value)}
              tagKey={key}
              value={value}
            />
          ))}
          {Object.keys(entity.tags).length === 0 ? (
            <Empty className="tag-list__empty min-h-13 flex-none rounded-none border-0 border-b border-dashed border-border/70 bg-muted/25 p-3">
              <EmptyHeader>
                <EmptyDescription className="text-[11px] text-muted-foreground">
                  No tags yet.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : null}
        </div>
        <EditorTagAddRow
          onAdd={addTag}
          onKeyChange={setNewTagKey}
          onValueChange={setNewTagValue}
          tagKey={newTagKey}
          tagValue={newTagValue}
        />
      </div>
    </InspectorSection>
  );
}
