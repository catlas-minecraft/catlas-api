import {
  FEATURE_FIELD_UNSET_VALUE,
  FEATURE_KINDS,
  type CategoryDefinition,
  type EditorFieldDefinition,
  type FeatureDocument,
  type FeatureKind,
  type FeatureRegistry,
  type FeatureRegistryDiagnostic,
  type FeatureRegistryOptions,
  type FeatureResolution,
  type FeatureSubject,
  type FeatureTags,
  type LocalizedText,
  type ResolvedFeature,
} from "./types.ts";

type ValidationIssue = {
  readonly message: string;
  readonly path: string;
};

const FEATURE_ID = /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/;
const CATEGORY_ID = /^[a-z][a-z0-9_-]*$/;
const RESERVED_TAGS = new Set([
  "changeset_id",
  "deleted_at",
  "geometry_kind",
  "is_closed",
  "relation_type",
  "version",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const ownValue = <T>(record: Readonly<Record<string, T>>, key: string) =>
  Object.hasOwn(record, key) ? record[key] : undefined;

const pathFor = (path: string, key: string | number) =>
  typeof key === "number" ? `${path}[${key}]` : `${path}.${key}`;

const expectObject = (value: unknown, path: string, issues: ValidationIssue[]) => {
  if (isRecord(value)) return value;
  issues.push({ path, message: "Expected an object." });
  return null;
};

const rejectUnknownKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: ValidationIssue[],
) => {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push({ path: pathFor(path, key), message: "Unknown property." });
    }
  }
};

const expectString = (value: unknown, path: string, issues: ValidationIssue[], required = true) => {
  if (!required && value === undefined) return;
  if (typeof value !== "string" || value.length === 0) {
    issues.push({ path, message: "Expected a non-empty string." });
  }
};

const expectBoolean = (
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  required = true,
) => {
  if (!required && value === undefined) return;
  if (typeof value !== "boolean") issues.push({ path, message: "Expected a boolean." });
};

const expectInteger = (
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  options: { readonly required?: boolean; readonly minimum?: number } = {},
) => {
  if (options.required === false && value === undefined) return;
  if (!Number.isInteger(value)) {
    issues.push({ path, message: "Expected an integer." });
    return;
  }
  if (options.minimum !== undefined && (value as number) < options.minimum) {
    issues.push({ path, message: `Expected a value greater than or equal to ${options.minimum}.` });
  }
};

const validateLocalizedText = (value: unknown, path: string, issues: ValidationIssue[]) => {
  const object = expectObject(value, path, issues);
  if (!object) return;
  if (Object.keys(object).length === 0) {
    issues.push({ path, message: "Expected at least one locale." });
  }
  for (const [locale, text] of Object.entries(object)) {
    if (!/^[A-Za-z0-9-]+$/.test(locale)) {
      issues.push({ path: pathFor(path, locale), message: "Invalid locale key." });
    }
    expectString(text, pathFor(path, locale), issues);
  }
};

const validateTags = (value: unknown, path: string, issues: ValidationIssue[]) => {
  const object = expectObject(value, path, issues);
  if (!object) return;
  if (Object.keys(object).length === 0) {
    issues.push({ path, message: "Expected at least one tag." });
  }
  for (const [key, tagValue] of Object.entries(object)) {
    expectString(key, pathFor(path, key), issues);
    expectString(tagValue, pathFor(path, key), issues);
  }
};

