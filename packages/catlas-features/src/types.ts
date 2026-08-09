export const FEATURE_KINDS = ["node", "line", "area", "relation"] as const;
export const FEATURE_FIELD_UNSET_VALUE = "__catlas_unset__";
export type FeatureKind = (typeof FEATURE_KINDS)[number];

export type LocalizedText = Readonly<Record<string, string>>;
export type FeatureTags = Readonly<Record<string, string>>;

export type CategoryDefinition = {
  readonly id: string;
  readonly displayName: LocalizedText;
};

export type TextFieldDefinition = {
  readonly type: "text";
  readonly tag: string;
  readonly label: LocalizedText;
  readonly required?: boolean;
  readonly placeholder?: LocalizedText;
};

export type SelectFieldOption = {
  readonly value: string;
  readonly label: LocalizedText;
};

export type SelectFieldDefinition = {
  readonly type: "select";
  readonly tag: string;
  readonly label: LocalizedText;
  readonly required?: boolean;
  readonly allowUnset?: boolean;
  readonly options: readonly SelectFieldOption[];
};

export type EditorFieldDefinition = TextFieldDefinition | SelectFieldDefinition;

export type FeatureDefinition = {
  readonly id: string;
  readonly displayName: LocalizedText;
  readonly category: string;
  readonly appliesTo: readonly FeatureKind[];
  readonly match: {
    readonly priority?: number;
    readonly tags: FeatureTags;
  };
  readonly editor?: {
    readonly create?: {
      readonly kind: Exclude<FeatureKind, "relation">;
      readonly tags: FeatureTags;
    };
    readonly snapPolicy?: "integer" | "half" | "free";
    readonly fields?: readonly EditorFieldDefinition[];
  };
  readonly viewer?: {
    readonly minZoom: number;
    readonly icon?: string;
    readonly label?: {
      readonly tag: string;
      readonly minZoom: number;
      readonly collisionPriority: number;
    };
  };
};

export type FeatureDocument = {
  readonly $schema?: string;
  readonly schemaVersion: "1.0.0";
  readonly defaultLocale: string;
  readonly categories: readonly CategoryDefinition[];
  readonly features: readonly FeatureDefinition[];
};

export type ResolvedFeature = FeatureDefinition & {
  readonly declarationIndex: number;
  readonly matchSpecificity: number;
  readonly matchPriority: number;
};

export type FeatureSubject = {
  readonly kind: FeatureKind;
  readonly tags: FeatureTags;
};

export type FeatureResolution = {
  readonly primary: ResolvedFeature | null;
  readonly matches: readonly ResolvedFeature[];
  readonly ambiguous: boolean;
};

export type FeatureRegistryDiagnostic = {
  readonly code: string;
  readonly message: string;
  readonly path: string;
  readonly severity: "warning";
};

export type FeatureRegistry = {
  readonly document: FeatureDocument;
  readonly features: readonly ResolvedFeature[];
  readonly featuresById: ReadonlyMap<string, ResolvedFeature>;
  readonly categoriesById: ReadonlyMap<string, CategoryDefinition>;
  readonly diagnostics: readonly FeatureRegistryDiagnostic[];
  readonly resolve: (subject: FeatureSubject) => FeatureResolution;
};

export type FeatureRegistryOptions = {
  readonly iconIds?: ReadonlySet<string>;
};
