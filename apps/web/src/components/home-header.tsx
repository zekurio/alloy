import * as React from "react";
import { BellIcon } from "lucide-react";

import {
  AppHeader,
  AppHeaderActions,
  AppHeaderBrand,
  AppHeaderSearch,
} from "@workspace/ui/components/app-header";
import { DividerV } from "@workspace/ui/components/app-shell";
import { Button } from "@workspace/ui/components/button";

import { useAppSearch } from "./app-search";
import { SearchResultsPopover } from "./search-results-popover";
import { UserMenu } from "./user-menu";

export function HomeHeader() {
  const { query, setQuery, clear, setOpen } = useAppSearch();
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== "k"
      ) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <AppHeader>
      <AppHeaderBrand />
      <AppHeaderSearch
        ref={inputRef}
        value={query}
        placeholder="Search clips, games and users..."
        aria-label="Search clips, games and users"
        autoComplete="off"
        spellCheck={false}
        // Re-open the popover when focus returns to a populated input.
        // We close on Esc / commit / click-outside, so the user coming
        // back to pending text needs a re-entry path that doesn't
        // require another keystroke.
        onFocus={() => {
          if (query.trim().length > 0) setOpen(true);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
        onClear={() => {
          clear();
          // Keep focus so the user can keep typing without reaching
          // for the mouse after hitting the clear button.
          inputRef.current?.focus();
        }}
      >
        <SearchResultsPopover />
      </AppHeaderSearch>
      <AppHeaderActions>
        <Button variant="ghost" size="icon-sm" aria-label="Notifications">
          <BellIcon />
        </Button>
        <DividerV h={20} className="mx-1" />
        <UserMenu />
      </AppHeaderActions>
    </AppHeader>
  );
}