const validateField = (value: unknown, path: string, issues: ValidationIssue[]) => {
  const field = expectObject(value, path, issues);
  if (!field) return;
  if (field.type === "text") {
    rejectUnknownKeys(field, ["type", "tag", "label", "required", "placeholder"], path, issues);
    expectString(field.tag, pathFor(path, "tag"), issues);
    validateLocalizedText(field.label, pathFor(path, "label"), issues);
    expectBoolean(field.required, pathFor(path, "required"), issues, false);
    if (field.placeholder !== undefined) {
      validateLocalizedText(field.placeholder, pathFor(path, "placeholder"), issues);
    }
    return;
  }
  if (field.type === "select") {
    rejectUnknownKeys(
      field,
      ["type", "tag", "label", "required", "allowUnset", "options"],
      path,
      issues,
    );
    expectString(field.tag, pathFor(path, "tag"), issues);
    validateLocalizedText(field.label, pathFor(path, "label"), issues);
    expectBoolean(field.required, pathFor(path, "required"), issues, false);
    expectBoolean(field.allowUnset, pathFor(path, "allowUnset"), issues, false);
    if (!Array.isArray(field.options) || field.options.length === 0) {
      issues.push({ path: pathFor(path, "options"), message: "Expected at least one option." });
      return;
    }
    field.options.forEach((option, index) => {
      const optionPath = pathFor(pathFor(path, "options"), index);
      const object = expectObject(option, optionPath, issues);
      if (!object) return;
      rejectUnknownKeys(object, ["value", "label"], optionPath, issues);
      expectString(object.value, pathFor(optionPath, "value"), issues);
      validateLocalizedText(object.label, pathFor(optionPath, "label"), issues);
    });
    return;
  }
  issues.push({ path: pathFor(path, "type"), message: 'Expected "text" or "select".' });
};

const validateFeature = (value: unknown, path: string, issues: ValidationIssue[]) => {
  const feature = expectObject(value, path, issues);
  if (!feature) return;
  rejectUnknownKeys(
    feature,
    ["id", "displayName", "category", "appliesTo", "match", "editor", "viewer"],
    path,
    issues,
  );
  expectString(feature.id, pathFor(path, "id"), issues);
  validateLocalizedText(feature.displayName, pathFor(path, "displayName"), issues);
  expectString(feature.category, pathFor(path, "category"), issues);

  if (!Array.isArray(feature.appliesTo) || feature.appliesTo.length === 0) {
    issues.push({ path: pathFor(path, "appliesTo"), message: "Expected at least one kind." });
  } else {
    feature.appliesTo.forEach((kind, index) => {
      if (!FEATURE_KINDS.includes(kind as FeatureKind)) {
        issues.push({
          path: pathFor(pathFor(path, "appliesTo"), index),
          message: "Unknown feature kind.",
        });
      }
    });
  }

  const matchPath = pathFor(path, "match");
  const match = expectObject(feature.match, matchPath, issues);
  if (match) {
    rejectUnknownKeys(match, ["priority", "tags"], matchPath, issues);
    expectInteger(match.priority, pathFor(matchPath, "priority"), issues, { required: false });
    validateTags(match.tags, pathFor(matchPath, "tags"), issues);
  }

  if (feature.editor !== undefined) {
    const editorPath = pathFor(path, "editor");
    const editor = expectObject(feature.editor, editorPath, issues);
    if (editor) {
      rejectUnknownKeys(editor, ["create", "snapPolicy", "fields"], editorPath, issues);
      if (editor.create !== undefined) {
        const createPath = pathFor(editorPath, "create");
        const create = expectObject(editor.create, createPath, issues);
        if (create) {
          rejectUnknownKeys(create, ["kind", "tags"], createPath, issues);
          if (!FEATURE_KINDS.slice(0, 3).includes(create.kind as FeatureKind)) {
            issues.push({ path: pathFor(createPath, "kind"), message: "Unknown creation kind." });
          }
          validateTags(create.tags, pathFor(createPath, "tags"), issues);
        }
      }
      if (
        editor.snapPolicy !== undefined &&
        (typeof editor.snapPolicy !== "string" ||
          !["integer", "half", "free"].includes(editor.snapPolicy))
      ) {
        issues.push({ path: pathFor(editorPath, "snapPolicy"), message: "Unknown snap policy." });
      }
      if (editor.fields !== undefined) {
        if (!Array.isArray(editor.fields)) {
          issues.push({ path: pathFor(editorPath, "fields"), message: "Expected an array." });
        } else {
          editor.fields.forEach((field, index) =>
            validateField(field, pathFor(pathFor(editorPath, "fields"), index), issues),
          );
        }
      }
    }
  }

  if (feature.viewer !== undefined) {
    const viewerPath = pathFor(path, "viewer");
    const viewer = expectObject(feature.viewer, viewerPath, issues);
    if (viewer) {
      rejectUnknownKeys(viewer, ["minZoom", "icon", "label"], viewerPath, issues);
      expectInteger(viewer.minZoom, pathFor(viewerPath, "minZoom"), issues, { minimum: 0 });
      expectString(viewer.icon, pathFor(viewerPath, "icon"), issues, false);
      if (viewer.label !== undefined) {
        const labelPath = pathFor(viewerPath, "label");
        const label = expectObject(viewer.label, labelPath, issues);
        if (label) {
          rejectUnknownKeys(label, ["tag", "minZoom", "collisionPriority"], labelPath, issues);
          expectString(label.tag, pathFor(labelPath, "tag"), issues);
          expectInteger(label.minZoom, pathFor(labelPath, "minZoom"), issues, { minimum: 0 });
          expectInteger(label.collisionPriority, pathFor(labelPath, "collisionPriority"), issues);
        }
      }
    }
  }
};

