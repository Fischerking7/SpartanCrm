import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";

const ROLE_COLORS: Record<string, string> = {
  ADMIN: "#ef4444",
  OPERATIONS: "#f97316",
  EXECUTIVE: "#8b5cf6",
  DIRECTOR: "#6366f1",
  MANAGER: "#0ea5e9",
  LEAD: "#14b8a6",
  REP: "#3b82f6",
  MDU: "#10b981",
  ACCOUNTING: "#f59e0b",
};

export { ROLE_COLORS };

const CITY_COORDS: Record<string, [number, number]> = {
  "New York": [40.7128, -74.006], "Los Angeles": [34.0522, -118.2437], "Chicago": [41.8781, -87.6298],
  "Houston": [29.7604, -95.3698], "Phoenix": [33.4484, -112.074], "Philadelphia": [39.9526, -75.1652],
  "San Antonio": [29.4241, -98.4936], "San Diego": [32.7157, -117.1611], "Dallas": [32.7767, -96.797],
  "San Jose": [37.3382, -121.8863], "Austin": [30.2672, -97.7431], "Jacksonville": [30.3322, -81.6557],
  "Fort Worth": [32.7555, -97.3308], "Columbus": [39.9612, -82.9988], "Charlotte": [35.2271, -80.8431],
  "Indianapolis": [39.7684, -86.1581], "San Francisco": [37.7749, -122.4194], "Seattle": [47.6062, -122.3321],
  "Denver": [39.7392, -104.9903], "Nashville": [36.1627, -86.7816], "Oklahoma City": [35.4676, -97.5164],
  "El Paso": [31.7619, -106.485], "Washington": [38.9072, -77.0369], "Boston": [42.3601, -71.0589],
  "Portland": [45.5152, -122.6784], "Las Vegas": [36.1699, -115.1398], "Memphis": [35.1495, -90.049],
  "Louisville": [38.2527, -85.7585], "Baltimore": [39.2904, -76.6122], "Milwaukee": [43.0389, -87.9065],
  "Albuquerque": [35.0844, -106.6504], "Tucson": [32.2226, -110.9747], "Fresno": [36.7378, -119.7871],
  "Sacramento": [38.5816, -121.4944], "Mesa": [33.4152, -111.8315], "Kansas City": [39.0997, -94.5786],
  "Atlanta": [33.749, -84.388], "Omaha": [41.2565, -95.9345], "Colorado Springs": [38.8339, -104.8214],
  "Raleigh": [35.7796, -78.6382], "Miami": [25.7617, -80.1918], "Tampa": [27.9506, -82.4572],
  "Orlando": [28.5383, -81.3792], "Minneapolis": [44.9778, -93.265], "Cleveland": [41.4993, -81.6944],
  "Pittsburgh": [40.4406, -79.9959], "St. Louis": [38.627, -90.1994], "Cincinnati": [39.1031, -84.512],
  "Detroit": [42.3314, -83.0458], "Salt Lake City": [40.7608, -111.891], "Richmond": [37.5407, -77.436],
  "Norfolk": [36.8508, -76.2859], "Virginia Beach": [36.8529, -75.978], "Boise": [43.615, -116.2023],
  "Spokane": [47.6588, -117.426], "Des Moines": [41.5868, -93.625], "Little Rock": [34.7465, -92.2896],
  "Birmingham": [33.5207, -86.8025], "Charleston": [32.7765, -79.9311], "Columbia": [34.0007, -81.0348],
  "Knoxville": [35.9606, -83.9207], "Chattanooga": [35.0456, -85.3097], "Lexington": [38.0406, -84.5037],
  "Greensboro": [36.0726, -79.792], "Winston-Salem": [36.0999, -80.2442], "Durham": [35.994, -78.8986],
  "Newark": [40.7357, -74.1724], "Jersey City": [40.7178, -74.0431], "Akron": [41.0814, -81.519],
  "Toledo": [41.6528, -83.5379], "Madison": [43.0731, -89.4012], "Baton Rouge": [30.4515, -91.1871],
  "New Orleans": [29.9511, -90.0715], "Anchorage": [61.2181, -149.9003], "Honolulu": [21.3069, -157.8583],
  "Tulsa": [36.154, -95.9928], "Wichita": [37.6872, -97.3301], "Arlington": [32.7357, -97.1081],
  "Aurora": [39.7294, -104.8319], "Bakersfield": [35.3733, -119.0187], "Anaheim": [33.8366, -117.9143],
  "Santa Ana": [33.7455, -117.8677], "Riverside": [33.9806, -117.3755], "Corpus Christi": [27.8006, -97.3964],
  "Henderson": [36.0395, -114.9817], "Stockton": [37.9577, -121.2908], "Irvine": [33.6846, -117.8265],
  "St. Petersburg": [27.7676, -82.6403], "Lubbock": [33.5779, -101.8552], "Chandler": [33.3062, -111.8413],
  "Scottsdale": [33.4942, -111.9261], "Glendale": [33.5387, -112.1860], "Plano": [33.0198, -96.6989],
  "Laredo": [27.5036, -99.5076], "Gilbert": [33.3528, -111.789], "Reno": [39.5296, -119.8138],
};

