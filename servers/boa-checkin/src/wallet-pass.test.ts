import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadWalletPassConfig, buildBoaPassFields, type WalletPassData } from "./wallet-pass.js";

const ENV_KEYS = [
  "BOA_WALLET_PASS_TYPE_ID",
  "BOA_WALLET_TEAM_ID",
  "BOA_WALLET_SIGNER_CERT_PATH",
  "BOA_WALLET_SIGNER_KEY_PATH",
  "BOA_WALLET_SIGNER_KEY_PASSPHRASE",
  "BOA_WALLET_WWDR_PATH",
] as const;

describe("loadWalletPassConfig", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("throws listing every missing key when none are set", () => {
    expect(() => loadWalletPassConfig()).toThrow(/BOA_WALLET_PASS_TYPE_ID/);
    expect(() => loadWalletPassConfig()).toThrow(/BOA_WALLET_SIGNER_CERT_PATH/);
  });

  it("returns the config object when all required keys are set", () => {
    process.env.BOA_WALLET_PASS_TYPE_ID = "pass.com.lepesqueur.boaboarding";
    process.env.BOA_WALLET_TEAM_ID = "ABCDE12345";
    process.env.BOA_WALLET_SIGNER_CERT_PATH = "/tmp/signerCert.pem";
    process.env.BOA_WALLET_SIGNER_KEY_PATH = "/tmp/signerKey.pem";
    process.env.BOA_WALLET_WWDR_PATH = "/tmp/wwdr.pem";
    // passphrase is optional — key may be unencrypted
    const config = loadWalletPassConfig();
    expect(config).toEqual({
      passTypeIdentifier: "pass.com.lepesqueur.boaboarding",
      teamIdentifier: "ABCDE12345",
      signerCertPath: "/tmp/signerCert.pem",
      signerKeyPath: "/tmp/signerKey.pem",
      signerKeyPassphrase: undefined,
      wwdrPath: "/tmp/wwdr.pem",
    });
  });
});

const sampleData: WalletPassData = {
  locator: "XK9F2P",
  passengerName: "Carlos Lepesqueur",
  frequentFlyerNumber: "EL 048213",
  flightNumber: "OB682",
  originCode: "LPB",
  originName: "La Paz — El Alto Intl.",
  destinationCode: "VVI",
  destinationName: "Viru Viru Intl., Santa Cruz",
  departureTime: "19:10",
  arrivalTime: "23:10",
  boardingTime: "18:40",
  flightDate: "07 jul",
  seat: "25C",
  boardingGroup: "2",
  travelClass: "Economy",
  boardingSequence: "014",
  gate: undefined,
  barcodeMessage: "M1LEPESQUEUER/CARLOS  EXK9F2P OB682 190 25C0014 147>",
};

describe("buildBoaPassFields", () => {
  it("puts boarding time + flight date (converted to DD/MM) combined in headerFields", () => {
    const fields = buildBoaPassFields(sampleData);
    expect(fields.headerFields).toEqual([
      { key: "boarding", label: "BOARDING TIME", value: "18:40 07/07" },
    ]);
  });

  it("keeps the flight date as-is in headerFields when it doesn't match the expected 'DD Mon' shape", () => {
    const fields = buildBoaPassFields({ ...sampleData, flightDate: "unparseable" });
    expect(fields.headerFields).toEqual([
      { key: "boarding", label: "BOARDING TIME", value: "18:40 unparseable" },
    ]);
  });

  it("puts the route in primaryFields", () => {
    const fields = buildBoaPassFields(sampleData);
    expect(fields.primaryFields).toEqual([
      { key: "origin", label: "LA PAZ", value: "LPB" },
      { key: "destination", label: "SANTA CRUZ", value: "VVI" },
    ]);
  });

  it("puts flight/departure/gate in secondaryFields, using a placeholder for missing gate", () => {
    const fields = buildBoaPassFields(sampleData);
    expect(fields.secondaryFields).toEqual([
      { key: "flightNumber", label: "FLIGHT", value: "OB682" },
      { key: "departure", label: "DEPARTURE", value: "19:10" },
      { key: "gate", label: "GATE", value: "—" },
    ]);
  });

  it("puts passenger/seat/group/class in auxiliaryFields", () => {
    const fields = buildBoaPassFields(sampleData);
    expect(fields.auxiliaryFields).toEqual([
      { key: "passenger", label: "NAME", value: "Carlos Lepesqueur" },
      { key: "seat", label: "SEAT", value: "25C" },
      { key: "group", label: "GROUP", value: "2" },
      { key: "class", label: "CLASS", value: "Economy" },
    ]);
  });

  it("fills backFields with locator, sequence, full airport names, arrival and frequent flyer number", () => {
    const fields = buildBoaPassFields(sampleData);
    expect(fields.backFields).toEqual([
      { key: "locator", label: "BOOKING REFERENCE", value: "XK9F2P" },
      { key: "sequence", label: "SEQUENCE", value: "014" },
      { key: "originFull", label: "FROM", value: "La Paz — El Alto Intl. (LPB)" },
      { key: "destinationFull", label: "TO", value: "Viru Viru Intl., Santa Cruz (VVI)" },
      {
        key: "contact",
        label: "CONTACT",
        value: "Boliviana de Aviación · boa.bo",
      },
      { key: "arrival", label: "ARRIVAL", value: "23:10" },
      { key: "frequentFlyer", label: "FREQUENT FLYER", value: "EL 048213" },
    ]);
  });

  it("omits the arrival backField entirely when arrivalTime is missing", () => {
    const fields = buildBoaPassFields({ ...sampleData, arrivalTime: undefined });
    expect(fields.backFields.some((f) => f.key === "arrival")).toBe(false);
  });

  it("omits the frequent flyer backField entirely when there is no frequent flyer number", () => {
    const fields = buildBoaPassFields({ ...sampleData, frequentFlyerNumber: undefined });
    expect(fields.backFields.some((f) => f.key === "frequentFlyer")).toBe(false);
  });

  it("falls back to the whole trimmed+uppercased name when neither delimiter is present", () => {
    const fields = buildBoaPassFields({ ...sampleData, originName: "El Alto" });
    expect(fields.primaryFields).toEqual([
      { key: "origin", label: "EL ALTO", value: "LPB" },
      { key: "destination", label: "SANTA CRUZ", value: "VVI" },
    ]);
  });

  it("falls back to a placeholder in backFields when boardingSequence is missing", () => {
    const fields = buildBoaPassFields({ ...sampleData, boardingSequence: undefined });
    expect(fields.backFields).toEqual([
      { key: "locator", label: "BOOKING REFERENCE", value: "XK9F2P" },
      { key: "sequence", label: "SEQUENCE", value: "—" },
      { key: "originFull", label: "FROM", value: "La Paz — El Alto Intl. (LPB)" },
      { key: "destinationFull", label: "TO", value: "Viru Viru Intl., Santa Cruz (VVI)" },
      {
        key: "contact",
        label: "CONTACT",
        value: "Boliviana de Aviación · boa.bo",
      },
      { key: "arrival", label: "ARRIVAL", value: "23:10" },
      { key: "frequentFlyer", label: "FREQUENT FLYER", value: "EL 048213" },
    ]);
  });
});
