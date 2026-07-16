import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadWalletPassConfig } from "./wallet-pass.js";

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
