import { memo } from "react";
import { Card, DistroBar, Skeleton, CardEmpty } from "./primitives.jsx";
import { plural } from "../format.js";

// memo: the dashboard shell re-renders on every rewards/IoT-status scan flush;
// this card's props are referentially stable across those, so skip the churn.
export default memo(function GeoCard({ regions }) {
  if (!regions) {
    return (
      <Card title="Geographic distribution">
        <Skeleton className="h-32 w-full" />
      </Card>
    );
  }

  const cities = regions.topCities || [];
  const max = cities[0]?.count || 1;

  return (
    <Card
      title="Geographic distribution"
      subtitle={`${plural(regions.countriesDistinct, "country", "countries")} · ${plural(regions.statesDistinct, "state")} · ${plural(regions.citiesDistinct, "city", "cities")}`}
    >
      {cities.length === 0 ? (
        <CardEmpty>No location data</CardEmpty>
      ) : (
        <div className="space-y-2.5">
          {cities.map((c) => (
            <DistroBar key={c.name} label={c.name} count={c.count} total={max} />
          ))}
        </div>
      )}
    </Card>
  );
});
