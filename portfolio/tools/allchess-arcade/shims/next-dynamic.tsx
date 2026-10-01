import { Suspense, lazy, type ComponentType, type ReactNode } from "react";

type Loader<P> = () => Promise<ComponentType<P> | { default: ComponentType<P> }>;
type DynamicOptions = { ssr?: boolean; loading?: () => ReactNode };

/** Client-only stand-in for `next/dynamic`: React.lazy with the same `loading` fallback. */
export default function dynamic<P extends object>(loader: Loader<P>, options: DynamicOptions = {}) {
  const LazyComponent = lazy(async () => {
    const loaded = await loader();
    return { default: "default" in loaded ? loaded.default : loaded };
  });
  const Loading = options.loading;
  function DynamicComponent(props: P) {
    return <Suspense fallback={Loading ? <Loading /> : null}><LazyComponent {...props} /></Suspense>;
  }
  return DynamicComponent;
}
