import * as React from "react";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { LogInIcon, LogOutIcon } from "lucide-react";

import { buttonVariants } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { toast } from "@workspace/ui/components/sonner";
import { UserChip } from "@workspace/ui/components/user-chip";

import { signOut } from "../lib/auth-client";
import { useSuspenseSession } from "../lib/session-suspense";
import { useUserChipData } from "../lib/user-display";

export function UserMenu() {
  return (
    <React.Suspense fallback={<UserChipSkeleton />}>
      <UserMenuInner />
    </React.Suspense>
  );
}

function UserMenuInner() {
  const session = useSuspenseSession();
  const router = useRouter();
  const navigate = useNavigate();
  const chip = useUserChipData(session?.user);

  if (!session) {
    return (
      <Link
        to="/login"
        className={buttonVariants({ variant: "ghost", size: "sm" })}
      >
        <LogInIcon />
        Sign in
      </Link>
    );
  }

  async function onSignOut() {
    try {
      await signOut();
      await router.invalidate();
      await navigate({ to: "/login" });
    } catch (cause) {
      toast.error("Couldn't sign out", {
        description:
          cause instanceof Error
            ? cause.message
            : "Something went wrong. Please try again.",
      });
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<UserChip name={chip.name} avatar={chip.avatar} />}
      />
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        style={{ minWidth: "var(--radix-dropdown-menu-trigger-width)" }}
      >
        <DropdownMenuItem variant="destructive" onClick={onSignOut}>
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserChipSkeleton() {
  return (
    <div
      data-slot="user-chip-skeleton"
      className="inline-flex h-[30px] items-center gap-2 rounded-md border border-border bg-surface-raised py-[2px] pr-3 pl-[2px]"
      aria-hidden
    >
      <Skeleton className="size-6 rounded-[4px]" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}
