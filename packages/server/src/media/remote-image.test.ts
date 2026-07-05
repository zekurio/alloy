import assert from "node:assert/strict"
import { test } from "node:test"

import { resolvesToPublicAddress } from "./remote-image"

// IP-literal hosts only: no DNS or network access is needed to classify them.
test("rejects URLs whose host is a private, loopback, or mapped address", async () => {
  const urls = [
    "http://127.0.0.1/avatar.png",
    "http://0.0.0.0/avatar.png",
    "http://10.0.0.8/avatar.png",
    "http://100.64.1.1/avatar.png",
    "http://169.254.169.254/latest/meta-data",
    "http://172.16.4.2/avatar.png",
    "http://192.168.1.20/avatar.png",
    "http://[::]/avatar.png",
    "http://[::1]/avatar.png",
    "http://[::ffff:127.0.0.1]/avatar.png",
    "http://[fd00::1]/avatar.png",
    "http://[fe80::1]/avatar.png",
  ]
  for (const url of urls) {
    assert.equal(await resolvesToPublicAddress(url), false, url)
  }
})

test("accepts URLs whose host is a public address", async () => {
  const urls = [
    "https://93.184.215.14/avatar.png",
    "https://[2606:4700:4700::1111]/avatar.png",
  ]
  for (const url of urls) {
    assert.equal(await resolvesToPublicAddress(url), true, url)
  }
})
