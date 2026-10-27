import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertTransition,
  canonicalState,
  transitions,
} from "../lib/orders/state";
import { calculateRide } from "../lib/orders/pricing";
import { verticals } from "../lib/orders/verticals";
test("Order: canonical journey, retries handled at command boundary, terminal states immutable", () => {
  for (const [from, to] of [
    ["created", "published"],
    ["published", "driver_pending"],
    ["driver_pending", "assigned"],
    ["assigned", "en_route_to_pickup"],
    ["en_route_to_pickup", "arrived"],
    ["arrived", "in_progress"],
    ["in_progress", "awaiting_confirmation"],
    ["awaiting_confirmation", "completed"],
  ])
    assert.doesNotThrow(() => assertTransition(from, to));
  for (const [from, to] of [
    ["published", "completed"],
    ["assigned", "arrived"],
    ["arrived", "completed"],
    ["in_progress", "cancelled"],
    ["completed", "published"],
    ["cancelled", "assigned"],
    ["assigned", "assigned"],
    ["bogus", "published"],
  ])
    assert.throws(() => assertTransition(from, to));
  assert.equal(canonicalState("driver_pending"), "offered");
  assert.deepEqual(transitions.completed, []);
  assert.ok(verticals.ride);
  assert.equal(verticals.delivery, undefined);
});
test("Pricing: configurable minimum, rounding, route validation and different tariff rules", () => {
  const route = {
    origin: { lat: 40.386, lng: 71.786 },
    destination: { lat: 40.4, lng: 71.8 },
  };
  const rules = {
    base: 7000,
    perKm: 2500,
    minimum: 10000,
    roundTo: 1000,
    maxKm: 150,
  };
  const normal = calculateRide(route, rules),
    changed = calculateRide(route, { ...rules, base: 27000 });
  assert.equal(changed.price - normal.price, 20000);
  assert.equal(normal.price % 1000, 0);
  assert.equal(
    calculateRide(route, { ...rules, minimum: 100000 }).price,
    100000,
  );
  assert.throws(() =>
    calculateRide({ ...route, destination: route.origin }, rules),
  );
  assert.throws(() => calculateRide(route, { ...rules, roundTo: 0 }));
  assert.throws(() =>
    calculateRide({ ...route, origin: { lat: NaN, lng: 71 } }, rules),
  );
  assert.throws(() => calculateRide(route, { ...rules, maxKm: 0.1 }));
});
