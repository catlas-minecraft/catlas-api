import { CRS as lCrs, extend as lExtend, transformation as lTransformation } from "leaflet";
import { useRef } from "react";
import { Map } from "../leaflet/map.tsx";
import { cn } from "../lib/utils.ts";

export const zoom = 3;

export const CatlasMap = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  const mapOptions = useRef<L.MapOptions>({
    center: [0, 0],
    zoom: 0,
    minZoom: 0,
    preferCanvas: true,
    crs: lExtend({}, lCrs.Simple, {
      transformation: lTransformation(1 / 2 ** zoom, 0, 1 / 2 ** zoom, 0),
    }),
    zoomControl: false,
    attributionControl: false,
  });

  return (
    <Map className={cn(["h-full", "w-full", className])} initialOptions={mapOptions.current}>
      {children}
    </Map>
  );
};