export class FeatureRegistryError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
    this.name = "FeatureRegistryError";
    this.issues = issues;
  }
}

export const parseFeatureDocument = (input: unknown): FeatureDocument => {
  const issues: ValidationIssue[] = [];
  const document = expectObject(input, "$", issues);
  if (!document) throw new FeatureRegistryError(issues);
  rejectUnknownKeys(
    document,
    ["$schema", "schemaVersion", "defaultLocale", "categories", "features"],
    "$",
    issues,
  );
  expectString(document.$schema, "$.$schema", issues, false);
  if (document.schemaVersion !== "1.0.0") {
    issues.push({ path: "$.schemaVersion", message: 'Expected supported version "1.0.0".' });
  }
  expectString(document.defaultLocale, "$.defaultLocale", issues);

  if (!Array.isArray(document.categories)) {
    issues.push({ path: "$.categories", message: "Expected an array." });
  } else {
    document.categories.forEach((category, index) => {
      const path = `$.categories[${index}]`;
      const object = expectObject(category, path, issues);
      if (!object) return;
      rejectUnknownKeys(object, ["id", "displayName"], path, issues);
      expectString(object.id, pathFor(path, "id"), issues);
      validateLocalizedText(object.displayName, pathFor(path, "displayName"), issues);
    });
  }

  if (!Array.isArray(document.features)) {
    issues.push({ path: "$.features", message: "Expected an array." });
  } else {
    document.features.forEach((feature, index) =>
      validateFeature(feature, `$.features[${index}]`, issues),
    );
  }

  if (issues.length > 0) throw new FeatureRegistryError(issues);
  return document as unknown as FeatureDocument;
};

const resolveCandidates = (
  features: readonly ResolvedFeature[],
  subject: FeatureSubject,
): FeatureResolution => {
  const matches = features
    .filter(
      (feature) =>
        feature.appliesTo.includes(subject.kind) &&
        Object.entries(feature.match.tags).every(
          ([key, value]) => ownValue(subject.tags, key) === value,
        ),
    )
    .sort(
      (left, right) =>
        right.matchPriority - left.matchPriority ||
        right.matchSpecificity - left.matchSpecificity ||
        left.declarationIndex - right.declarationIndex,
    );
  const primary = matches[0] ?? null;
  const runnerUp = matches[1];
  return {
    primary,
    matches,
    ambiguous:
      primary !== null &&
      runnerUp !== undefined &&
      primary.matchPriority === runnerUp.matchPriority &&
      primary.matchSpecificity === runnerUp.matchSpecificity,
  };
};

const tagsCanCoexist = (left: FeatureTags, right: FeatureTags) =>
  Object.entries(left).every(([key, value]) => {
    const rightValue = ownValue(right, key);
    return rightValue === undefined || rightValue === value;
  });

