import type { KeyboardEvent } from "react";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type EditorTagAddRowProps = {
  readonly tagKey: string;
  readonly tagValue: string;
  readonly onKeyChange: (value: string) => void;
  readonly onValueChange: (value: string) => void;
  readonly onAdd: () => void;
};

export function EditorTagAddRow({
  onAdd,
  onKeyChange,
  onValueChange,
  tagKey,
  tagValue,
}: EditorTagAddRowProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    onAdd();
  };

  return (
    <FieldGroup className="tag-add grid items-end grid-cols-[minmax(58px,0.72fr)_minmax(0,1.28fr)] gap-0 border-t border-border/70">
      <Field className="min-w-0 gap-0 border-r border-border/70 bg-muted/35">
        <FieldLabel className="sr-only" htmlFor="new-tag-key">
          New tag key
        </FieldLabel>
        <Input
          aria-label="New tag key"
          className="h-8 min-w-0 rounded-none border-0 bg-transparent px-2 text-xs text-foreground shadow-none placeholder:text-muted-foreground/70 focus-visible:bg-primary/10 focus-visible:ring-0"
          id="new-tag-key"
          onChange={(event) => onKeyChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="key"
          value={tagKey}
        />
      </Field>
      <Field className="min-w-0 gap-0 bg-muted/35">
        <FieldLabel className="sr-only" htmlFor="new-tag-value">
          New tag value
        </FieldLabel>
        <Input
          aria-label="New tag value"
          className="h-8 min-w-0 rounded-none border-0 bg-transparent px-2 text-xs text-foreground shadow-none placeholder:text-muted-foreground/70 focus-visible:bg-primary/10 focus-visible:ring-0"
          id="new-tag-value"
          onChange={(event) => onValueChange(event.target.value)}
          onBlur={onAdd}
          onKeyDown={handleKeyDown}
          placeholder="value"
          value={tagValue}
        />
      </Field>
    </FieldGroup>
  );
}
