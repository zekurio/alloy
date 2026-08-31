import assert from "node:assert/strict"
import { runInNewContext } from "node:vm"

import { test } from "vite-plus/test"

import { desktopNavigationScript } from "./desktop-navigation"

interface NavigationState {
  __TSR_index?: number
  __TSR_key?: string
  key?: string
}

interface TestHistory {
  state: NavigationState
  pushState(state: NavigationState, title: string, url: string): void
}

test("notifies hash history through patched pushState", () => {
  const calls: Array<{ state: NavigationState; url: string }> = []
  const history: TestHistory = {
    state: { __TSR_index: 4 },
    pushState(state: NavigationState, _title: string, url: string) {
      this.state = state
      calls.push({ state, url })
    },
  }

  runInNewContext(desktopNavigationScript("/library"), {
    window: { history },
    Math,
    Number,
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.url, "#/library")
  assert.equal(calls[0]?.state.__TSR_index, 5)
  assert.match(calls[0]?.state.__TSR_key ?? "", /^[a-z0-9]+$/)
})