const kindsOverlap = (left: readonly FeatureKind[], right: readonly FeatureKind[]) =>
  left.some((kind) => right.includes(kind));

const validateTagKeys = (tags: FeatureTags, path: string, issues: ValidationIssue[]) => {
  for (const key of Object.keys(tags)) {
    if (RESERVED_TAGS.has(key)) {
      issues.push({ path: pathFor(path, key), message: "Reserved structural tag key." });
    }
  }
};

const validateLocalizedTextLocale = (
  text: LocalizedText,
  defaultLocale: string,
  path: string,
  issues: ValidationIssue[],
) => {
  if (!ownValue(text, defaultLocale)) {
    issues.push({ path, message: `Missing default locale "${defaultLocale}".` });
  }
};

const validateFields = (
  fields: readonly EditorFieldDefinition[],
  defaultLocale: string,
  path: string,
  issues: ValidationIssue[],
) => {
  const fieldTags = new Set<string>();
  fields.forEach((field, index) => {
    const fieldPath = pathFor(path, index);
    if (fieldTags.has(field.tag)) {
      issues.push({ path: pathFor(fieldPath, "tag"), message: "Duplicate editor field tag." });
    }
    fieldTags.add(field.tag);
    if (RESERVED_TAGS.has(field.tag)) {
      issues.push({ path: pathFor(fieldPath, "tag"), message: "Reserved structural tag key." });
    }
    validateLocalizedTextLocale(field.label, defaultLocale, pathFor(fieldPath, "label"), issues);
    if (field.type === "text" && field.placeholder) {
      validateLocalizedTextLocale(
        field.placeholder,
        defaultLocale,
        pathFor(fieldPath, "placeholder"),
        issues,
      );
    }
    if (field.type === "select") {
      if (field.required && field.allowUnset) {
        issues.push({
          path: pathFor(fieldPath, "allowUnset"),
          message: "A required field cannot allow an unset value.",
        });
      }
      const values = new Set<string>();
      field.options.forEach((option, optionIndex) => {
        const optionPath = pathFor(pathFor(fieldPath, "options"), optionIndex);
        if (values.has(option.value)) {
          issues.push({ path: pathFor(optionPath, "value"), message: "Duplicate option value." });
        }
        if (option.value === FEATURE_FIELD_UNSET_VALUE) {
          issues.push({
            path: pathFor(optionPath, "value"),
            message: "Option value is reserved by the editor.",
          });
        }
        values.add(option.value);
        validateLocalizedTextLocale(
          option.label,
          defaultLocale,
          pathFor(optionPath, "label"),
          issues,
        );
      });
    }
  });
};

