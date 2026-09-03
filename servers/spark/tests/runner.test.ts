import { describe, it, expect } from "vitest";
import { runSpark, parseEmailIds, parseAccountEmails } from "../src/index.js";

describe("parseEmailIds", () => {
  it("extrae IDs de la tabla real de `spark emails`, ignorando header y footer", () => {
    const output = `
Emails in carlos@lepesqueur.net:Inbox (filter: is:pinned)

  ID      Account                From                            Date              Subject                                             Flags
  175617  carlos@lepesqueur.net  "reservas@boa.bo" <reservas_a…  2026-08-09 11:54  Boliviana de Aviación Billete Electrónico - Elect…  starred, attachment
  175323  carlos@lepesqueur.net  Victoria Melo <victoria.melo@…  2026-08-03 20:26  Nubank: Schedule your interview!                    starred
  51281   carlos@lepesqueur.net  Apple Store <your_order_US@or…  2026-07-12 21:57  We're processing your order W1813804665             starred

Page 1 of 2 (7 total emails)
`;
    expect(parseEmailIds(output)).toEqual(["175617", "175323", "51281"]);
  });

  it("devuelve vacío si no hay filas de datos", () => {
    expect(parseEmailIds("\nEmails in x (filter: is:pinned)\n\n  ID   Account\n\nNo emails found\n")).toEqual([]);
  });
});

describe("parseAccountEmails", () => {
  it("extrae los emails de cuenta de `spark accounts`", () => {
    const output = `Email Account: carlos@lepesqueur.net "Lepesqueur" (Access: triage)
├── Calendar: Lepesqueur - read-write (carlos@lepesqueur.net:Lepesqueur)

Email Account: calepes@gmail.com "Gmail" (Access: triage)
`;
    expect(parseAccountEmails(output)).toEqual(["carlos@lepesqueur.net", "calepes@gmail.com"]);
  });
});

describe("runSpark", () => {
  it("returns stdout, stderr, exitCode on success", async () => {
    // Use 'echo' as a stand-in by mocking execFile path via env override
    const result = await runSpark(["--version"], { binaryPath: "/bin/echo" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--version");
  });

  it("returns non-zero exitCode + stderr on failure", async () => {
    const result = await runSpark([], { binaryPath: "/usr/bin/false" });
    expect(result.exitCode).not.toBe(0);
  });

  it("respects timeout", async () => {
    const start = Date.now();
    const result = await runSpark(["10"], { binaryPath: "/bin/sleep", timeout: 200 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000);
    expect(result.exitCode).not.toBe(0); // killed by timeout
  });
});
