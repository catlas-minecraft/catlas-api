import {
  FEATURE_FIELD_UNSET_VALUE,
  resolveLocalizedText,
  type EditorFieldDefinition,
  type ResolvedFeature,
} from "@catlas/features";
import { useEffect, useRef } from "react";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CatlasEditor } from "@/lib/editor";
import type { EditorEntity, EntityRef } from "@/lib/editor/types";
import { InspectorSection } from "./editor-inspector-section";

const commitFieldValue = (
  editor: CatlasEditor,
  entity: EntityRef,
  field: EditorFieldDefinition,
  value: string,
) => {
  if (value) editor.updateEntityTag(entity, field.tag, value);
  else if (!field.required) editor.removeEntityTag(entity, field.tag);
};

export function EditorFeatureSection({
  editor,
  entity,
  feature,
  focusOnMount = false,
}: {
  readonly editor: CatlasEditor;
  readonly entity: EditorEntity;
  readonly feature: ResolvedFeature;
  readonly focusOnMount?: boolean;
}) {
  const fields = feature.editor?.fields ?? [];
  const drafts = useRef(new Map<string, string>());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const locale = navigator.language;
  const defaultLocale = editor.featureRegistry.document.defaultLocale;
  const entityRef = { type: entity.type, id: entity.id } as const;

  useEffect(() => {
    const target = { type: entity.type, id: entity.id } as const;
    return () => {
      const pendingDrafts = [...drafts.current];
      drafts.current.clear();
      for (const [tag, value] of pendingDrafts) {
        const field = fields.find((candidate) => candidate.tag === tag);
        if (field) commitFieldValue(editor, target, field, value);
      }
    };
  }, [editor, entity.id, entity.type, fields]);

  useEffect(() => {
    if (focusOnMount) headingRef.current?.focus();
  }, [focusOnMount]);

  return (
    <InspectorSection
      headingRef={headingRef}
      headingTabIndex={focusOnMount ? -1 : undefined}
      title={resolveLocalizedText(feature.displayName, locale, defaultLocale)}
    >
      {fields.length > 0 ? (
        <FieldGroup className="gap-3">
          {fields.map((field) => {
            const id = `feature-${entity.type}-${entity.id}-${field.tag}`;
            const label = resolveLocalizedText(field.label, locale, defaultLocale);
            const value = Object.hasOwn(entity.tags, field.tag) ? entity.tags[field.tag]! : "";
            const invalid = Boolean(field.required && !value);

            if (field.type === "text") {
              return (
                <Field data-invalid={invalid} key={field.tag}>
                  <FieldLabel htmlFor={id}>{label}</FieldLabel>
                  <Input
                    defaultValue={value}
                    aria-invalid={invalid}
                    id={id}
                    key={`${id}-${value}`}
                    onChange={(event) => drafts.current.set(field.tag, event.target.value)}
                    onBlur={(event) => {
                      const nextValue = event.target.value;
                      commitFieldValue(editor, entityRef, field, nextValue);
                      drafts.current.delete(field.tag);
                      if (!nextValue && field.required) event.target.value = value;
                    }}
                    placeholder={
                      field.placeholder
                        ? resolveLocalizedText(field.placeholder, locale, defaultLocale)
                        : undefined
                    }
                    required={field.required}
                  />
                </Field>
              );
            }

            const knownValue = field.options.some((option) => option.value === value);
            return (
              <Field data-invalid={invalid} key={field.tag}>
                <FieldLabel htmlFor={id}>{label}</FieldLabel>
                <Select
                  onValueChange={(nextValue) => {
                    if (nextValue === FEATURE_FIELD_UNSET_VALUE) {
                      editor.removeEntityTag(entityRef, field.tag);
                    } else {
                      editor.updateEntityTag(entityRef, field.tag, nextValue);
                    }
                  }}
                  value={value}
                >
                  <SelectTrigger aria-invalid={invalid} aria-required={field.required} id={id}>
                    <SelectValue placeholder={field.required ? "Select a value" : "Not set"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {field.allowUnset && value ? (
                        <SelectItem value={FEATURE_FIELD_UNSET_VALUE}>Not set</SelectItem>
                      ) : null}
                      {value && !knownValue ? (
                        <SelectItem value={value}>{value} (custom)</SelectItem>
                      ) : null}
                      {field.options.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {resolveLocalizedText(option.label, locale, defaultLocale)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            );
          })}
        </FieldGroup>
      ) : (
        <p className="text-xs text-muted-foreground">No additional fields.</p>
      )}
    </InspectorSection>
  );
}
