// Type augmentation for vitest-axe matchers.
//
// vitest-axe 0.1.0 augments the legacy `Vi.Assertion` namespace that older
// vitest versions exposed. Vitest 4.x moved `Assertion` to a top-level
// interface in `@vitest/expect`, so the package's shipped declarations no
// longer attach. Re-augment the correct interface here.
import type { AxeMatchers } from "vitest-axe/matchers";

declare module "@vitest/expect" {
  interface Assertion<T = any> extends AxeMatchers {}
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}

declare module "vitest" {
  interface Assertion<T = any> extends AxeMatchers {}
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