export function lookupCoords(locationStr: string): [number, number] | null {
  const cityPart = locationStr.split(",")[0].trim();
  if (CITY_COORDS[cityPart]) return CITY_COORDS[cityPart];
  for (const [name, coords] of Object.entries(CITY_COORDS)) {
    if (cityPart.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(cityPart.toLowerCase())) {
      return coords;
    }
  }
  return null;
}

export type MapMember = {
  id: string;
  name: string;
  repId: string;
  role: string;
  lastLoginLocation: string | null;
  lastLoginAt: string | null;
  lastActiveAt: string | null;
  isOnline: boolean;
};

function formatTimeAgo(dateStr: string | null) {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function TeamMapComponent({ members, height = "400px" }: { members: MapMember[]; height?: string }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    const map = L.map(mapRef.current).setView([39.8283, -98.5795], 4);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 18,
    }).addTo(map);

    mapInstance.current = map;

    return () => {
      map.remove();
      mapInstance.current = null;
      clusterRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapInstance.current) return;
    const map = mapInstance.current;

    if (clusterRef.current) {
      map.removeLayer(clusterRef.current);
    }

    const cluster = L.markerClusterGroup({
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
    });
    clusterRef.current = cluster;

    const membersWithLocation = members.filter(m => m.lastLoginLocation);
    const locationGroups: Record<string, MapMember[]> = {};
    for (const m of membersWithLocation) {
      const loc = m.lastLoginLocation!;
      if (!locationGroups[loc]) locationGroups[loc] = [];
      locationGroups[loc].push(m);
    }

    let plotted = 0;
    let unmatched = 0;

    for (const [location, groupMembers] of Object.entries(locationGroups)) {
      const coords = lookupCoords(location);
      if (!coords) {
        unmatched += groupMembers.length;
        continue;
      }

      for (const m of groupMembers) {
        const jitterLat = coords[0] + (Math.random() - 0.5) * 0.005;
        const jitterLng = coords[1] + (Math.random() - 0.5) * 0.005;
        const roleColor = ROLE_COLORS[m.role] || "#6b7280";
        const borderColor = m.isOnline ? "#10b981" : "#fff";

        const marker = L.circleMarker([jitterLat, jitterLng], {
          radius: 8,
          fillColor: roleColor,
          color: borderColor,
          weight: m.isOnline ? 3 : 2,
          fillOpacity: 0.85,
        });

        const container = document.createElement("div");
        container.style.minWidth = "180px";

        const nameEl = document.createElement("strong");
        nameEl.style.fontSize = "13px";
        nameEl.textContent = m.name;
        container.appendChild(nameEl);

        const roleEl = document.createElement("div");
        roleEl.style.cssText = "font-size:11px;margin:2px 0;";
        const roleDot = document.createElement("span");
        roleDot.style.cssText = `display:inline-block;width:8px;height:8px;border-radius:50%;background:${roleColor};margin-right:4px;vertical-align:middle;`;
        roleEl.appendChild(roleDot);
        roleEl.appendChild(document.createTextNode(`${m.repId} · ${m.role}`));
        container.appendChild(roleEl);

        const locEl = document.createElement("div");
        locEl.style.cssText = "font-size:11px;color:#666;";
        locEl.textContent = location;
        container.appendChild(locEl);

        const statusEl = document.createElement("div");
        statusEl.style.cssText = `font-size:11px;margin-top:4px;color:${m.isOnline ? "#10b981" : "#999"};font-weight:500;`;
        statusEl.textContent = m.isOnline ? "● Online now" : `○ Last login: ${formatTimeAgo(m.lastLoginAt)}`;
        container.appendChild(statusEl);

        marker.bindPopup(container);
        cluster.addLayer(marker);
        plotted++;
      }
    }

    map.addLayer(cluster);

    const existingNotes = mapRef.current?.querySelectorAll(".leaflet-info-note");
    existingNotes?.forEach(n => n.remove());

    const infoNote = document.createElement("div");
    infoNote.className = "leaflet-info-note";
    infoNote.style.cssText = "position:absolute;bottom:8px;left:8px;z-index:1000;background:rgba(255,255,255,0.92);padding:6px 10px;border-radius:6px;font-size:11px;color:#555;pointer-events:none;box-shadow:0 1px 3px rgba(0,0,0,0.1);";
    const lines = [`${plotted} plotted`];
    if (unmatched > 0) lines.push(`${unmatched} unmapped`);
    infoNote.textContent = lines.join(" · ");
    mapRef.current?.appendChild(infoNote);
  }, [members]);

  return <div ref={mapRef} style={{ height }} className="rounded-lg border relative" data-testid="map-team-locations" />;
}
