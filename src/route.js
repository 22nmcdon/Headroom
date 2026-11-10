// Where somebody is, as a URL.
//
// Without this every reload landed on the EQ's match exercise at the easy
// tier, wherever you had been, and there was no way to send anybody to "the
// reverb drill, medium". A route is the four things the shell already keeps
// in `ui` - which page, which tool, drills or work, which tier - written in
// the hash so the browser keeps it, and back and forward walk it.
//
//   #/tools/<tool>/<work|drill>/<tier>
//   #/mix   #/sketch   #/analysis
//
// The exercise is not in it. It lives under the tool's settings, it is
// remembered there, and a link that names a tool and a tier is a link that
// still works when an exercise is renamed. Home, Progress and the Learn tab
// will be routes when they are pages; until then a hash naming them is one
// this does not recognise, which goes where an empty one goes.
//
// No imports: the tools are handed in, so this is arithmetic on strings and
// the tests can give it any registry they like.

/** The pages a route can name. The tools are one of them. */
export const ROUTE_VIEWS = ['tools', 'mix', 'sketch', 'analysis'];

/** The two ways of being at a tool. */
export const ROUTE_KINDS = ['work', 'drill'];

/**
 * A hash, read into the fields `ui` keeps - or null when it names nothing.
 *
 * `tools` is the registry: `{ [id]: { tiers: { [tier]: ... } } }`. A route is
 * read as far as it makes sense and no further: `#/tools/reverb/sideways`
 * still takes you to the reverb, and leaves how you work at it as it was. A
 * tool that does not exist is not a route at all, rather than a route to a
 * different tool.
 */
export function parseRoute(hash, tools) {
  const parts = String(hash ?? '').replace(/^#\/?/, '').split('/').filter(Boolean)
    .map((part) => decodeURIComponent(part));
  const [view, mode, kind, tier] = parts;
  if (!ROUTE_VIEWS.includes(view)) return null;
  if (view !== 'tools') return { view };

  const route = { view };
  if (mode === undefined) return route;
  if (!Object.hasOwn(tools, mode)) return null;
  route.mode = mode;

  if (!ROUTE_KINDS.includes(kind)) return route;
  route.kind = kind;

  if (Object.hasOwn(tools[mode].tiers ?? {}, tier)) route.tier = tier;
  return route;
}

/** The hash for where `ui` is. Every field is written, so a link is exact. */
export function routeFor({ view, mode, kind, tier }) {
  if (view !== 'tools') return `#/${view}`;
  return `#/tools/${mode}/${kind}/${tier}`;
}

/**
 * Would arriving at this route change anything?
 *
 * A route that leaves a field out leaves it as it is, so it is the same place
 * as long as every field it does name agrees.
 */
export function sameRoute(route, at) {
  return Object.entries(route).every(([key, value]) => at[key] === value);
}
