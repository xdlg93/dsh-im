/**
 * Resolve the Cordis Host root context from any context in its tree.
 *
 * This plugin keeps a few objects per Host — the modern Harness compatibility
 * API, the delivery service, the pending question/approval scope — and they must
 * be keyed by the root so two Hosts in one process never share them.
 *
 * `ctx.root` used to answer that, and on Cordis 4.2 it no longer can: a runtime
 * context throws `cannot get property "root" without inject` for an undeclared
 * property, and the root is published as a symbol on every context instead. Read
 * the symbol when it is there, keep the plain property for older Cordis, and
 * fall back to the context itself so a foreign context still works.
 */
export function hostRoot(ctx) {
  if (!ctx || (typeof ctx !== 'object' && typeof ctx !== 'function')) return ctx;
  try {
    const root = ctx.root;
    if (root) return root;
  } catch {
    // Cordis 4.2+ throws here; the symbol below answers instead.
  }
  let keys;
  try {
    keys = Reflect.ownKeys(ctx);
  } catch {
    return ctx;
  }
  for (const key of keys) {
    if (typeof key !== 'symbol' || key.description !== 'cordis.root') continue;
    try {
      const root = ctx[key];
      if (root) return root;
    } catch {
      // Keep looking, then fall back to this context.
    }
  }
  return ctx;
}
