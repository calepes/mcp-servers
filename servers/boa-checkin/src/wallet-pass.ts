export interface WalletPassConfig {
  passTypeIdentifier: string;
  teamIdentifier: string;
  signerCertPath: string;
  signerKeyPath: string;
  signerKeyPassphrase?: string;
  wwdrPath: string;
}

/**
 * Lee la config de firma del `.pkpass` desde env vars (apps.env). Tira error
 * explícito listando TODAS las keys que faltan — nunca arma un pase a medias
 * ni asume defaults para certificados/identificadores.
 */
export function loadWalletPassConfig(): WalletPassConfig {
  const passTypeIdentifier = process.env.BOA_WALLET_PASS_TYPE_ID;
  const teamIdentifier = process.env.BOA_WALLET_TEAM_ID;
  const signerCertPath = process.env.BOA_WALLET_SIGNER_CERT_PATH;
  const signerKeyPath = process.env.BOA_WALLET_SIGNER_KEY_PATH;
  const wwdrPath = process.env.BOA_WALLET_WWDR_PATH;

  const missing = [
    !passTypeIdentifier && "BOA_WALLET_PASS_TYPE_ID",
    !teamIdentifier && "BOA_WALLET_TEAM_ID",
    !signerCertPath && "BOA_WALLET_SIGNER_CERT_PATH",
    !signerKeyPath && "BOA_WALLET_SIGNER_KEY_PATH",
    !wwdrPath && "BOA_WALLET_WWDR_PATH",
  ].filter((v): v is string => Boolean(v));

  if (missing.length > 0) {
    throw new Error(
      `Falta configurar en apps.env: ${missing.join(", ")} — ver docs/superpowers/specs/2026-07-15-boa-wallet-pass-design.md.`,
    );
  }

  return {
    passTypeIdentifier: passTypeIdentifier!,
    teamIdentifier: teamIdentifier!,
    signerCertPath: signerCertPath!,
    signerKeyPath: signerKeyPath!,
    signerKeyPassphrase: process.env.BOA_WALLET_SIGNER_KEY_PASSPHRASE,
    wwdrPath: wwdrPath!,
  };
}
