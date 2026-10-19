import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { ToastProvider } from "@/components/ui/toast";
import type { User } from "@/types/user";

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
  user: User | null | undefined;
}>()({
  component: RootComponent,
});

function RootComponent() {
  return (
    <ToastProvider position="bottom-right">
      <div className="flex h-svh w-full flex-row overflow-x-hidden overflow-y-hidden bg-background scrollbar-thin scrollbar-thumb-border scrollbar-track-muted">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Outlet />
        </div>
      </div>
    </ToastProvider>
  );
}

export default RootComponent;
