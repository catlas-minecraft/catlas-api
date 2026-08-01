import { CloudUploadIcon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import type { CatlasEditor } from "@/lib/editor";
import { changesetsQueryKey } from "@/lib/query-keys";
import { useEditorSnapshot } from "./use-editor-snapshot";

export function EditorSavePanel({ editor }: { readonly editor: CatlasEditor | null }) {
  if (!editor) return null;
  return <SavePanelContent editor={editor} />;
}

function SavePanelContent({ editor }: { readonly editor: CatlasEditor }) {
  const queryClient = useQueryClient();
  const snapshot = useEditorSnapshot(editor);
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const blockingIssues = snapshot.issues.filter((issue) => issue.severity === "error");
  const isSaving = snapshot.save.status === "saving";
  const isAuthenticated = snapshot.auth.status === "authenticated";
  const canSave = snapshot.dirty && blockingIssues.length === 0 && !isSaving && isAuthenticated;
  const disabledReason = !isAuthenticated
    ? "Sign in before saving changes."
    : blockingIssues.length
      ? `${blockingIssues.length} errors block saving.`
      : !snapshot.dirty
        ? "No unsaved changes."
        : undefined;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSave) return;
    void editor.save(comment.trim() || null).then(() => {
      if (editor.getSnapshot().save.status !== "saved") return;
      void queryClient.invalidateQueries({ queryKey: changesetsQueryKey(editor.worldSlug) });
      setOpen(false);
      setComment("");
    });
  };

  return (
    <Popover
      onOpenChange={(nextOpen) => {
        if (nextOpen && !canSave) return;
        setOpen(nextOpen);
      }}
      open={open}
    >
      <PopoverTrigger asChild>
        <Button
          aria-label="Save changes"
          disabled={!canSave}
          size="sm"
          title={disabledReason ?? "Save changes"}
          type="button"
        >
          {isSaving ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <CloudUploadIcon data-icon="inline-start" />
          )}
          {isSaving ? "Saving..." : "Save"}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="save-panel w-[calc(100vw-28px)] min-[860px]:w-[min(360px,calc(100vw-28px))]"
        sideOffset={10}
      >
        <PopoverHeader>
          <PopoverTitle>Save changes</PopoverTitle>
          <PopoverDescription>
            Add an optional message before publishing this changeset.
          </PopoverDescription>
        </PopoverHeader>
        <form className="save-panel__form flex flex-col gap-3" onSubmit={handleSubmit}>
          <FieldGroup className="gap-3">
            <Field>
              <FieldLabel htmlFor="changeset-comment">Message</FieldLabel>
              <Input
                aria-label="Changeset message"
                autoFocus
                disabled={isSaving}
                id="changeset-comment"
                onChange={(event) => setComment(event.target.value)}
                placeholder="Describe your changes"
                value={comment}
              />
              <FieldDescription>
                {snapshot.issues.length
                  ? `${snapshot.issues.length} checks, ${blockingIssues.length} blocking.`
                  : "Ready to save."}
              </FieldDescription>
            </Field>
          </FieldGroup>
          <div className="save-panel__actions flex justify-end">
            <Button disabled={!canSave} type="submit">
              {isSaving ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <CloudUploadIcon data-icon="inline-start" />
              )}
              {isSaving ? "Saving..." : "Done"}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