export const resolveFeatureRegistry = (
  document: FeatureDocument,
  options: FeatureRegistryOptions = {},
): FeatureRegistry => {
  const issues: ValidationIssue[] = [];
  const diagnostics: FeatureRegistryDiagnostic[] = [];
  const categoriesById = new Map<string, CategoryDefinition>();
  document.categories.forEach((category, index) => {
    const path = `$.categories[${index}]`;
    if (!CATEGORY_ID.test(category.id)) {
      issues.push({ path: pathFor(path, "id"), message: "Invalid category ID." });
    }
    if (categoriesById.has(category.id)) {
      issues.push({ path: pathFor(path, "id"), message: "Duplicate category ID." });
    }
    categoriesById.set(category.id, category);
    validateLocalizedTextLocale(
      category.displayName,
      document.defaultLocale,
      pathFor(path, "displayName"),
      issues,
    );
  });

  const features = document.features.map<ResolvedFeature>((feature, declarationIndex) => ({
    ...feature,
    declarationIndex,
    matchPriority: feature.match.priority ?? 0,
    matchSpecificity: Object.keys(feature.match.tags).length,
  }));
  const featuresById = new Map<string, ResolvedFeature>();
  features.forEach((feature, index) => {
    const path = `$.features[${index}]`;
    if (!FEATURE_ID.test(feature.id)) {
      issues.push({ path: pathFor(path, "id"), message: "Invalid dotted feature ID." });
    }
    if (featuresById.has(feature.id)) {
      issues.push({ path: pathFor(path, "id"), message: "Duplicate feature ID." });
    }
    featuresById.set(feature.id, feature);
    if (!categoriesById.has(feature.category)) {
      issues.push({ path: pathFor(path, "category"), message: "Unknown category ID." });
    }
    if (new Set(feature.appliesTo).size !== feature.appliesTo.length) {
      issues.push({ path: pathFor(path, "appliesTo"), message: "Duplicate feature kind." });
    }
    validateLocalizedTextLocale(
      feature.displayName,
      document.defaultLocale,
      pathFor(path, "displayName"),
      issues,
    );
    validateTagKeys(feature.match.tags, `${path}.match.tags`, issues);

    const create = feature.editor?.create;
    if (create) {
      if (!feature.appliesTo.includes(create.kind)) {
        issues.push({
          path: `${path}.editor.create.kind`,
          message: "Creation kind is not included in appliesTo.",
        });
      }
      validateTagKeys(create.tags, `${path}.editor.create.tags`, issues);
      for (const [key, value] of Object.entries(feature.match.tags)) {
        if (ownValue(create.tags, key) !== value) {
          issues.push({
            path: `${path}.editor.create.tags.${key}`,
            message: "Creation tags must include all matcher tags.",
          });
        }
      }
    }
    validateFields(
      feature.editor?.fields ?? [],
      document.defaultLocale,
      `${path}.editor.fields`,
      issues,
    );

    if (feature.viewer?.label && feature.viewer.label.minZoom < feature.viewer.minZoom) {
      issues.push({
        path: `${path}.viewer.label.minZoom`,
        message: "Label minZoom must be greater than or equal to viewer minZoom.",
      });
    }
    if (feature.viewer?.icon && options.iconIds && !options.iconIds.has(feature.viewer.icon)) {
      issues.push({ path: `${path}.viewer.icon`, message: "Unknown icon ID." });
    }
  });

  for (let leftIndex = 0; leftIndex < features.length; leftIndex += 1) {
    const left = features[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < features.length; rightIndex += 1) {
      const right = features[rightIndex]!;
      if (!kindsOverlap(left.appliesTo, right.appliesTo)) continue;
      if (!tagsCanCoexist(left.match.tags, right.match.tags)) continue;
      if (
        left.matchPriority === right.matchPriority &&
        left.matchSpecificity === right.matchSpecificity
      ) {
        diagnostics.push({
          severity: "warning",
          code: "ambiguous-matchers",
          path: `$.features[${rightIndex}].match`,
          message: `${left.id} and ${right.id} can tie; declaration order will choose ${left.id}.`,
        });
      }
      if (
        left.matchSpecificity === right.matchSpecificity &&
        Object.entries(left.match.tags).every(
          ([key, value]) => ownValue(right.match.tags, key) === value,
        )
      ) {
        issues.push({
          path: `$.features[${rightIndex}].match`,
          message: `Duplicate matcher for overlapping kinds already used by ${left.id}.`,
        });
      }
    }
  }

  if (issues.length > 0) throw new FeatureRegistryError(issues);

  const resolve = (subject: FeatureSubject) => resolveCandidates(features, subject);
  for (const feature of features) {
    const create = feature.editor?.create;
    if (!create) continue;
    const resolution = resolve({ kind: create.kind, tags: create.tags });
    if (resolution.primary?.id !== feature.id) {
      issues.push({
        path: `$.features[${feature.declarationIndex}].editor.create.tags`,
        message: `Creation tags resolve to ${resolution.primary?.id ?? "no feature"} instead of ${feature.id}.`,
      });
    }
  }
  if (issues.length > 0) throw new FeatureRegistryError(issues);

  return {
    document,
    features,
    featuresById,
    categoriesById,
    diagnostics,
    resolve,
  };
};

export const createFeatureRegistry = (input: unknown, options?: FeatureRegistryOptions) =>
  resolveFeatureRegistry(parseFeatureDocument(input), options);
