import { expect, it } from "vitest";

import { webhookUrlProblem } from "./url";

it("accepts https to a public name", () => {
  expect(webhookUrlProblem("https://hooks.example.com/slot")).toBeNull();
  expect(webhookUrlProblem("https://api.acme.io:443/in?x=1")).toBeNull();
});

it("refuses every way of spelling an internal address", () => {
  for (const url of [
    "http://hooks.example.com/slot",
    "https://127.0.0.1/",
    "https://2130706433/",
    "https://0x7f.1/",
    "https://[::1]/",
    "https://[fd00::1]/",
    "https://169.254.169.254/latest/meta-data",
    "https://10.0.0.5/",
    "https://localhost/",
    "https://api.localhost/",
    "https://printer.local/",
    "https://db.internal/",
    "https://router.home.arpa/",
    "https://intranet/",
    "https://user:pass@hooks.example.com/",
    "https://hooks.example.com:8443/",
    "ftp://hooks.example.com/",
    "not a url",
  ])
    expect(webhookUrlProblem(url), url).not.toBeNull();
});
