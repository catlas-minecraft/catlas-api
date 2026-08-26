import { createCatlasApi, type CatlasApi, type BBox, type World } from "@catlas/api-client";
import { createListCollection } from "@ark-ui/solid";
import { createQuery } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, For, Show, type Accessor } from "solid-js";
import { Portal } from "solid-js/web";
import { Button } from "./components/ui/button.tsx";
import * as Select from "./components/ui/select.tsx";
import { initialLocale, messagesFor, persistLocale, type ViewerLocale } from "./i18n.ts";
import { ViewerMap } from "./map/viewer-map.tsx";
import { createViewportQueryOptions, createWorldsQueryOptions } from "./queries.ts";

const defaultApi = createCatlasApi();

export type AppProps = {
  readonly api?: CatlasApi;
  readonly worldSlug: Accessor<string | undefined>;
  readonly navigateWorld: (slug: string | undefined, mode: "push" | "replace") => void;
};

type ViewportRequest = {
  readonly bbox: BBox;
  readonly worldSlug: string;
};

type SelectOption = {
  readonly disabled?: boolean;
  readonly label: string;
  readonly value: string;
};

export const App = (props: AppProps) => {
  const api = props.api ?? defaultApi;
  const [locale, setLocale] = createSignal<ViewerLocale>(initialLocale());
  const messages = createMemo(() => messagesFor(locale()));
  const [viewportRequest, setViewportRequest] = createSignal<ViewportRequest>();

  const worldsQuery = createQuery(() => createWorldsQueryOptions(api));

  const worlds = createMemo<World[]>(() => worldsQuery.data ?? []);
  let activeWorldSlug: string | undefined;
  let initialWorldResolved = false;

  const selectedWorld = createMemo(() => {
    const slug = props.worldSlug();
    return slug ? worlds().find((world) => world.slug === slug) : undefined;
  });
  const invalidWorld = createMemo(() => {
    const slug = props.worldSlug();
    return Boolean(slug && worldsQuery.isSuccess && worlds().length > 0 && !selectedWorld());
  });

  const requestViewport = (bbox: BBox) => {
    const world = selectedWorld();
    if (!world) return;
    setViewportRequest({ bbox: [...bbox] as BBox, worldSlug: world.slug });
  };

  const viewportQuery = createQuery(() => {
    const world = selectedWorld();
    const request = viewportRequest();
    const bbox = request && request.worldSlug === world?.slug ? request.bbox : undefined;

    return createViewportQueryOptions(api, world?.slug, bbox);
  });

  const worldOptions = createMemo(() => {
    const options: SelectOption[] = worlds().map((world) => ({
      label: world.name,
      value: world.slug,
    }));
    const selectedSlug = props.worldSlug();
    if (selectedSlug && !options.some((option) => option.value === selectedSlug)) {
      return [{ disabled: true, label: selectedSlug, value: selectedSlug }, ...options];
    }
    return options;
  });
  const worldCollection = createMemo(() => createListCollection({ items: worldOptions() }));
  const localeOptions = createMemo<SelectOption[]>(() => [
    { label: messages().japanese, value: "ja" },
    { label: messages().english, value: "en" },
  ]);
  const localeCollection = createMemo(() => createListCollection({ items: localeOptions() }));

  const handleWorldChange = (nextSlug: string | null) => {
    if (!nextSlug || nextSlug === props.worldSlug()) return;
    props.navigateWorld(nextSlug, "push");
  };

  const handleLocaleChange = (nextLocale: string | null) => {
    if (nextLocale !== "ja" && nextLocale !== "en") return;
    setLocale(nextLocale);
    persistLocale(nextLocale);
  };

  createEffect(() => {
    const nextLocale = locale();
    document.documentElement.lang = nextLocale;
  });

  createEffect(() => {
    const result = worldsQuery.data;
    if (initialWorldResolved || !result) return;
    initialWorldResolved = true;
    const requestedSlug = props.worldSlug();
    if (!requestedSlug && result[0]) {
      props.navigateWorld(result[0].slug, "replace");
    }
  });

  createEffect(() => {
    const nextSlug = selectedWorld()?.slug;
    if (nextSlug === activeWorldSlug) return;
    activeWorldSlug = nextSlug;
    setViewportRequest(undefined);
  });

  return (
    <main class="viewer-app">
      <header class="viewer-header">
        <a class="brand" href="/" aria-label={messages().appName}>
          <span class="brand-mark" aria-hidden="true">
            C
          </span>
          <span>{messages().appName}</span>
        </a>
        <div class="viewer-header-controls">
          <Select.Root
            collection={worldCollection()}
            class="select-field"
            onValueChange={(details) => handleWorldChange(details.value[0] ?? null)}
            size="md"
            value={props.worldSlug() ? [props.worldSlug()!] : []}
            variant="outline"
          >
            <Select.HiddenSelect
              aria-label={messages().world}
              onChange={(event) => handleWorldChange(event.currentTarget.value || null)}
            />
            <Select.Label>{messages().world}</Select.Label>
            <Select.Control class="select-control">
              <Select.Trigger aria-label={messages().world} class="select-trigger">
                <Select.ValueText placeholder={messages().selectWorld} />
                <Select.Indicator aria-hidden="true" class="select-icon" />
              </Select.Trigger>
            </Select.Control>
            <Portal>
              <Select.Positioner>
                <Select.Content class="select-content">
                  <Select.List class="select-listbox">
                    <For each={worldCollection().items}>
                      {(item) => (
                        <Select.Item class="select-item" item={item}>
                          <Select.ItemText>{item.label}</Select.ItemText>
                          <Select.ItemIndicator aria-hidden="true" class="select-item-indicator" />
                        </Select.Item>
                      )}
                    </For>
                  </Select.List>
                </Select.Content>
              </Select.Positioner>
            </Portal>
          </Select.Root>
          <Select.Root
            collection={localeCollection()}
            class="select-field select-field-language"
            onValueChange={(details) => handleLocaleChange(details.value[0] ?? null)}
            size="md"
            value={[locale()]}
            variant="outline"
          >
            <Select.HiddenSelect
              aria-label={messages().language}
              onChange={(event) => handleLocaleChange(event.currentTarget.value || null)}
            />
            <Select.Label>{messages().language}</Select.Label>
            <Select.Control class="select-control">
              <Select.Trigger aria-label={messages().language} class="select-trigger">
                <Select.ValueText />
                <Select.Indicator aria-hidden="true" class="select-icon" />
              </Select.Trigger>
            </Select.Control>
            <Portal>
              <Select.Positioner>
                <Select.Content class="select-content">
                  <Select.List class="select-listbox">
                    <For each={localeCollection().items}>
                      {(item) => (
                        <Select.Item class="select-item" item={item}>
                          <Select.ItemText>{item.label}</Select.ItemText>
                          <Select.ItemIndicator aria-hidden="true" class="select-item-indicator" />
                        </Select.Item>
                      )}
                    </For>
                  </Select.List>
                </Select.Content>
              </Select.Positioner>
            </Portal>
          </Select.Root>
        </div>
        <div class="viewer-status" aria-live="polite">
          <Show when={worldsQuery.isPending}>
            <span role="status">{messages().loadingWorlds}</span>
          </Show>
          <Show when={!worldsQuery.isPending && selectedWorld() && viewportQuery.isFetching}>
            <span role="status">{messages().loadingMap}</span>
          </Show>
        </div>
      </header>

      <Show when={worldsQuery.isError}>
        <div class="viewer-message viewer-message-error" role="alert">
          <p>{messages().worldsError}</p>
          <Button
            size="sm"
            type="button"
            variant="solid"
            onClick={() => void worldsQuery.refetch()}
          >
            {messages().retry}
          </Button>
        </div>
      </Show>
      <Show when={invalidWorld()}>
        <div class="viewer-message viewer-message-error" role="alert">
          <p>{messages().worldUnavailable}</p>
          <p>{messages().chooseAnotherWorld}</p>
        </div>
      </Show>
      <Show when={worldsQuery.isSuccess && worlds().length === 0}>
        <div class="viewer-message viewer-message-empty" role="status">
          <p>{messages().noWorlds}</p>
        </div>
      </Show>

      <Show when={selectedWorld()}>
        {(world) => (
          <section class="viewer-main" aria-label={world().name}>
            <ViewerMap
              locale={locale}
              messages={messages}
              onViewportRequest={requestViewport}
              viewport={() => viewportQuery.data}
              viewportLoading={() => viewportQuery.isFetching}
              worldSlug={() => world().slug}
            />
            <Show when={viewportQuery.isError}>
              <div class="map-error" role="alert">
                <span>{messages().mapError}</span>
                <Button
                  size="sm"
                  type="button"
                  variant="solid"
                  onClick={() => void viewportQuery.refetch()}
                >
                  {messages().retry}
                </Button>
              </div>
            </Show>
          </section>
        )}
      </Show>
    </main>
  );
};
