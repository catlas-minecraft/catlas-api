import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { EditorEntity } from "@/lib/editor/types";
import { entityKey } from "@/lib/editor/types";

type EditorTagRowProps = {
  readonly entity: EditorEntity;
  readonly tagKey: string;
  readonly value: string;
  readonly onRemove: (key: string) => void;
  readonly onUpdate: (key: string, value: string) => void;
};

export function EditorTagRow({ entity, onRemove, onUpdate, tagKey, value }: EditorTagRowProps) {
  return (
    <div className="tag-row grid min-w-0 grid-cols-[minmax(58px,0.72fr)_minmax(0,1.28fr)] items-center gap-0 border-b border-border/70 last:border-b-0">
      <code
        className="flex min-h-8 min-w-0 items-center truncate border-r border-border/70 bg-muted/50 px-2 text-[10px] text-muted-foreground"
        title={tagKey}
      >
        {tagKey}
      </code>
      <div className="relative min-w-0 bg-muted/35">
        <Input
          aria-label={`${tagKey} value`}
          className="h-8 min-w-0 rounded-none border-0 bg-transparent px-2.5 pr-9 text-xs text-foreground shadow-none focus-visible:bg-primary/10 focus-visible:ring-0"
          defaultValue={value}
          key={`${entityKey(entity)}-${tagKey}-${value}`}
          onBlur={(event) => onUpdate(tagKey, event.target.value)}
        />
        <Button
          aria-label={`Remove ${tagKey}`}
          className="absolute right-0 top-0 size-8 rounded-none bg-transparent text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          onClick={() => onRemove(tagKey)}
          size="icon"
          type="button"
          variant="ghost"
        >
          <XIcon />
        </Button>
      </div>
    </div>
  );
}
