import { CTileLayer, ViewportLayer, Coordinator, CatlasMap } from "@catlas/leaflet";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: App });

function App() {
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
      <ViewportLayer url="/api/viewport" />
      <Coordinator />
    </CatlasMap>
  );
}
