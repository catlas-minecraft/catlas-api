import { resolveLocalizedText } from "@catlas/features";
import { Button } from "@/components/ui/button";
import type { CatlasEditor } from "@/lib/editor";
import type { EditorEntity } from "@/lib/editor/types";
import { assignableFeaturesForEntity } from "@/lib/editor/features";
import { InspectorSection } from "./editor-inspector-section";

export function EditorFeaturePickerSection({
  editor,
  entity,
  onApplyFeature,
}: {
  readonly editor: CatlasEditor;
  readonly entity: EditorEntity;
  readonly onApplyFeature: (featureId: string) => void;
}) {
  const registry = editor.featureRegistry;
  const locale = navigator.language;
  const features = assignableFeaturesForEntity(registry, entity);
  const defaultLocale = registry.document.defaultLocale;

  return (
    <InspectorSection title="Feature">
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
        Choose the feature that describes this entity.
      </p>
      {features.length > 0 ? (
        <div className="grid gap-3">
          {registry.document.categories.map((category) => {
            const categoryFeatures = features.filter((feature) => feature.category === category.id);
            if (categoryFeatures.length === 0) return null;
            const categoryId = `feature-category-${entity.type}-${entity.id}-${category.id}`;
            return (
              <div
                aria-labelledby={categoryId}
                className="grid gap-1.5"
                key={category.id}
                role="group"
              >
                <h4
                  className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground"
                  id={categoryId}
                >
                  {resolveLocalizedText(category.displayName, locale, defaultLocale)}
                </h4>
                <ul className="grid gap-1.5">
                  {categoryFeatures.map((feature) => {
                    const name = resolveLocalizedText(feature.displayName, locale, defaultLocale);
                    return (
                      <li key={feature.id}>
                        <Button
                          aria-label={`Apply ${name}`}
                          className="h-auto min-h-8 w-full justify-start whitespace-normal px-2.5 py-2 text-start"
                          onClick={() => onApplyFeature(feature.id)}
                          type="button"
                          variant="outline"
                        >
                          {name}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No features are available for this geometry.
        </p>
      )}
    </InspectorSection>
  );
}
