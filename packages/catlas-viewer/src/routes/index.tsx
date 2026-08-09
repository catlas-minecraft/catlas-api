import { CTileLayer, ViewportLayer, Coordinator, CatlasMap } from "@catlas/leaflet";
import { defaultFeatureRegistry } from "@catlas/features";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: App });

function App() {
  const worlds = useQuery({
    queryKey: ["worlds"],
    queryFn: async () => {
      const response = await fetch("/api/worlds");
      if (!response.ok) throw new Error(`World request failed: ${response.status}`);
      return (await response.json()) as readonly { readonly name: string; readonly slug: string }[];
    },
  });

  if (worlds.isPending) return <ViewerStatus>Loading world...</ViewerStatus>;
  if (worlds.isError) return <ViewerStatus>Unable to load worlds.</ViewerStatus>;

  const requestedSlug = new URLSearchParams(window.location.search).get("world");
  const requestedWorld = worlds.data.find((candidate) => candidate.slug === requestedSlug);
  if (requestedSlug && !requestedWorld) {
    return <ViewerStatus>The requested world is unavailable.</ViewerStatus>;
  }
  const world = requestedWorld ?? worlds.data[0];
  if (!world) return <ViewerStatus>No worlds are available.</ViewerStatus>;

  return (
    <CatlasMap className="w-full h-screen">
      <CTileLayer
        urlTemplate="/tiles/{x}.{y}.gif"
        tileSize={512}
        bounds={[
          [-Infinity, -Infinity],
          [Infinity, Infinity],
        ]}
        minNativeZoom={3}
        maxNativeZoom={3}
        noWrap={true}
        className="pixel-map"
      />
      <ViewportLayer
        featureRegistry={defaultFeatureRegistry}
        url={`/api/worlds/${encodeURIComponent(world.slug)}/viewport`}
      />
      <Coordinator />
    </CatlasMap>
  );
}

function ViewerStatus({ children }: { readonly children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 p-6 text-sm text-slate-200">
      <p role="status">{children}</p>
    </main>
  );
}
