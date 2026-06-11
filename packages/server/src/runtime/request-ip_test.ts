import { test } from "node:test"

import { requestIpFromHeaderValues } from "./request-ip"

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`)
  }
}

test("requestIp uses the first X-Forwarded-For entry", () => {
  assertEqual(
    requestIpFromHeaderValues({
      forwardedFor: " 203.0.113.10 , 198.51.100.20 ",
      realIp: "198.51.100.30",
      socketAddress: "198.51.100.40",
    }),
    "203.0.113.10",
    "first forwarded address should win",
  )
})

test("requestIp falls back to X-Real-IP", () => {
  assertEqual(
    requestIpFromHeaderValues({
      realIp: "198.51.100.30",
      socketAddress: "198.51.100.40",
    }),
    "198.51.100.30",
    "real IP should win when XFF is absent",
  )
})

test("requestIp falls back to the socket address", () => {
  assertEqual(
    requestIpFromHeaderValues({ socketAddress: "2001:db8::1" }),
    "2001:db8::1",
    "socket address should be used without proxy headers",
  )
})

test("requestIp ignores blank and malformed addresses", () => {
  assertEqual(
    requestIpFromHeaderValues({
      forwardedFor: "not-an-ip, 203.0.113.10",
      realIp: "also-not-an-ip",
      socketAddress: "198.51.100.40",
    }),
    "198.51.100.40",
    "malformed headers should not hide a usable socket address",
  )
  assertEqual(
    requestIpFromHeaderValues({
      forwardedFor: "  ",
      realIp: "",
      socketAddress: "not-an-ip",
    }),
    null,
    "no usable address should return null",
  )
})
